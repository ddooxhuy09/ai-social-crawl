"""
Pinterest uploader: upload ảnh lên Pinterest qua internal web API + Playwright.

Flow:
  1. Register upload → lấy S3 credentials + upload_id
  2. POST multipart ảnh lên S3
  3. Poll VIPResource → lấy image_signature
  4. POST StoryPinResource/create → tạo pin
  5. VisualSearchFlashlightUnifiedResource → lấy pin tương tự
"""
import asyncio
import json
import time
import uuid
from pathlib import Path

import requests
from PIL import Image
from undetected_playwright.async_api import async_playwright

import random

from crawlers.pinterest.utils import build_pin_info, get_pws_context, parse_cookie_string
from crawlers.pinterest.crawler import fetch_pin_detail_via_page, fetch_related_pins_via_page


# ── JavaScript helpers (chạy bên trong browser context) ─────────────────────

_FETCH_POST_JS = """
async ({path, data}) => {
    const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    const body = new URLSearchParams();
    body.set('source_url', '/pin-creation-tool/');
    body.set('data', data);
    const r = await fetch(path, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-csrftoken': csrf,
            'x-requested-with': 'XMLHttpRequest',
            'x-pinterest-appstate': 'active',
            'x-pinterest-pws-handler': 'www/pin-creation-tool.js',
            'x-pinterest-source-url': '/pin-creation-tool/',
            'accept': 'application/json, text/javascript, */*, q=0.01',
        },
        body: body.toString(),
        credentials: 'same-origin',
    });
    return {status: r.status, body: await r.json()};
}
"""

_FETCH_GET_JS = """
async ({url}) => {
    const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    const r = await fetch(url, {
        credentials: 'same-origin',
        headers: {
            'x-csrftoken': csrf,
            'x-requested-with': 'XMLHttpRequest',
            'x-pinterest-appstate': 'active',
            'x-pinterest-pws-handler': 'www/pin-creation-tool.js',
            'x-pinterest-source-url': '/pin-creation-tool/',
            'accept': 'application/json, text/javascript, */*, q=0.01',
        }
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch(e) { body = {_raw: text}; }
    return {status: r.status, body: body};
}
"""

_FETCH_VISUAL_SEARCH_JS = """
async ({url, source_url}) => {
    const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    const r = await fetch(url, {
        credentials: 'same-origin',
        headers: {
            'accept': 'application/json, text/javascript, */*, q=0.01',
            'x-csrftoken': csrf,
            'x-requested-with': 'XMLHttpRequest',
            'x-pinterest-appstate': 'active',
            'x-pinterest-pws-handler': 'www/pin/[id]/visual-search.js',
            'x-pinterest-source-url': source_url,
        }
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch(e) { body = {_raw: text}; }
    return {status: r.status, body: body};
}
"""

# Camera/Lens: POST image bytes directly — works for brand-new images not yet in Pinterest's index
_VISUAL_SEARCH_UPLOAD_JS = """
async ({b64, mime, crop_json, source_url, pws_handler}) => {
    const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
    const raw = atob(b64);
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    const blob = new Blob([u8], {type: mime});
    const fd = new FormData();
    fd.append('source_url', source_url);
    fd.append('data', JSON.stringify({
        options: {
            crop: JSON.parse(crop_json),
            crop_source: 0,
            entry_source: 'file',
            entrypoint: 'search_bar',
            field_set_key: 'shopping_grid_item',
            is_shopping: false,
        },
        context: {}
    }));
    fd.append('image', blob, 'query.jpg');
    const r = await fetch('/resource/VisualSearchUploadResource/create/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'x-csrftoken': csrf,
            'x-requested-with': 'XMLHttpRequest',
            'x-pinterest-appstate': 'active',
            'x-pinterest-source-url': source_url,
            'x-pinterest-pws-handler': pws_handler,
            'accept': 'application/json, text/javascript, */*, q=0.01',
        },
        body: fd,
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch(e) { body = {_raw: text}; }
    return {status: r.status, body: body};
}
"""


# ── Internal API helpers ─────────────────────────────────────────────────────

async def _pint_post(page, path: str, options: dict) -> dict:
    return await page.evaluate(
        _FETCH_POST_JS,
        {"path": path, "data": json.dumps({"options": options, "context": {}})},
    )


async def _pint_get(page, path: str) -> dict:
    return await page.evaluate(_FETCH_GET_JS, {"url": path})


# ── Step 1: Register upload ──────────────────────────────────────────────────

