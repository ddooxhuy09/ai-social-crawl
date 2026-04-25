"""
Pinterest crawler: tìm kiếm pin theo keyword, lấy chi tiết pin, lấy related pins.

Kiến trúc "Early Close + Sync HTTP" (v3):
  • Phase 1 — Playwright (async): mở trình duyệt, scroll, thu thập pin ID, rút
    auth cookies và __PWS_DATA__ tokens. browser.close() được gọi NGAY SAU ĐÓ.
    Chạy qua _run_async() → event loop đóng hoàn toàn sau Phase 1.
  • Phase 2-4 — requests.Session (sync): toàn bộ lệnh gọi RelatedModulesResource
    và PinResource thực hiện qua requests (blocking I/O) — KHÔNG có asyncio event
    loop, KHÔNG có IOCP, KHÔNG thể bị ProactorEventLoop treo trên Windows.
    timeout=20 của requests hoạt động ở tầng OS socket, luôn luôn kích hoạt.
"""
import asyncio
import json
import math
import random
import time

import httpx
import requests as req_lib
from undetected_playwright.async_api import async_playwright

from crawlers.utils import _run_async
from crawlers.pinterest.utils import (
    _DEFAULT_HEADLESS,
    _DEFAULT_MAX_PINS,
    build_pin_info,
    collect_pin_ids_from_page,
    get_pws_context,
)


# ── Shared header builder ──────────────────────────────────────────────────────

def _api_headers(pws_ctx: dict, source_url: str = "/") -> dict:
    """Standard headers for Pinterest internal API calls."""
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{pws_ctx.get('origin', 'https://www.pinterest.com')}/",
        "x-app-version": pws_ctx.get("app_version", ""),
        "x-pinterest-appstate": "active",
        "x-pinterest-experimenthash": pws_ctx.get("experiment_hash", ""),
        "x-pinterest-source-url": source_url,
        "x-pinterest-pws-handler": pws_ctx.get("handler_id", ""),
    }


# ── Async httpx helpers (used by upload.py) ────────────────────────────────────

async def fetch_pin_detail_http(
    client: httpx.AsyncClient,
    pin_id: str,
    pws_ctx: dict,
) -> dict | None:
    """PinResource/get via httpx — used by upload.py."""
    origin = pws_ctx.get("origin", "https://www.pinterest.com").rstrip("/")
    source_url = f"/pin/{pin_id}/"
    payload = {
        "options": {
            "id": pin_id,
            "field_set_key": "detailed",
            "fetch_visual_search_objects": True,
        },
        "context": {},
    }
    params = {
        "source_url": source_url,
        "data": json.dumps(payload, separators=(",", ":")),
        "_": str(int(time.time() * 1000)),
    }
    r = await client.get(
        f"{origin}/resource/PinResource/get/",
        params=params,
        headers=_api_headers(pws_ctx, source_url),
        timeout=20.0,
    )
    r.raise_for_status()
    body = r.json()
    rr = body.get("resource_response") or {}
    return rr.get("data")


async def fetch_related_pins_http(
    client: httpx.AsyncClient,
    pin_id: str,
    pws_ctx: dict,
    max_related: int = 100,
    search_query: str = "",
) -> list[str]:
    """RelatedModulesResource/get via httpx — used by upload.py."""
    origin = pws_ctx.get("origin", "https://www.pinterest.com").rstrip("/")
    source_url = f"/pin/{pin_id}/"
    payload = {
        "options": {
            "additional_fields": ["pin.gen_ai_topics"],
            "pin_id": pin_id,
            "context_pin_ids": [],
            "context_near_dup_image_sigs": [],
            "page_size": max_related,
            "search_query": search_query or "",
            "source": "search",
            "top_level_source": "search",
            "top_level_source_depth": 1,
            "is_pdp": False,
        },
        "context": {},
    }
    params = {
        "source_url": source_url,
        "data": json.dumps(payload, separators=(",", ":")),
        "_": str(int(time.time() * 1000)),
    }
    r = await client.get(
        f"{origin}/resource/RelatedModulesResource/get/",
        params=params,
        headers=_api_headers(pws_ctx, source_url),
        timeout=20.0,
    )
    r.raise_for_status()
    body = r.json()
    rr = body.get("resource_response") or {}
    data = rr.get("data") or []
    if not isinstance(data, list):
        return []
    pins = [item for item in data if item and item.get("type") == "pin"]
    return [str(it["id"]) for it in pins[:max_related] if it.get("id")]


# ── Sync requests helpers (used by crawl_pins_sync Phase 2-4) ─────────────────

