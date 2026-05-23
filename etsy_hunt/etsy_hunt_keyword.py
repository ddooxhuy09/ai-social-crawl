"""
Etsy Hunt — Keyword crawl module.

Cung cấp:
  - Shared constants & utilities (BASE_DIR, STATUS_FILE, AUTH_FILE, _write_status, _save_auth)
  - crawl_keyword_pages(orig_url, headers) → list[dict]
  - save_keywords_csv(keyword, all_items) → Path
  - open_henull_keyword()  ← standalone entry point (keyword flow only)

Chạy trực tiếp:
  python etsy_hunt/etsy_hunt_keyword.py
"""

import asyncio
import csv
import json
import os
import random
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from undetected_playwright.async_api import async_playwright

# ── Shared constants ──────────────────────────────────────────────────────────
HENULL_LOGIN_URL = "https://www.henull.com/auth/login"
KEYWORD_API_PATH = "/api/keyword/keywords-research"
PRODUCT_API_PATH = "/api/product/list"
MAX_PAGE = 100

_BASE = (
    Path(sys.executable).parent / "etsy_hunt"
    if getattr(sys, "frozen", False)
    else Path(__file__).resolve().parent
)
BASE_DIR = _BASE
STATUS_FILE = BASE_DIR / "status.json"
AUTH_FILE = BASE_DIR / "henull_auth.json"
HISTORY_DIR = BASE_DIR.parent / "history" / "hunt" / "keyword"

def _keyword_history_dir(project_id: str = None) -> Path:
    if project_id:
        d = BASE_DIR.parent / "history" / "projects" / project_id / "original-phase" / "keyword"
    else:
        d = HISTORY_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d

KEYWORD_FIELD_MAPPING = [
    ("name", "keyword"),
    ("rec", "score"),
    ("is_long_tail", "is_long_tail"),
    ("favorites", "favorites"),
    ("competition", "competition"),
    ("sales", "sales"),
    ("favorites_monthly", "favorites_monthly"),
    ("reviews_monthly", "reviews_monthly"),
    ("reviews", "reviews"),
    ("sales_monthly", "sales_monthly"),
    ("views", "views"),
    ("views_monthly", "views_monthly"),
]


# ── Shared utilities ──────────────────────────────────────────────────────────

def _write_status(state: str, keyword: str | None = None, error: str | None = None, project_id: str = None) -> None:
    try:
        payload = {"state": state, "updated_at": datetime.now().isoformat()}
        if keyword:
            payload["keyword"] = keyword
        if error:
            payload["error"] = error
            
        status_file = BASE_DIR / f"status_{project_id}.json" if project_id else STATUS_FILE
        status_file.parent.mkdir(parents=True, exist_ok=True)
        status_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"[WARN] Không ghi status: {e}")


def _save_auth(headers: dict) -> None:
    """Lưu authorization/cookie/user-agent ra henull_auth.json để backend reuse."""
    try:
        auth_data = {
            "authorization": headers.get("authorization", ""),
            "cookie": headers.get("cookie", ""),
            "user-agent": headers.get("user-agent", ""),
            "saved_at": datetime.now().isoformat(),
        }
        AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
        AUTH_FILE.write_text(json.dumps(auth_data, ensure_ascii=False), encoding="utf-8")
        print(f"[AUTH] Đã lưu token auth → {AUTH_FILE}")
    except Exception as e:
        print(f"[WARN] Không lưu được auth: {e}")


# ── Keyword-specific logic ────────────────────────────────────────────────────

def save_keywords_csv(keyword: str, all_items: list, project_id: str = None) -> Path:
    """Lưu keyword items thành CSV trong history/hunt/ hoặc thư mục project, trả về Path."""
    target_dir = _keyword_history_dir(project_id)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = target_dir / f"etsy_keywords_{keyword}_{timestamp}.csv"
    csv_headers = [dest for _, dest in KEYWORD_FIELD_MAPPING]
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=csv_headers)
        writer.writeheader()
        for item in all_items:
            row = {dest: item.get(src, "") for src, dest in KEYWORD_FIELD_MAPPING}
            writer.writerow(row)
    print(f"\nĐã lưu CSV: {csv_path} ({len(all_items)} dòng)")
    
    # Gửi Telegram
    try:
        import sys
        from pathlib import Path
        _ROOT_DIR = str(Path(__file__).resolve().parent.parent)
        if _ROOT_DIR not in sys.path:
            sys.path.insert(0, _ROOT_DIR)
            
        from telegram_bot.notify import _send_telegram_sync
        import html
        import json
        from pathlib import Path
        
        p_name = "Crawl Page"
        if project_id:
            try:
                p_path = Path("history/projects") / f"{project_id}.json"
                if p_path.exists():
                    p_data = json.loads(p_path.read_text(encoding="utf-8"))
                    p_name = p_data.get("name", p_name)
            except Exception: pass
            
        msg = (
            f"✅ <b>[Etsy Hunt] Đã gặt xong lô Keyword!</b>\n"
            f"📁 Project: <b>{html.escape(p_name)}</b>\n"
            f"📍 Phase: <b>Original Phase (Step 1)</b>\n"
            f"🔍 Nguồn gốc: <b>{html.escape(keyword)}</b>\n"
            f"📦 Số lượng: {len(all_items)} từ khóa\n"
            f"👉 Trở lại app để kiểm tra kết quả ngay."
        )
        _send_telegram_sync(msg)
    except Exception as e:
        print(f"[TELEGRAM] Lỗi gửi báo cáo HEnull: {e}")
        
    return csv_path