async def register_upload(page) -> tuple[str, dict]:
    local_id = str(uuid.uuid4())
    result = await _pint_post(page, "/resource/ApiResource/create/", {
        "url": "/v3/media/uploads/register/batch/",
        "data": {
            "media_info_list": json.dumps([{
                "id": local_id,
                "media_type": "image-story-pin",
            }])
        },
    })
    if result["status"] != 200:
        raise RuntimeError(f"Register upload thất bại: HTTP {result['status']}")
    rr = result["body"]["resource_response"]
    if rr.get("status") != "success":
        raise RuntimeError(f"Register upload lỗi: {rr.get('message')}")
    data = rr["data"]
    upload_info = data.get(local_id) or list(data.values())[0]
    return upload_info["upload_id"], upload_info


# ── Step 2: Upload ảnh lên S3 ────────────────────────────────────────────────

def upload_image_to_s3(upload_info: dict, image_path: str) -> None:
    upload_url = upload_info["upload_url"]
    params = upload_info["upload_parameters"]

    image_bytes = Path(image_path).read_bytes()
    filename = Path(image_path).name
    ext = Path(image_path).suffix.lower().lstrip(".")
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
    mime = mime_map.get(ext, "image/jpeg")

    files = {k: (None, v) for k, v in params.items()}
    files["file"] = (filename, image_bytes, mime)

    resp = requests.post(
        upload_url,
        files=files,
        headers={
            "origin": "https://www.pinterest.com",
            "referer": "https://www.pinterest.com/",
        },
        timeout=60,
    )
    if resp.status_code not in (200, 204):
        raise RuntimeError(f"S3 upload thất bại: HTTP {resp.status_code}\n{resp.text[:500]}")


# ── Step 3: Poll VIPResource để lấy image_signature ─────────────────────────

async def poll_image_signature(page, upload_id: str, max_retries: int = 15) -> str:
    import urllib.parse

    data_param = urllib.parse.quote(json.dumps({
        "options": {"upload_ids": [str(upload_id)]},
        "context": {},
    }))

    for attempt in range(max_retries):
        ts = int(time.time() * 1000)
        url = (
            f"https://www.pinterest.com/resource/VIPResource/get/"
            f"?source_url=%2Fpin-creation-tool%2F"
            f"&data={data_param}"
            f"&_={ts}"
        )
        result = await _pint_get(page, url)
        if result["status"] == 200:
            body = result["body"]
            if "_raw" in body:
                print(f"   Lần {attempt + 1}: response không phải JSON: {body['_raw'][:100]}")
                await asyncio.sleep(2)
                continue
            rr = body.get("resource_response", {})
            data = rr.get("data") or {}
            item = data.get(str(upload_id)) or (list(data.values())[0] if data else {})
            status = item.get("status", "")
            sig = item.get("signature") or item.get("image_signature")
            if sig:
                return sig
            print(f"   Lần {attempt + 1}: status={status}, chờ thêm...")
        else:
            print(f"   Lần {attempt + 1}: HTTP {result['status']}, chờ thêm...")
        await asyncio.sleep(2)

    raise RuntimeError(f"Timeout: không lấy được image_signature sau {max_retries} lần thử")


# ── Step 4: Tạo pin ──────────────────────────────────────────────────────────

async def create_pin(
    page,
    image_signature: str,
    upload_id: str,
    img_width: int,
    img_height: int,
    title: str = "",
    description: str = "",
    link: str = "",
) -> dict:
    story_pin = {
        "metadata": {
            "pin_title": title,
            "pin_image_signature": image_signature,
            "canvas_aspect_ratio": 1,
        },
        "pages": [{
            "blocks": [{
                "block_style": {"height": 100, "width": 100, "x_coord": 0, "y_coord": 0},
                "image_signature": image_signature,
                "tracking_id": str(upload_id),
                "type": 2,
            }],
            "clips": [{
                "clip_type": 0,
                "end_time_ms": -1,
                "is_converted_from_image": False,
                "source_media_height": img_height,
                "source_media_width": img_width,
                "start_time_ms": -1,
            }],
            "layout": 0,
            "style": {"background_color": "#000000"},
        }],
    }

    result = await _pint_post(page, "/resource/StoryPinResource/create/", {
        "alt_text": "",
        "allow_shopping_rec": True,
        "description": description,
        "is_comments_allowed": True,
        "is_removable": False,
        "is_unified_builder": True,
        "link": link,
        "orbac_subject_id": "",
        "story_pin": json.dumps(story_pin),
        "user_mention_tags": "[]",
    })

    if result["status"] != 200:
        raise RuntimeError(f"StoryPinResource/create thất bại: HTTP {result['status']}")
    rr = result["body"]["resource_response"]
    if rr.get("status") != "success":
        raise RuntimeError(f"Tạo pin lỗi: {rr.get('message')}\n{json.dumps(rr, ensure_ascii=False)[:500]}")
    return rr["data"]


# ── Step 5: Visual similar search ────────────────────────────────────────────