def _fetch_pin_detail_sync(
    session: req_lib.Session,
    pin_id: str,
    pws_ctx: dict,
) -> dict | None:
    """PinResource/get via requests.Session — immune to IOCP hang on Windows."""
    origin = pws_ctx.get("origin", "https://www.pinterest.com").rstrip("/")
    source_url = f"/pin/{pin_id}/"
    payload = {
        "options": {
            "id": pin_id,
            "field_set_key": "detailed",
            "fetch_visual_search_objects": True,
        },
        "context": {},
    }
    params = {
        "source_url": source_url,
        "data": json.dumps(payload, separators=(",", ":")),
        "_": str(int(time.time() * 1000)),
    }
    r = session.get(
        f"{origin}/resource/PinResource/get/",
        params=params,
        headers=_api_headers(pws_ctx, source_url),
        timeout=20,
    )
    r.raise_for_status()
    body = r.json()
    rr = body.get("resource_response") or {}
    return rr.get("data")


def _fetch_related_sync(
    session: req_lib.Session,
    pin_id: str,
    pws_ctx: dict,
    max_related: int = 100,
    search_query: str = "",
) -> list[str]:
    """RelatedModulesResource/get via requests.Session — immune to IOCP hang."""
    origin = pws_ctx.get("origin", "https://www.pinterest.com").rstrip("/")
    source_url = f"/pin/{pin_id}/"
    payload = {
        "options": {
            "additional_fields": ["pin.gen_ai_topics"],
            "pin_id": pin_id,
            "context_pin_ids": [],
            "context_near_dup_image_sigs": [],
            "page_size": max_related,
            "search_query": search_query or "",
            "source": "search",
            "top_level_source": "search",
            "top_level_source_depth": 1,
            "is_pdp": False,
        },
        "context": {},
    }
    params = {
        "source_url": source_url,
        "data": json.dumps(payload, separators=(",", ":")),
        "_": str(int(time.time() * 1000)),
    }
    r = session.get(
        f"{origin}/resource/RelatedModulesResource/get/",
        params=params,
        headers=_api_headers(pws_ctx, source_url),
        timeout=20,
    )
    r.raise_for_status()
    body = r.json()
    rr = body.get("resource_response") or {}
    data = rr.get("data") or []
    if not isinstance(data, list):
        return []
    pins = [item for item in data if item and item.get("type") == "pin"]
    return [str(it["id"]) for it in pins[:max_related] if it.get("id")]


# ── Phase 1: Playwright (async) ────────────────────────────────────────────────

async def _playwright_phase_async(
    keyword: str,
    max_pins: int = _DEFAULT_MAX_PINS,
    scroll_rounds: int = 5,
    headless: bool = _DEFAULT_HEADLESS,
) -> tuple | None:
    """
    Phase 1 only: open browser, scroll, collect pin IDs + cookies.
    Returns (pws_ctx, all_pin_ids, cookies_header) or None on failure.
    Event loop is closed by _run_async() immediately after this returns.
    """
    url = f"https://www.pinterest.com/search/pins/?q={keyword}&rs=typed"
    all_pin_ids: list[str] = []
    pws_ctx: dict | None = None
    cookies_header: str = ""

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        try:
            context = await browser.new_context()
            page = await context.new_page()

            await page.goto(url, wait_until="domcontentloaded")
            try:
                await page.wait_for_selector('a[href*="/pin/"]', timeout=15000)
            except Exception:
                pass
            await page.wait_for_timeout(1500)
            pws_ctx = await get_pws_context(page)

            print(f"📜 Scrolling {scroll_rounds} lần để load thêm pins...")
            for i in range(scroll_rounds):
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(1200)
                current_count = await page.eval_on_selector_all(
                    'a[href*="/pin/"]', "els => els.length"
                )
                print(f"   Round {i+1}/{scroll_rounds}: {current_count} link pin trong DOM")
                if max_pins != -1 and current_count >= max_pins * 2:
                    break

            all_pin_ids = await collect_pin_ids_from_page(page)

            raw_cookies = await context.cookies()
            cookies_header = "; ".join(
                f"{c['name']}={c['value']}" for c in raw_cookies
            )

        finally:
            try:
                await asyncio.wait_for(browser.close(), timeout=10.0)
                print("✅ Browser closed — bắt đầu requests phase.")
            except asyncio.TimeoutError:
                print("⚠️ browser.close() quá 10 s — tiếp tục mà không đóng sạch.")
            except Exception as e:
                print(f"⚠️ browser.close() lỗi (bỏ qua): {e}")

    if not pws_ctx:
        print("⚠️ Không lấy được __PWS_DATA__; dừng.")
        return None
    if not all_pin_ids:
        print("⚠️ Không tìm thấy pin nào.")
        return None

    print(f"✅ Phase 1: Lấy được {len(all_pin_ids)} pin id từ trang search.")
    print("Ví dụ:", ", ".join(all_pin_ids[:10]))
    return pws_ctx, all_pin_ids, cookies_header


