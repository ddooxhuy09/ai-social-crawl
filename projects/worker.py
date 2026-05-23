import asyncio
import time
import json
import random
from pathlib import Path

# --- BẢN VÁ LỖI DÀI HẠN (LONG-TERM PATCH) ---
# Vá vĩnh viễn lỗi sập Dict Object của trình lách Bot Playwright mỗi khi nó khởi động Server!
try:
    import undetected_playwright._impl._connection as up_conn
    _orig = up_conn.from_nullable_channel
    def _patched(channel):
        if isinstance(channel, dict): return None
        return _orig(channel)
    up_conn.from_nullable_channel = _patched
    print("[SYSTEM] Đã kích hoạt khiên chống Crash cho undetected_playwright.")
except ImportError:
    pass
# --------------------------------------------

from projects.db import _load_queue, _save_queue, archive_task
from crawlers.router import CRAWL_SOURCES
from crawlers import (
    crawl_pins_sync,
    crawl_instagram_all_sync,
    crawl_tiktok_sync,
    crawl_reddit_sync,
    crawl_youtube_sync,
)
from history_utils import save_history, normalize_to_display

async def task_worker_loop():
    print("[WORKER] Starting Global Task Worker...")
    
    # Tự động gỡ các task 'running' mồ côi (Zombie tasks) do tắt server ngang
    try:
        startup_queue = _load_queue()
        tasks = startup_queue.get("tasks", [])
        changed = False
        for t in tasks:
            if t.get("status") == "running":
                t["status"] = "pending"
                changed = True
        if changed:
            _save_queue(startup_queue)
            print("[WORKER] Đã reset các task 'running' bị vướng về lại trạng thái 'pending'.")
    except Exception as e:
        print(f"[WORKER] Lỗi khôi phục zombie tasks: {e}")

    while True:
        try:
            queue_data = _load_queue()
            
            # Check if global switch is ON
            if not queue_data.get("running"):
                await asyncio.sleep(5)
                continue
                
            queue = queue_data.get("tasks", [])
            
            # Kiểm tra xem có task nào đang chạy không
            running_tasks = [t for t in queue if t.get("status") == "running"]
            if running_tasks:
                # Chỉ chạy 1 task tại 1 thời điểm, nên nếu có cái đang chạy thì đợi
                await asyncio.sleep(5)
                continue
                
            # Lấy task pending đầu tiên
            pending_tasks = [t for t in queue if t.get("status") == "pending"]
            if not pending_tasks:
                await asyncio.sleep(5)
                continue
                
            task = pending_tasks[0]
            await run_task(task)
            
        except Exception as e:
            print(f"[WORKER] Error in loop: {e}")
            await asyncio.sleep(10)

