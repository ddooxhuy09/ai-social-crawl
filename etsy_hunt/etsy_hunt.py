"""
Etsy Hunt — Main orchestrator.

Mở một browser duy nhất rồi bắt API từ HOẶC Keyword Tool HOẶC Product Research.
  - Bắt được keyword API → crawl keyword pages → lưu CSV
  - Bắt được product API → crawl product pages → lưu JSON

Re-export các constants/utilities để các module khác (backend_main.py v.v.)
vẫn có thể import từ etsy_hunt.etsy_hunt như cũ.

Chạy trực tiếp:
  python etsy_hunt/etsy_hunt.py
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from undetected_playwright.async_api import async_playwright

# ── Re-export shared symbols (backward-compatible) ────────────────────────────
try:
    from etsy_hunt.etsy_hunt_keyword import (  # noqa: F401  (re-exported)
        HENULL_LOGIN_URL,
        KEYWORD_API_PATH,
        PRODUCT_API_PATH,
        MAX_PAGE,
        BASE_DIR,
        STATUS_FILE,
        AUTH_FILE,
        HISTORY_DIR,
        _write_status,
        _save_auth,
        save_keywords_csv,
        crawl_keyword_pages,
    )
    from etsy_hunt.etsy_hunt_product import (  # noqa: F401  (re-exported)
        PRODUCT_COLUMNS,
        save_product_results,
        crawl_products,
    )
except ImportError:
    from etsy_hunt_keyword import (  # noqa: F401  (re-exported)
        HENULL_LOGIN_URL,
        KEYWORD_API_PATH,
        PRODUCT_API_PATH,
        MAX_PAGE,
        BASE_DIR,
        STATUS_FILE,
        AUTH_FILE,
        HISTORY_DIR,
        _write_status,
        _save_auth,
        save_keywords_csv,
        crawl_keyword_pages,
    )
    from etsy_hunt_product import (  # noqa: F401  (re-exported)
        PRODUCT_COLUMNS,
        save_product_results,
        crawl_products,
    )


import argparse

async def open_henull_login(headless: bool = False) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", type=str, default=None)
    parser.add_argument("--run-etsy-hunt", action="store_true")
    args, _ = parser.parse_known_args()
    project_id = args.project_id
    
    """
    Unified entry point:
      1. Mở browser → user đăng nhập + search trên Keyword Tool HOẶC Product Research.
      2. Bắt API request đầu tiên (keyword hoặc product).
      3. Lưu auth token.
      4. Dispatch đến đúng crawl function.
    """
    proxy_server = os.getenv("PLAYWRIGHT_PROXY")
    captured_event = asyncio.Event()
    captured_info: dict = {}

    async with async_playwright() as p:
        launch_kwargs = {"headless": headless}

        browser = await p.chromium.launch(**launch_kwargs)
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        def on_request(request) -> None:
            if captured_event.is_set():
                return

            if KEYWORD_API_PATH in request.url:
                qs_check = parse_qs(urlparse(request.url).query)
                kw = qs_check.get("kw", [""])[0].strip()
                if not kw:
                    return
                print(f"\n[CAPTURED] keyword='{kw}' | {request.url}")
                captured_info["type"] = "keyword"
                captured_info["url"] = request.url
                captured_info["headers"] = dict(request.headers)
                captured_event.set()

            elif PRODUCT_API_PATH in request.url and request.method == "POST":
                hdrs = dict(request.headers)
                if not hdrs.get("authorization"):
                    return
                try:
                    body = json.loads(request.post_data or "{}")
                    if not body.get("search_key", "").strip():
                        return
                except Exception:
                    return
                print(f"\n[CAPTURED] product API | {request.url}")
                captured_info["type"] = "product"
                captured_info["url"] = request.url
                captured_info["headers"] = hdrs
                captured_info["body"] = body
                captured_info["search_key"] = body["search_key"].strip()
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
            "- Truy cập Etsy Keyword Tool HOẶC Product Research và search bất kỳ.\n"
            "- Script sẽ tự bắt API request, đóng browser, và lưu token.\n"
        )

        await captured_event.wait()
        print("\nĐã bắt được API request. Đóng browser...")
        await browser.close()

    # Save auth for backend reuse
    _save_auth(captured_info["headers"])

    if captured_info["type"] == "keyword":
        all_items = await crawl_keyword_pages(captured_info["url"], captured_info["headers"], project_id)
        if all_items:
            kw = parse_qs(urlparse(captured_info["url"]).query).get("kw", ["unknown"])[0]
            save_keywords_csv(kw, all_items, project_id)

    else:  # product
        search_key = captured_info["search_key"]
        print(f"\nBắt đầu crawl products cho '{search_key}'...")
        await crawl_products(
            captured_info["url"],
            captured_info["headers"],
            captured_info["body"],
            search_key,
            project_id
        )


if __name__ == "__main__":
    asyncio.run(open_henull_login())