async def get_visual_similar_pins(
    page, pin_id: str, image_signature: str, scroll_rounds: int = 1
) -> list:
    import urllib.parse

    source_url = f"/pin/{pin_id}/visual-search/?cropSource=5&entrypoint=closeup_cta"
    base_options = {
        "crop": {"x": 0, "y": 0, "w": 1, "h": 1},
        "crop_source": 5,
        "entry_source": "flashlight",
        "entrypoint": "closeup_cta",
        "field_set_key": "shopping_grid_item",
        "image_signature": image_signature,
        "is_shopping": False,
        "pin_id": pin_id,
    }
    encoded_source = urllib.parse.quote(source_url)
    all_results: list = []
    bookmark: str | None = None

    print(f"🔍 Visual search (flashlight): sẽ fetch {scroll_rounds} trang...")
    for round_idx in range(max(1, scroll_rounds)):
        options = dict(base_options)
        if bookmark:
            options["bookmarks"] = [bookmark]
        data_param = urllib.parse.quote(json.dumps({"options": options, "context": {}}))
        ts = int(time.time() * 1000)
        url = (
            f"https://www.pinterest.com/resource/VisualSearchFlashlightUnifiedResource/get/"
            f"?source_url={encoded_source}"
            f"&data={data_param}"
            f"&_={ts}"
        )
        result = await page.evaluate(_FETCH_VISUAL_SEARCH_JS, {"url": url, "source_url": source_url})
        if result["status"] != 200:
            if not all_results:
                raise RuntimeError(f"VisualSearch thất bại: HTTP {result['status']}")
            break
        body = result["body"]
        if "_raw" in body:
            if not all_results:
                raise RuntimeError(f"VisualSearch response không phải JSON: {body['_raw'][:200]}")
            break
        rr = body.get("resource_response", {})
        if rr.get("status") != "success":
            if not all_results:
                raise RuntimeError(f"VisualSearch lỗi: {rr.get('message')}")
            break
        page_results = rr.get("data", {}).get("results", [])
        all_results.extend(page_results)
        if not page_results:
            data_obj = rr.get("data") or {}
            print(f"   Trang {round_idx + 1}: 0 pin — endpoint={rr.get('endpoint_name')}, metadata={json.dumps(rr.get('metadata') or {})[:200]}, data_keys={list(data_obj.keys())[:10]}, full_rr={json.dumps(rr)[:400]}")
        else:
            print(f"   Trang {round_idx + 1}: +{len(page_results)} pin (tổng {len(all_results)})")
        bookmark = rr.get("bookmark")
        if not bookmark or not page_results:
            break
        await asyncio.sleep(0.8)

    return all_results


async def get_visual_similar_pins_by_image(
    page, image_path: str, scroll_rounds: int = 1
) -> list:
    """Fallback: upload raw image bytes to Pinterest's camera/lens visual search.
    Works for brand-new images not yet indexed by Pinterest's visual ML pipeline.
    """
    import base64, urllib.parse

    image_bytes = Path(image_path).read_bytes()
    b64 = base64.b64encode(image_bytes).decode()
    ext = Path(image_path).suffix.lower().lstrip(".")
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
    mime = mime_map.get(ext, "image/jpeg")
    crop = json.dumps({"x": 0, "y": 0, "w": 1, "h": 1})
    source_url = "/"
    pws_handler = "www/index.js"

    all_results: list = []
    print(f"🔍 Visual search (camera upload): sẽ fetch {scroll_rounds} trang...")
    for round_idx in range(max(1, scroll_rounds)):
        result = await page.evaluate(
            _VISUAL_SEARCH_UPLOAD_JS,
            {"b64": b64, "mime": mime, "crop_json": crop,
             "source_url": source_url, "pws_handler": pws_handler},
        )
        status = result["status"]
        body = result["body"]
        if status != 200:
            print(f"   Camera upload status {status}: {json.dumps(body)[:300]}")
            break
        if "_raw" in body:
            print(f"   Camera upload non-JSON: {body['_raw'][:200]}")
            break
        rr = body.get("resource_response", {})
        if rr.get("status") != "success":
            print(f"   Camera upload error: {rr.get('message')} — {json.dumps(rr)[:300]}")
            break
        page_results = rr.get("data", {}).get("results", [])
        all_results.extend(page_results)
        if not page_results:
            print(f"   Trang {round_idx + 1}: 0 pin — endpoint={rr.get('endpoint_name')}, metadata={json.dumps(rr.get('metadata') or {})[:200]}")
            break
        print(f"   Trang {round_idx + 1}: +{len(page_results)} pin (tổng {len(all_results)})")
        bookmark = rr.get("bookmark")
        if not bookmark:
            break
        await asyncio.sleep(0.8)
    return all_results