async def run_task(task: dict):
    task_id = task.get("id")
    print(f"[WORKER] Running task: {task_id} - {task.get('title')}")
    
    start_time_str = time.strftime("%Y-%m-%d %H:%M:%S")
    task["startedAt"] = start_time_str
    
    # 1. Update status to running
    queue_data = _load_queue()
    tasks = queue_data.get("tasks", [])
    for t in tasks:
        if t.get("id") == task_id:
            t["status"] = "running"
            t["startedAt"] = start_time_str
            t["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            break
    _save_queue(queue_data)
    
    # --- SEND START NOTIFICATION ---
    try:
        t_type = task.get("type") or task.get("page")
        if t_type in ("crawl_keyword", "crawl", "crawl-image", "crawl_image"):
            import projects.db
            import telegram_bot.notify as tg
            p_name = "Crawl Page"
            try:
                project = projects.db._get_project(task.get("projectId"))
                p_name = project.get("name", p_name)
            except Exception: pass
            
            kw = task.get("keyword") or task.get("title") or "N/A"
            tg.notify_crawl_start(p_name, kw, start_time_str)
    except Exception as e:
        print(f"[TELEGRAM] Lỗi gửi Start Noti: {e}")
    # -------------------------------
    
    # 2. Execute based on type (CÓ GIỚI HẠN TIMEOUT CHỐNG KẸT DEADLOCK)
    try:
        t_type = task.get("type") or task.get("page")
        if t_type == "crawl_keyword" or t_type == "crawl":
            # Chờ luồng này cào tối đa 1 tiếng (3600s) cho khối lượng dữ liệu khổng lồ
            result = await asyncio.wait_for(execute_crawl_keyword(task), timeout=3600)
            task["status"] = "done"
            task["result"] = result
        elif t_type == "crawl-image" or t_type == "crawl_image":
            # 5 phút tối đa
            result = await asyncio.wait_for(execute_crawl_image(task), timeout=300)
            task["status"] = "done"
            task["result"] = result
        elif t_type == "chat-create-image":
            # 10 phút tối đa cho render AI
            result = await asyncio.wait_for(execute_chat_create_image(task), timeout=600)
            task["status"] = "done"
            task["result"] = result
        else:
            print(f"[WORKER] Unknown task type: {t_type}")
            task["status"] = "error"
            task["errorMessage"] = f"Unknown task type: {t_type}"
            
    except asyncio.TimeoutError:
        print(f"[WORKER] Task TIMEOUT after wait_for limit!")
        task["status"] = "error"
        task["errorMessage"] = "Đã quá giới hạn thời gian (Timeout) chờ kịch bản chạy!"
    except Exception as e:
        print(f"[WORKER] Task failed: {e}")
        task["status"] = "error"
        task["errorMessage"] = str(e) or type(e).__name__
    
    task["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    
    # 3. Archive (Move to history and sync to project)
    archive_task(task)
    print(f"[WORKER] Task finished and archived: {task_id}")
    
    # 4. Gọi thông báo bằng chuỗi Telegram async
    if task.get("status") == "done":
        try:
            import projects.db
            import telegram_bot.notify as tg
            
            t_type = task.get("type") or task.get("page")
            
            p_name = "Crawl Page"
            project = {}
            try:
                project = projects.db._get_project(task.get("projectId"))
                p_name = project.get("name", p_name)
            except Exception:
                pass
            
            # GỘP THÔNG BÁO CHO CRAWL TASK
            if t_type in ("crawl_keyword", "crawl", "crawl-image", "crawl_image"):
                queue_data = projects.db._load_queue()
                remaining = [
                    t for t in queue_data.get("tasks", [])
                    if t.get("projectId") == task.get("projectId")
                    and (t.get("type") or t.get("page")) in ("crawl_keyword", "crawl", "crawl-image", "crawl_image")
                ]
                # Nếu không còn lệnh crawl nào thuộc project này pending, gửi 1 cú chót
                if len(remaining) == 0:
                    kw = task.get("keyword") or task.get("title") or "N/A"
                    start_time_str = task.get("startedAt", time.strftime("%Y-%m-%d %H:%M:%S"))
                    end_time_str = time.strftime("%Y-%m-%d %H:%M:%S")
                    pinterest_likes = task.get("result", {}).get("pinterest_likes", 0) if task.get("result") else 0
                    tg.notify_crawl_all_done(p_name, kw, start_time_str, end_time_str, pinterest_likes)
                    
            # BÁO CÁO CHO AI GENERATION TASK
            elif t_type == "chat-create-image":
                tasks = project.get("redesign", {}).get("tasks", [])
                done_count = sum(1 for t in tasks if t.get("status") == "done")
                tg.notify_ai_image_done(p_name, task.get("title", "Image"), done_count, len(tasks))
                
        except Exception as e:
            print(f"[TELEGRAM] Báo cáo Task Done bị lỗi: {e}")
            
    elif task.get("status") == "error":
        try:
            import projects.db
            import telegram_bot.notify as tg
            
            p_name = task.get("projectName", task.get("projectId", ""))
            try:
                project = projects.db._get_project(task.get("projectId"))
                p_name = project.get("name", p_name)
            except Exception: pass
            
            step_name = f"Worker Task [{task.get('type')}]"
            err_msg = task.get("errorMessage", "Lỗi không xác định do Timeout hoặc API...")
            tg.notify_error(p_name, step_name, err_msg)
        except Exception as e:
            print(f"[TELEGRAM] Báo cáo Lỗi bị lỗi: {e}")

async def execute_crawl_keyword(task: dict):
    kw = task.get("keyword")
    # Lấy các params từ task nếu có, nếu không dùng mặc định
    limit = task.get("limit_per_source") or 60
    requested_sources = task.get("sources") or list(CRAWL_SOURCES)
    project_id = task.get("projectId")
    
    # Load saved Pinterest cookie (if any)
    from crawlers.router import get_default_pinterest_cookie, PINTEREST_COOKIE_CACHE_PATH
    _pinterest_cookie = ""
    try:
        _pinterest_cookie = get_default_pinterest_cookie().get("cookie_string", "")
    except Exception as e:
        print(f"[WORKER] Không tải được Pinterest cookie: {e}")

    def _mark_cookie_expired():
        try:
            import time as _time
            PINTEREST_COOKIE_CACHE_PATH.write_text(
                __import__("json").dumps({"valid": False, "reason": "expired", "cached_at": _time.time()}),
                encoding="utf-8",
            )
        except Exception:
            pass

    # Logic mượn từ crawlers/router.py
    async def crawl_pinterest():
        if not _pinterest_cookie or "_auth=1" not in _pinterest_cookie:
            _mark_cookie_expired()
            raise Exception("COOKIE_EXPIRED: Cookie Pinterest không hợp lệ hoặc đã hết hạn. Vui lòng cập nhật cookie mới.")
        await asyncio.sleep(random.uniform(0, 2))
        return await asyncio.to_thread(crawl_pins_sync, kw, max_pins=limit, cookie_string=_pinterest_cookie)

    async def crawl_instagram():
        await asyncio.sleep(random.uniform(0, 2))
        return await asyncio.to_thread(crawl_instagram_all_sync, kw, max_items=limit)

    async def crawl_tiktok():
        await asyncio.sleep(random.uniform(0, 2))
        return await asyncio.to_thread(crawl_tiktok_sync, kw, max_items=limit)

    async def crawl_reddit():
        await asyncio.sleep(random.uniform(0, 2))
        return await asyncio.to_thread(crawl_reddit_sync, kw, max_items=limit)

    async def crawl_youtube():
        await asyncio.sleep(random.uniform(0, 2))
        return await asyncio.to_thread(crawl_youtube_sync, kw, max_items=limit)

    exec_tasks = []
    for src in requested_sources:
        if src == "pinterest": exec_tasks.append(("pinterest", crawl_pinterest()))
        elif src == "instagram": exec_tasks.append(("instagram", crawl_instagram()))
        elif src == "tiktok": exec_tasks.append(("tiktok", crawl_tiktok()))
        elif src == "reddit": exec_tasks.append(("reddit", crawl_reddit()))
        elif src == "youtube": exec_tasks.append(("youtube", crawl_youtube()))

    results = await asyncio.gather(*(coro for _, coro in exec_tasks), return_exceptions=True)

    pin_infos = []
    pins_by_source = {s: [] for s in CRAWL_SOURCES}
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            print(f"[WORKER] Source {exec_tasks[i][0]} failed: {r}")
            continue
        src = exec_tasks[i][0]
        if src == "instagram":
            ig_data = r if isinstance(r, dict) else {"photos": [], "reels": []}
            for p in ig_data.get("photos", []):
                p["content_type"] = "photo"
                pins_by_source["instagram"].append(p)
                pin_infos.append(normalize_to_display(p, "instagram"))
            for p in ig_data.get("reels", []):
                p["content_type"] = "reel"
                pins_by_source["instagram"].append(p)
                pin_infos.append(normalize_to_display(p, "instagram"))
            continue
        for p in r or []:
            pins_by_source[src].append(p)
            pin_infos.append(normalize_to_display(p, src))

    pin_infos.sort(key=lambda p: int(p.get("view_count") or 0), reverse=True)
    
    pinterest_likes = sum(
        int(p.get("reaction_count") or 0) + int(p.get("repin_count") or 0) + int(p.get("save_count") or 0)
        for p in pins_by_source.get("pinterest", [])
    )
    
    # Lưu history như cũ (hàm save_history sẽ lo việc tạo folder info.json)
    pid_for_history = project_id if project_id and project_id != "global" else None
    history_id = await asyncio.to_thread(save_history, kw, pins_by_source, "crawl", pid_for_history)
    
    return {
        "keyword": kw,
        "total": len(pin_infos),
        "pins": pin_infos, # Trả về bản rút gọn để UI hiển thị
        "history_id": history_id,
        "pinterest_likes": pinterest_likes
    }

async def execute_crawl_image(task: dict):
    # Logic mượn từ crawlers/router.py:pinterest_upload_and_search
    from crawlers import upload_pin_sync
    from crawlers.router import get_default_pinterest_cookie
    import base64
    import tempfile
    import os
    
    imageData = task.get("imageData")
    if not imageData:
        raise Exception("Missing imageData for image search")
        
    # Lấy cookie mặc định
    cookie_data = get_default_pinterest_cookie()
    cookie_string = cookie_data.get("cookie_string") if isinstance(cookie_data, dict) else cookie_data
    if not cookie_string:
        raise Exception("No Pinterest cookie saved. Please save one in Pinterest Image page.")
        
    # Decode base64 image to temp file
    header, encoded = imageData.split(",", 1)
    image_bytes = base64.b64decode(encoded)
    
    ext = "jpg"
    if "image/png" in header: ext = "png"
    elif "image/webp" in header: ext = "webp"
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name
        
    try:
        # Run sync function in thread
        result = await asyncio.to_thread(
            upload_pin_sync,
            tmp_path, 
            cookie_string, 
            task.get("title") or "Image Search", 
            "", # description
            "", # link
            True, # headless
            2 # scroll_rounds
        )
        
        similar_pins_raw = result.get("similar_pins") or []
        pin_infos_display = [normalize_to_display(p, "pinterest") for p in similar_pins_raw]
        pin_infos_display.sort(key=lambda p: int(p.get("view_count") or 0), reverse=True)
        
        pinterest_likes = sum(
            int(p.get("reaction_count") or 0) + int(p.get("repin_count") or 0) + int(p.get("save_count") or 0)
            for p in similar_pins_raw
        )
        
        # Save history
        pins_by_source = {"pinterest": similar_pins_raw}
        keyword = task.get("title") or f"image_upload_{result.get('pin_id')}"
        history_id = await asyncio.to_thread(save_history, keyword, pins_by_source, "pinterest_image", task.get("projectId"))
        
        return {
            "total": len(pin_infos_display),
            "pins": pin_infos_display,
            "history_id": history_id,
            "pin_url": result.get("pin_url"),
            "pinterest_likes": pinterest_likes
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

async def execute_chat_create_image(task: dict):
    from create_image_by_ai.image_generator import generate_images
    
    prompt = task.get("keyword") or task.get("title")
    if not prompt:
        raise Exception("Missing prompt for image generation")
        
    images = await generate_images(
        prompt=prompt.strip(),
        model="imagen-3.0-generate-002",
        num_images=1
    )
    
    return {
        "images": images,
        "prompt": prompt
    }