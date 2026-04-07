"""
Etsy Hunt — Product crawl module.

Cung cấp:
  - PRODUCT_COLUMNS
  - save_product_results(search_key, all_items)
  - crawl_products(captured_url, headers, base_body, search_key) → list[dict]
  - open_henull_product()  ← standalone entry point (product flow only)

Host được lấy động từ captured_url — không hardcode.

Chạy trực tiếp:
  python etsy_hunt/etsy_hunt_product.py
"""

import asyncio
import csv
import json
import os
import random
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from undetected_playwright.async_api import async_playwright

# ── Shared imports from keyword module ───────────────────────────────────────
try:
    from etsy_hunt.etsy_hunt_keyword import (
        HENULL_LOGIN_URL,
        PRODUCT_API_PATH,
        MAX_PAGE,
        BASE_DIR,
        _write_status,
        _save_auth,
    )
except ImportError:
    from etsy_hunt_keyword import (
        HENULL_LOGIN_URL,
        PRODUCT_API_PATH,
        MAX_PAGE,
        BASE_DIR,
        _write_status,
        _save_auth,
    )

PRODUCT_HISTORY_DIR = BASE_DIR.parent / "history" / "hunt" / "product"

# ── Product constants ─────────────────────────────────────────────────────────
PRODUCT_COLUMNS = [
    "product_id", "title", "logo_url", "product_url", "price", "currency_code",
    "release_time", "sales_total", "monthly_sales", "reviews",
    "favorites", "is_pick", "is_bestsell", "hightlights",
    "ships_from", "store_name", "tags", "store_rating", "reviews_weekly",
    "favorites_weekly", "reviews_month", "favorites_month", "total_sales",
]


def _product_history_dir(project_id: str = None) -> Path:
    if project_id:
        d = BASE_DIR.parent / "history" / "projects" / project_id / "original-phase" / "product"
    else:
        d = BASE_DIR.parent / "history" / "hunt" / "product"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── Product-specific logic ────────────────────────────────────────────────────

def save_product_results(search_key: str, all_items: list, project_id: str = None) -> None:
    """Lọc các cột cần thiết, lưu CSV vào history/hunt/product/ hoặc thư mục project."""
    filtered = [{col: item.get(col) for col in PRODUCT_COLUMNS} for item in all_items]

    # Export CSV
    history_dir = _product_history_dir(project_id)
    safe_key = search_key.replace(" ", "_") if search_key else "unknown"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = history_dir / f"etsy_products_{safe_key}_{timestamp}.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=PRODUCT_COLUMNS)
        writer.writeheader()
        for item in filtered:
            row = {
                col: (
                    "|".join(str(t) for t in item[col])
                    if isinstance(item.get(col), list)
                    else item.get(col, "")
                )
                for col in PRODUCT_COLUMNS
            }
            writer.writerow(row)

    print(f"\n[PRODUCTS] Lưu {len(filtered)} sản phẩm → {csv_path}")

    # Gửi Telegram (Cách ly độc lập khỏi FastAPI db.py để tránh lỗi thư viện chéo)
    try:
        import sys
        from pathlib import Path
        _ROOT_DIR = str(Path(__file__).resolve().parent.parent)
        if _ROOT_DIR not in sys.path:
            sys.path.insert(0, _ROOT_DIR)
            
        from projects.telegram_notify import _send_telegram_sync
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
            f"✅ <b>[Etsy Hunt] Đã gặt xong lô Sản phẩm!</b>\n"
            f"📁 Project: <b>{html.escape(p_name)}</b>\n"
            f"📍 Phase: <b>Original Phase (Step 1)</b>\n"
            f"🛒 Keyword: <b>{html.escape(search_key)}</b>\n"
            f"📦 Số lượng: {len(filtered)} sản phẩm\n"
            f"👉 Mở app để chọn sản phẩm gốc ngay."
        )
        _send_telegram_sync(msg)
    except Exception as e:
        print(f"[TELEGRAM] Lỗi gửi báo cáo HEnull: {e}")


async def crawl_products(
    captured_url: str,
    headers: dict,
    base_body: dict,
    search_key: str,
    project_id: str = None,
) -> list:
    """Crawl p=1..MAX_PAGE product pages.
    Dùng host từ captured_url (không hardcode) — nếu host thay đổi vẫn hoạt động."""
    parsed = urlparse(captured_url)
    product_list_url = f"{parsed.scheme}://{parsed.netloc}{PRODUCT_API_PATH}"

    req_headers = dict(headers)
    req_headers["content-type"] = "application/json"

    all_items: list = []
    empty_streak = 0
    _write_status("crawling_products", keyword=search_key, project_id=project_id)

    try:
        async with async_playwright() as p2:
            br = await p2.chromium.launch(headless=True)
            ctx = await br.new_context(ignore_https_errors=True)

            for page_idx in range(1, MAX_PAGE + 1):
                if page_idx > 1:
                    delay_s = random.uniform(0.5, 1.5)
                    print(f"  ... chờ {delay_s:.1f}s ...")
                    await asyncio.sleep(delay_s)

                body = {
                    **base_body,
                    "page_num": page_idx,
                    "is_first": "true" if page_idx == 1 else "false",
                }

                try:
                    resp = await ctx.request.post(
                        product_list_url, headers=req_headers, data=json.dumps(body)
                    )
                    data = await resp.json()
                    items = data.get("data", {}).get("list", [])
                    count = len(items)
                    print(
                        f"  p={page_idx}: {count} sp | code={data.get('code')} "
                        f"(tổng: {len(all_items) + count})"
                    )

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
                        print(f"\n3 lần lỗi liên tiếp. Dừng tại p={page_idx}.")
                        break

            await br.close()

    finally:
        save_product_results(search_key, all_items, project_id)
        _write_status("idle", project_id=project_id)

    return all_items


async def open_henull_product(project_id: str = None) -> None:
    """Mở browser → user search product → crawl pages → lưu JSON."""
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
            if PRODUCT_API_PATH not in request.url:
                return
            if request.method != "POST":
                return
            try:
                body = json.loads(request.post_data or "{}")
                search_key = body.get("search_key", "").strip()
                if not search_key:
                    return
            except Exception:
                return
            hdrs = dict(request.headers)
            if not hdrs.get("authorization"):
                return
            print(f"\n[CAPTURED] product API | {request.url}")
            captured_info["url"] = request.url
            captured_info["headers"] = hdrs
            captured_info["body"] = body
            captured_info["search_key"] = search_key
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
            "- Vào Product Research và search bất kỳ keyword.\n"
            "- Script sẽ tự bắt API và đóng browser.\n"
        )
        await captured_event.wait()
        print("\nĐã bắt được product API. Đóng browser...")
        await browser.close()

    _save_auth(captured_info["headers"])
    await crawl_products(
        captured_info["url"],
        captured_info["headers"],
        captured_info["body"],
        captured_info["search_key"],
        project_id
    )


import argparse
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", type=str, default=None)
    args, _ = parser.parse_known_args()
    asyncio.run(open_henull_product(args.project_id))