# ── Public API ────────────────────────────────────────────────────────────────

async def upload_pin(
    page,
    image_path: str,
    title: str = "",
    description: str = "",
    link: str = "",
    scroll_rounds: int = 1,
) -> dict:
    """
    Upload ảnh và tạo pin trên page đã navigate tới pin-creation-tool.

    Trả về:
        {
            "pin_id": str,
            "pin_url": str,
            "image_signature": str,
            "similar_pin_ids": list[str],
        }
    """
    with Image.open(image_path) as img:
        img_width, img_height = img.size

    upload_id, upload_info = await register_upload(page)
    upload_image_to_s3(upload_info, image_path)
    image_signature = await poll_image_signature(page, upload_id)
    if not image_signature:
        raise RuntimeError("Không lấy được image_signature")
    pin_data = await create_pin(page, image_signature, upload_id, img_width, img_height, title, description, link)
    pin_id = pin_data.get("id")
    print(f"✅ Pin tạo xong: {pin_id}, chờ index...")

    # Navigate to the pin page so context is correct
    pin_page_url = f"https://www.pinterest.com/pin/{pin_id}/"
    await page.goto(pin_page_url, wait_until="domcontentloaded", timeout=90_000)
    actual_url = page.url
    if f"/pin/{pin_id}/" not in actual_url:
        print(f"⚠️ Redirect detected ({actual_url[:80]}), retrying navigation...")
        await asyncio.sleep(5)
        await page.goto(pin_page_url, wait_until="domcontentloaded", timeout=90_000)

    # Wait for Pinterest to process the new pin
    print(f"   image_signature: {image_signature}")
    await page.wait_for_timeout(3_000)
    pws_ctx = await get_pws_context(page)

    # Try flashlight search once — rarely works for brand new pins
    similar_pins = await get_visual_similar_pins(page, pin_id, image_signature, scroll_rounds=scroll_rounds)

    if not similar_pins:
        print("   ⚠️ Không tìm được pin tương tự — ảnh chưa được index bởi Pinterest ML.")
        print("   🔄 Fallback: lấy Related pins theo pin_id...")
        try:
            related_ids = await fetch_related_pins_via_page(
                page, pin_id, pws_ctx, max_related=scroll_rounds * 25, search_query=title
            )
            similar_pin_ids = [str(r) for r in related_ids if r]
            print(f"   Related pins: {len(similar_pin_ids)} pin ID")
        except Exception as exc:
            print(f"   ⚠️ Lỗi Related pins: {exc}")
            similar_pin_ids = []
    else:
        similar_pin_ids = [p.get("id") for p in similar_pins if p.get("id")]
    print(f"📌 Visual search xong: {len(similar_pin_ids)} pin ID. Đang fetch chi tiết...")

    similar_pin_infos: list[dict] = []
    if pws_ctx and similar_pin_ids:
        for i, sid in enumerate(similar_pin_ids, 1):
            await asyncio.sleep(random.uniform(0.4, 1.0))
            try:
                data = await fetch_pin_detail_via_page(page, sid, pws_ctx)
            except Exception as exc:
                print(f"⚠️ Lỗi PinResource cho pin {sid}: {exc}")
                continue
            if data:
                similar_pin_infos.append(build_pin_info(data))
        print(f"✅ Fetch chi tiết xong: {len(similar_pin_infos)}/{len(similar_pin_ids)} pin")

    return {
        "pin_id": pin_id,
        "pin_url": f"https://www.pinterest.com/pin/{pin_id}/",
        "image_signature": image_signature,
        "similar_pin_ids": similar_pin_ids,
        "similar_pins": similar_pin_infos,
    }


def upload_pin_sync(
    image_path: str,
    cookie_string: str,
    title: str = "",
    description: str = "",
    link: str = "",
    headless: bool = False,
    scroll_rounds: int = 1,
) -> dict:
    """Sync wrapper cho upload_pin."""
    async def _run():
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=headless)
            ctx = await browser.new_context()
            ctx.set_default_navigation_timeout(90_000)
            ctx.set_default_timeout(90_000)
            await ctx.add_cookies(parse_cookie_string(cookie_string))
            page = await ctx.new_page()
            try:
                await page.goto("https://www.pinterest.com/pin-creation-tool/", wait_until="domcontentloaded", timeout=90_000)
                await page.wait_for_timeout(3000)
                logged_in = await page.evaluate("() => document.cookie.includes('_auth=1')")
                if not logged_in:
                    raise RuntimeError("Cookie hết hạn hoặc không hợp lệ")
                return await upload_pin(page, image_path, title, description, link, scroll_rounds=scroll_rounds)
            finally:
                await browser.close()

    return asyncio.run(_run())