async def crawl_keyword_pages(orig_url: str, headers: dict, project_id: str = None) -> list:
    """Crawl p=1..MAX_PAGE keyword pages từ captured URL, trả về list items."""
    parsed = urlparse(orig_url)
    qs = parse_qs(parsed.query)
    keyword = qs.get("kw", ["unknown"])[0]

    print(f"\nBắt đầu crawl keyword='{keyword}' từ p=1 đến p={MAX_PAGE}...\n")
    _write_status("crawling", keyword=keyword, project_id=project_id)

    all_items: list = []
    empty_streak = 0

    try:
        async with async_playwright() as p2:
            br = await p2.chromium.launch(headless=True)
            ctx = await br.new_context(ignore_https_errors=True)

            for page_idx in range(1, MAX_PAGE + 1):
                if page_idx > 1:
                    delay = random.uniform(0, 1)
                    print(f"  ... chờ {delay:.1f}s ...")
                    await asyncio.sleep(delay)

                qs["p"] = [str(page_idx)]
                new_query = urlencode(qs, doseq=True)
                new_url = urlunparse(parsed._replace(query=new_query))

                try:
                    resp = await ctx.request.get(new_url, headers=headers)
                    data = await resp.json()
                    items = data.get("data", {}).get("list", [])
                    count = len(items)
                    print(f"  p={page_idx}: {count} items (total: {len(all_items) + count})")

                    if count == 0:
                        empty_streak += 1
                        if empty_streak >= 3:
                            print(f"\n3 trang liên tiếp trống. Dừng tại p={page_idx}.")
                            break
                    else:
                        empty_streak = 0
                        all_items.extend(items)

                except Exception as e:
                    print(f"  p={page_idx}: LỖI - {e}")
                    empty_streak += 1
                    if empty_streak >= 3:
                        print(f"\n3 lần lỗi/trống liên tiếp. Dừng tại p={page_idx}.")
                        break

            await br.close()
    finally:
        _write_status("idle", project_id=project_id)

    print(f"\nCrawl xong! Tổng: {len(all_items)} keywords.")
    return all_items


async def open_henull_keyword(project_id: str = None) -> None:
    """Mở browser → user search keyword → crawl pages → lưu CSV."""
    proxy_server = os.getenv("PLAYWRIGHT_PROXY")
    captured_event = asyncio.Event()
    captured_info: dict = {}

    async with async_playwright() as p:
        launch_kwargs = {
            "headless": False,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
            ]
        }
        if proxy_server:
            launch_kwargs["proxy"] = {"server": proxy_server}
        browser = await p.chromium.launch(**launch_kwargs)
        context = await browser.new_context(
            ignore_https_errors=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )
        page = await context.new_page()

        def on_request(request) -> None:
            if captured_event.is_set():
                return
            if KEYWORD_API_PATH not in request.url:
                return
            qs_check = parse_qs(urlparse(request.url).query)
            kw = qs_check.get("kw", [""])[0].strip()
            if not kw:
                return
            print(f"\n[CAPTURED] keyword='{kw}' | {request.url}")
            captured_info["url"] = request.url
            captured_info["headers"] = dict(request.headers)
            captured_event.set()

        page.on("request", on_request)
        context.on("page", lambda new_page: new_page.on("request", on_request))

        for attempt in range(1, 4):
            try:
                print(f"[Attempt {attempt}/3] Đang mở {HENULL_LOGIN_URL} ...")
                await page.goto(HENULL_LOGIN_URL, timeout=60000, wait_until="domcontentloaded")
                break
            except Exception as e:
                print(f"  Lỗi: {e}")
                if attempt == 3:
                    raise
                await asyncio.sleep(5 * attempt)

        print(
            f"\nĐã mở {HENULL_LOGIN_URL}.\n"
            "- Đăng nhập HEnull trong cửa sổ browser.\n"
            "- Vào Etsy Keyword Tool và search bất kỳ keyword.\n"
            "- Script sẽ tự bắt API và đóng browser.\n"
        )
        await captured_event.wait()
        print("\nĐã bắt được keyword API. Đóng browser...")
        await browser.close()

    _save_auth(captured_info["headers"])

    all_items = await crawl_keyword_pages(captured_info["url"], captured_info["headers"], project_id=project_id)
    if all_items:
        kw = parse_qs(urlparse(captured_info["url"]).query).get("kw", ["unknown"])[0]
        save_keywords_csv(kw, all_items, project_id=project_id)


import argparse
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", type=str, default=None)
    args = parser.parse_args()
    asyncio.run(open_henull_keyword(args.project_id))
