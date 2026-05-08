"""
Telegram Notification Module (Integrated)
Gửi thông báo về Telegram mà không làm block Worker.
"""

import os
import urllib.request
import urllib.parse
import json
import html
import threading
import ssl

def _send_telegram_sync(message: str, image_url: str = None):
    """
    Hệ thống gọi ngầm hàm này ở một Thread khác để gửi API tới Telegram.
    Retry tối đa 3 lần nếu gặp lỗi network tạm thời.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("[TELEGRAM] Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong file .env")
        return
        
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    if not image_url:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "HTML"}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
    elif image_url.startswith("http"):
        url = f"https://api.telegram.org/bot{token}/sendPhoto"
        payload = json.dumps({"chat_id": chat_id, "caption": message, "parse_mode": "HTML", "photo": image_url}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
    elif image_url.startswith("data:image/"):
        import base64, uuid
        header, encoded = image_url.split(",", 1)
        mime_type = header.split(";")[0].replace("data:", "")
        ext = mime_type.split("/")[-1] if "/" in mime_type else "jpg"
        file_data = base64.b64decode(encoded)
        
        url = f"https://api.telegram.org/bot{token}/sendPhoto"
        boundary = uuid.uuid4().hex
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        
        body = bytearray()
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat_id}\r\n".encode("utf-8"))
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\n{message}\r\n".encode("utf-8"))
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"parse_mode\"\r\n\r\nHTML\r\n".encode("utf-8"))
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"image.{ext}\"\r\nContent-Type: {mime_type}\r\n\r\n".encode("utf-8"))
        body.extend(file_data)
        body.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))
        payload = body
    else:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "HTML"}).encode("utf-8")
        headers = {"Content-Type": "application/json"}

    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=payload, headers=headers)
            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                pass  # Lặng lẽ gửi
            return  # Gửi thành công
        except Exception as e:
            if attempt < 2:
                import time
                time.sleep(2 ** attempt)  # 1s, 2s
            else:
                print(f"[TELEGRAM] Gửi thất bại sau 3 lần thử: {e}")


def send_telegram(message: str, image_url: str = None):
    """
    Bắn tin nhắn thông qua một Thread riêng (Fire-and-forget), 
    tránh block event loop của FastAPI hoặc Worker.
    """
    import datetime
    now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    final_msg = f"{message}\n\n🕒 <i>Thời gian: {now_str}</i>"
    threading.Thread(target=_send_telegram_sync, args=(final_msg, image_url), daemon=True).start()


# ── Các hàm tiện ích ───────────────────────────────────────────

def notify_step1_done(project_name: str, image_url: str = None):
    """Gọi sau khi user hoàn thành việc chọn sản phẩm ở Step 1"""
    msg = (
        f"✅ <b>Step 1 hoàn thành!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"🎯 Đã chọn được Original Product."
    )
    send_telegram(msg, image_url=image_url)


def notify_ai_image_done(project_name: str, task_title: str, done: int, total: int):
    """Gọi khi hoàn thành vẽ ảnh AI bằng prompt"""
    all_done = (done >= total) and (total > 0)
    icon = "🎉" if all_done else "🖌"
    msg = (
        f"{icon} <b>[Redesign Step 2] Vừa render AI xong bức ảnh!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"🖼 Task: {html.escape(task_title)}\n"
        f"📊 Tiến độ hiện tại: {done}/{total}"
    )
    if all_done:
        msg += "\n✨ <b>Tất cả các task vẽ ảnh AI đã hoàn thành!</b>"
    send_telegram(msg)


def notify_crawl_start(project_name: str, keyword: str, start_date: str):
    """Báo cáo khi bắt đầu chạy task crawl"""
    msg = (
        f"🚀 <b>[Crawl Task] Đang bắt đầu chạy...</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"🔑 Keyword: <b>{html.escape(keyword)}</b>\n"
        f"🕒 Start: <b>{html.escape(start_date)}</b>\n"
        f"👉 Hệ thống đang crawl, vui lòng đợi nhé."
    )
    send_telegram(msg)


def notify_crawl_all_done(project_name: str, keyword: str, start_date: str, end_date: str, total_likes: int = 0):
    """Báo cáo 1 lần khi crawl xong hết nhóm crawl_keyword / image"""
    msg = (
        f"✅ <b>[Crawl Task] Đã hoàn thành!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"🔑 Keyword: <b>{html.escape(keyword)}</b>\n"
        f"🕒 Start: <b>{html.escape(start_date)}</b>\n"
        f"🏁 End: <b>{html.escape(end_date)}</b>\n"
    )
    if total_likes > 0:
        msg += f"❤️ Tổng Tương tác Pinterest (Save/Repin): <b>{total_likes:,}</b>\n"
    
    msg += f"👉 Trở lại app để kiểm tra kết quả."
    send_telegram(msg)


def notify_step3_done(project_name: str, filename: str):
    """Gọi sau khi xuất file báo cáo cuối cùng"""
    msg = (
        f"🎉 <b>Step 3 hoàn thành!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"📄 Báo cáo hệ thống xuất thành file: <code>{html.escape(filename)}</code>\n"
        f"👉 Tới project để tải ngay file Word về máy thôi."
    )
    send_telegram(msg)


def notify_listing_done(project_name: str, listing_name: str):
    """Báo cáo khi hoàn thiện 100% quy trình Etsy Listing"""
    msg = (
        f"🏆 <b>[Etsy Listing] Hoàn tất 100%!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"🛍 Listing: <b>{html.escape(listing_name)}</b>\n"
        f"👉 Đã có thể copy Draft để đăng bài."
    )
    send_telegram(msg)


def notify_error(project_name: str, step: str, error: str):
    """Báo cáo khẩn khi luồng bị dính lỗi Exception"""
    msg = (
        f"❌ <b>Lỗi phát sinh tại nhánh {html.escape(step)}!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"⚠️ Chi tiết mã lỗi:\n<code>{html.escape(str(error)[:400])}</code>"
    )
    send_telegram(msg)