# ── Phase 2-4: requests.Session (sync) ────────────────────────────────────────

def _http_phase_sync(
    keyword: str,
    pws_ctx: dict,
    all_pin_ids: list[str],
    cookies_header: str,
    max_pins: int = _DEFAULT_MAX_PINS,
    mode: str = "default",
    saves_min: int = 0,
    repins_min: int = 0,
) -> list[dict]:
    """
    Phase 2-4: all Pinterest API calls via requests.Session (blocking).
    No asyncio event loop → no IOCP → timeout=20 always fires on Windows.
    """
    if max_pins == -1:
        phase1_limit = 999999
        phase2_limit = 50
        print(f"📊 Mode MAX: Lấy toàn bộ seed pins, mỗi seed lấy {phase2_limit} related pins.")
    else:
        phase1_limit = max(1, math.ceil(math.sqrt(max_pins)))
        phase2_limit = max(1, math.ceil(max_pins / phase1_limit))
        print(f"📊 Dynamic Threshold (Limit={max_pins}): tối đa {phase1_limit} seeds, {phase2_limit} related/seed.")

    pin_infos: list[dict] = []
    related_debug: dict[str, list[str]] = {}

    session = req_lib.Session()
    session.headers.update({"Cookie": cookies_header})

    if mode in ("saves", "repins"):
        # ── Filter mode ────────────────────────────────────────────────────────
        threshold_field = "save_count" if mode == "saves" else "repin_count"
        threshold_val = saves_min if mode == "saves" else repins_min
        print(f"🔍 Mode: {mode} | ngưỡng {threshold_field} >= {threshold_val}")

        total_seeds = len(all_pin_ids)
        print(f"📥 Phase 2a: Lấy details {total_seeds} seed pins để filter...")
        filtered_seed_infos: list[dict] = []
        filtered_seed_ids: list[str] = []
        fetched_seed = 0
        for pid in all_pin_ids:
            time.sleep(random.uniform(0.4, 1.2))
            try:
                data = _fetch_pin_detail_sync(session, pid, pws_ctx)
            except Exception as exc:
                print(f"⚠️ Lỗi PinResource seed {pid}: {exc}")
                continue
            if not data:
                continue
            info = build_pin_info(data)
            fetched_seed += 1
            print(f"   ✅ Seed details: {fetched_seed}/{total_seeds}")
            if int(info.get(threshold_field) or 0) >= threshold_val:
                filtered_seed_infos.append(info)
                filtered_seed_ids.append(str(pid))
                if len(filtered_seed_ids) >= phase1_limit:
                    print(f"   🛑 Đã đủ {phase1_limit} seed pins pass điều kiện.")
                    break
        print(f"✅ Phase 2a: {len(filtered_seed_ids)}/{len(all_pin_ids)} seeds pass (>= {threshold_val})")

        print("🔁 Phase 2b: RelatedModulesResource cho seeds đã pass...")
        all_related_ids: list[str] = []
        for pid in filtered_seed_ids:
            time.sleep(random.uniform(0.6, 0.8))
            try:
                related_ids = _fetch_related_sync(
                    session, pid, pws_ctx, max_related=phase2_limit, search_query=keyword,
                )
            except Exception as exc:
                print(f"⚠️ Lỗi RelatedModulesResource cho pin {pid}: {exc}")
                continue
            if related_ids:
                related_debug[str(pid)] = related_ids
                all_related_ids.extend(related_ids)

        fetched_ids = set(filtered_seed_ids)
        unique_related_ids = list(dict.fromkeys(r for r in all_related_ids if r not in fetched_ids))

        total_related = len(unique_related_ids)
        print(f"📋 Phase 3: {total_related} related pins cần fetch.")
        fetched_related = 0
        for pid in unique_related_ids:
            time.sleep(random.uniform(0.4, 1.5))
            try:
                data = _fetch_pin_detail_sync(session, pid, pws_ctx)
            except Exception as exc:
                print(f"⚠️ Lỗi PinResource related {pid}: {exc}")
                continue
            if data:
                pin_infos.append(build_pin_info(data))
                fetched_related += 1
                print(f"   ✅ Related details: {fetched_related}/{total_related}")

        pin_infos = filtered_seed_infos + pin_infos

    else:
        # ── Default mode ───────────────────────────────────────────────────────
        seed_for_related = all_pin_ids[:phase1_limit]
        print(f"🔁 Phase 2: Gọi Related API cho {len(seed_for_related)} seed pins...")
        all_related_ids: list[str] = []
        for pid in seed_for_related:
            time.sleep(random.uniform(0.6, 0.8))
            try:
                related_ids = _fetch_related_sync(
                    session, pid, pws_ctx, max_related=phase2_limit, search_query=keyword,
                )
            except Exception as exc:
                print(f"⚠️ Lỗi RelatedModulesResource cho pin {pid}: {exc}")
                continue
            if related_ids:
                related_debug[str(pid)] = related_ids
                all_related_ids.extend(related_ids)

        target_ids = list(dict.fromkeys(seed_for_related + all_related_ids))
        for pid in all_pin_ids:
            if max_pins != -1 and len(target_ids) >= max_pins:
                break
            if pid not in target_ids:
                target_ids.append(pid)

        unique_pin_ids: list[str] = target_ids
        total_details = len(unique_pin_ids)
        print(f"📋 Phase 3: Tổng {total_details} pin id cần fetch details.")
        print("🔎 Phase 4: Gọi PinResource/get cho từng pin id...")
        fetched_details = 0
        for pid in unique_pin_ids:
            time.sleep(random.uniform(0.4, 1.5))
            try:
                data = _fetch_pin_detail_sync(session, pid, pws_ctx)
            except Exception as exc:
                print(f"⚠️ Lỗi PinResource cho pin {pid}: {exc}")
                continue
            if data:
                pin_infos.append(build_pin_info(data))
                fetched_details += 1
                print(f"   ✅ Pin details: {fetched_details}/{total_details}")

    # ── Dedup ──────────────────────────────────────────────────────────────────
    if pin_infos:
        unique: dict[str, dict] = {}
        for info in pin_infos:
            key = (
                str(info.get("pin_url") or "")
                or str(info.get("canonical_pin_id") or "")
            )
            if not key:
                key = repr(info)
            if key not in unique:
                unique[key] = info
        pin_infos = list(unique.values())

    print(f"✅ Hoàn tất: {len(pin_infos)} pins sau dedup.")
    return pin_infos




# ── Public sync entry point ────────────────────────────────────────────────────

def crawl_pins_sync(keyword: str, **kwargs) -> list[dict]:
    """
    Main sync entry point for Pinterest crawl.

    Phase 1 (Playwright) runs via _run_async → event loop fully closed after.
    Phase 2-4 (requests.Session) runs directly — no event loop, no IOCP,
    timeout=20 always fires even on Windows ProactorEventLoop environments.
    """
    max_pins = kwargs.get("max_pins", _DEFAULT_MAX_PINS)
    scroll_rounds = kwargs.get("scroll_rounds", 5)
    headless = kwargs.get("headless", _DEFAULT_HEADLESS)
    mode = kwargs.get("mode", "default")
    saves_min = kwargs.get("saves_min", 0)
    repins_min = kwargs.get("repins_min", 0)

    print(f"[Pinterest] Phase 1: Playwright crawl for '{keyword}'...")
    phase1 = _run_async(
        _playwright_phase_async(keyword, max_pins=max_pins, scroll_rounds=scroll_rounds, headless=headless)
    )
    if not phase1:
        return []

    pws_ctx, all_pin_ids, cookies_header = phase1
    print(f"[Pinterest] Phase 2-4: requests.Session HTTP calls...")
    return _http_phase_sync(
        keyword, pws_ctx, all_pin_ids, cookies_header,
        max_pins=max_pins, mode=mode, saves_min=saves_min, repins_min=repins_min,
    )


# ── open_pinterest_with_keyword (kept for direct async callers) ────────────────

async def open_pinterest_with_keyword(
    keyword: str,
    max_pins: int = _DEFAULT_MAX_PINS,
    scroll_rounds: int = 5,
    headless: bool = _DEFAULT_HEADLESS,
    mode: str = "default",
    saves_min: int = 0,
    repins_min: int = 0,
) -> list[dict]:
    """
    Async wrapper kept for callers that already have an event loop.
    NOTE: On Windows, prefer crawl_pins_sync() to avoid IOCP hang in Phase 2-4.
    """
    phase1 = await _playwright_phase_async(keyword, max_pins=max_pins, scroll_rounds=scroll_rounds, headless=headless)
    if not phase1:
        return []
    pws_ctx, all_pin_ids, cookies_header = phase1
    # Run sync HTTP phase in a thread to avoid blocking the caller's event loop
    import functools
    return await asyncio.to_thread(
        functools.partial(
            _http_phase_sync,
            keyword, pws_ctx, all_pin_ids, cookies_header,
            max_pins=max_pins, mode=mode, saves_min=saves_min, repins_min=repins_min,
        )
    )


if __name__ == "__main__":
    keyword = input("🔍 Nhập keyword để tìm kiếm trên Pinterest: ").strip()
    if keyword:
        print(f"🚀 Bắt đầu crawl với keyword: {keyword}")
        crawl_pins_sync(keyword)
    else:
        print("❌ Vui lòng nhập keyword!")
