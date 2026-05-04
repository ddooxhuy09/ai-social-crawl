import asyncio
import csv
import json
import os
import random
import tempfile
import time
from io import StringIO
from pathlib import Path
from typing import List

import requests as req_lib

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from crawlers import (
    crawl_pins_sync,
    crawl_instagram_all_sync,
    crawl_tiktok_sync,
    crawl_reddit_sync,
    crawl_youtube_sync,
    upload_pin_sync,
)
from history_utils import (
    save_history,
    load_history_data,
    normalize_to_display,
    HISTORY_DIR,
    CRAWL_DIR,
    IMAGE_DIR,
    _safe_keyword_for_path,
    delete_history,
)

router = APIRouter(tags=["crawlers"])

# ── Constants ──────────────────────────────────────────────────────────────────

CRAWL_SOURCES: tuple[str, ...] = ("pinterest", "instagram", "tiktok", "reddit", "youtube")
PINTEREST_COOKIE_PATH = Path("cookies_pinterest/cookie_1.json")
PINTEREST_COOKIE_CACHE_PATH = Path("cookies_pinterest/cookie_check_cache.json")
_COOKIE_CACHE_TTL = 300  # seconds — reuse browser result for 5 min


# ── Pydantic Models ────────────────────────────────────────────────────────────

class KeywordRequest(BaseModel):
    keyword: str
    project_id: str | None = None
    sources: list[str] | None = None
    limit_per_source: int | str | None = None
    pinterest_scroll_rounds: int | None = None
    pinterest_headless: bool | None = None
    pinterest_mode: str | None = None
    pinterest_saves_min: int | None = None
    pinterest_repins_min: int | None = None


class PinInfo(BaseModel):
    """Common display schema — each platform fills different subsets of fields."""
    pin_url: str
    canonical_pin_id: str
    title: str
    description: str
    image_url: str
    created_at: str
    tracked_link: str
    pinner_username: str
    pinner_full_name: str
    board_name: str
    board_url: str
    link: str
    hashtags: str
    source: str = "pinterest"
    content_type: str = ""
    # Pinterest: save, like, reaction, repin, comment, share
    # TikTok: like, comment, save, share, view (playCount)
    # Instagram: like, comment (content_type: photo | reel)
    # YouTube: view, like, comment
    save_count: int = 0
    like_count: int = 0
    reaction_count: int = 0
    repin_count: int = 0
    comment_count: int = 0
    share_count: int = 0
    view_count: int = 0


class SearchResponse(BaseModel):
    keyword: str
    total: int
    pins: List[PinInfo]
    pins_by_source: dict[str, List[dict]] | None = None
    history_id: str | None = None


class HistoryItem(BaseModel):
    id: str
    keyword: str
    created_at: str
    total: int
    pinterest_count: int = 0
    instagram_count: int = 0
    tiktok_count: int = 0
    reddit_count: int = 0
    youtube_count: int = 0


class PinterestUploadSearchResponse(BaseModel):
    pin_id: str
    pin_url: str
    image_signature: str
    similar_pin_ids: List[str]
    similar_pins: List[PinInfo]
    history_id: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _counts_by_source(data: dict) -> dict[str, int]:
    by_src = data.get("pins_by_source") or {}
    if by_src:
        counts = {}
        for k, v in by_src.items():
            if not v:
                continue
            if k in ("instagram_photo", "instagram_reels"):
                counts["instagram"] = counts.get("instagram", 0) + len(v)
            else:
                counts[k] = len(v)
        return counts
    if "pinterest_count" in data:
        ig = int(data.get("instagram_count", 0))
        ig += int(data.get("instagram_photo_count", 0))
        ig += int(data.get("instagram_reels_count", 0))
        return {
            "pinterest": int(data.get("pinterest_count", 0)),
            "instagram": ig,
            "tiktok": int(data.get("tiktok_count", 0)),
            "reddit": int(data.get("reddit_count", 0)),
            "youtube": int(data.get("youtube_count", 0)),
        }
    return {}


def _make_history_item(history_id: str, info_path: Path) -> "HistoryItem | None":
    """Read a single info.json and return a HistoryItem, or None on error."""
    try:
        with info_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        counts = _counts_by_source(data)
        return HistoryItem(
            id=history_id,
            keyword=data.get("keyword", ""),
            created_at=data.get("created_at", ""),
            total=int(data.get("total", 0)),
            pinterest_count=counts.get("pinterest", 0),
            instagram_count=counts.get("instagram", 0),
            tiktok_count=counts.get("tiktok", 0),
            reddit_count=counts.get("reddit", 0),
            youtube_count=counts.get("youtube", 0),
        )
    except Exception:
        return None


def load_history_meta(project_id: str | None = None) -> List[HistoryItem]:
    from history_utils import get_history_bases

    # ── Project-scoped: read history_ids directly from project tasks (no dir scan) ──
    if project_id:
        from projects.db import _get_project
        from fastapi import HTTPException as _HTTPException
        base = get_history_bases(project_id)[0]
        items: List[HistoryItem] = []
        seen: set = set()

        # Primary: pull history_ids from task results — O(n) direct reads
        try:
            project = _get_project(project_id)
            for phase in ("redesign", "original"):
                for task in project.get(phase, {}).get("tasks", []):
                    hid = (task.get("result") or {}).get("history_id")
                    if not hid or hid in seen:
                        continue
                    seen.add(hid)
                    info_path = base / hid / "info.json"
                    if not info_path.exists():
                        continue
                    item = _make_history_item(hid, info_path)
                    if item:
                        items.append(item)
        except _HTTPException:
            pass

        # Fallback: scan only the project-scoped folder for items not yet in tasks
        # (covers data saved before history_id was written to task result)
        if base.exists():
            for folder in base.iterdir():
                if not folder.is_dir() or folder.name in seen:
                    continue
                info_path = folder / "info.json"
                if not info_path.exists():
                    continue
                item = _make_history_item(folder.name, info_path)
                if item:
                    items.append(item)
                    seen.add(folder.name)

        items.sort(key=lambda x: x.created_at, reverse=True)
        return items

    # ── Global (no project_id): full scan as before ──────────────────────────────
    items = []
    seen = set()
    for base in get_history_bases(None):
        if not base.exists():
            continue
        for folder in sorted(base.iterdir()):
            if not folder.is_dir() or folder.name in seen:
                continue
            info_path = folder / "info.json"
            if not info_path.exists():
                continue
            item = _make_history_item(folder.name, info_path)
            if item:
                items.append(item)
                seen.add(folder.name)
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


def load_history_detail(history_id: str, sort_by: str | None = None) -> SearchResponse:
    try:
        data = load_history_data(history_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="History not found")
    pins = data.get("pins") or []
    pins_by_source = data.get("pins_by_source")
    if sort_by == "view_count":
        pins = sorted(pins, key=lambda p: int(p.get("view_count") or 0), reverse=True)
    return SearchResponse(
        keyword=data.get("keyword", ""),
        total=int(data.get("total", len(pins))),
        pins=pins,
        pins_by_source=pins_by_source,
    )


def build_history_csv(history_id: str) -> tuple[bytes, str]:
    try:
        data = load_history_data(history_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="History not found")
    pins = data.get("pins") or []
    keyword = data.get("keyword", "pins")
    safe_name = _safe_keyword_for_path(keyword)
    filename = f"pins_{safe_name}.csv"

    if not pins:
        out = StringIO()
        w = csv.DictWriter(out, fieldnames=["pin_url"], lineterminator="\n")
        w.writeheader()
        csv_str = out.getvalue()
    else:
        fieldnames = list(pins[0].keys())
        out = StringIO()
        w = csv.DictWriter(out, fieldnames=fieldnames, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        w.writerows(pins)
        csv_str = out.getvalue()

    return csv_str.encode("utf-8-sig"), filename


# ── Routes: History ────────────────────────────────────────────────────────────

@router.get("/api/history", response_model=List[HistoryItem])
async def list_history(project_id: str | None = None) -> List[HistoryItem]:
    """List all past crawl sessions (metadata only)."""
    return await asyncio.to_thread(load_history_meta, project_id)


@router.get("/api/history/{history_id}", response_model=SearchResponse)
async def get_history(history_id: str, sort_by: str | None = None) -> SearchResponse:
    """Load a past crawl by ID. Use ?sort_by=view_count to sort by views."""
    return await asyncio.to_thread(load_history_detail, history_id, sort_by)


@router.get("/api/history/{history_id}/download")
async def download_history_csv(history_id: str) -> Response:
    """Download crawl history as UTF-8-BOM CSV."""
    csv_bytes, filename = await asyncio.to_thread(build_history_csv, history_id)
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/api/proxy-images")
async def proxy_images(body: dict):
    """Fetch external images server-side (bypasses browser CORS) and return base64 data URLs."""
    import httpx, base64, mimetypes
    urls: list[str] = body.get("urls", [])
    if not urls:
        raise HTTPException(status_code=400, detail="urls required")
    if len(urls) > 20:
        raise HTTPException(status_code=400, detail="Max 20 images per request")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.pinterest.com/",
    }

    async def fetch_one(url: str) -> str:
        if url.startswith("data:"):
            # Already a data URL (manually uploaded image) — return as-is
            return url
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                r = await client.get(url, headers=headers)
                r.raise_for_status()
                content_type = r.headers.get("content-type", "image/jpeg").split(";")[0].strip()
                b64 = base64.b64encode(r.content).decode()
                return f"data:{content_type};base64,{b64}"
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch {url}: {e}")

    results = await asyncio.gather(*[fetch_one(u) for u in urls])
    return {"images": list(results)}


@router.delete("/api/history/{history_id}")
async def delete_history_endpoint(history_id: str) -> dict:
    """Delete a crawl history folder permanently."""
    try:
        await asyncio.to_thread(delete_history, history_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="History not found")
    return {"status": "deleted"}


# ── Routes: Search ─────────────────────────────────────────────────────────────

# Remove active_searches as we now use file-based queue
# active_searches: dict[str, asyncio.Task] = {}

@router.post("/api/search")
async def create_search(req: KeywordRequest):
    """
    Tạo task crawl mới và thêm vào hàng đợi (queue.json).
    Worker ngầm sẽ tự động lấy ra xử lý tuần tự.
    """
    from projects.db import _load_queue, _save_queue
    import time
    import uuid

    kw = req.keyword
    if not kw:
        raise HTTPException(status_code=400, detail="Keyword is required")
        
    # Tạo đối tượng Task
    task_id = f"task_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    new_task = {
        "id": task_id,
        "projectId": req.project_id or "global",
        "projectName": "Global Search" if not req.project_id else f"Project {req.project_id[:8]}",
        "type": "crawl_keyword",
        "title": f"Crawl: {kw}",
        "keyword": kw,
        "sources": req.sources or list(CRAWL_SOURCES),
        "limit_per_source": req.limit_per_source or "max",
        "status": "pending",
        "phaseName": "redesign", # Mặc định
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    
    # Lưu vào queue.json
    queue_data = _load_queue()
    queue_data["tasks"].append(new_task)
    _save_queue(queue_data)
    
    print(f"[API] Task {task_id} added to queue for {kw}")
    return {"status": "queued", "task_id": task_id, "message": "Task has been added to the queue"}


# ── Routes: Pinterest Cookie & Upload ──────────────────────────────────────────

@router.get("/api/pinterest/default_cookie")
def get_default_pinterest_cookie():
    """Return the saved default Pinterest cookie string."""
    if not PINTEREST_COOKIE_PATH.exists():
        raise HTTPException(status_code=404, detail="Chưa có cookie mặc định")
    data = json.loads(PINTEREST_COOKIE_PATH.read_text(encoding="utf-8"))
    return {"cookie_string": data.get("cookie_string", "")}


def _normalize_cookie_input(raw: str) -> str:
    """Accept either a plain cookie string or a browser-extension JSON export.

    Browser extensions (e.g. EditThisCookie, Cookie-Editor) export cookies as:
      {"url": "...", "cookies": [{"name": "csrftoken", "value": "abc", ...}, ...]}
    This converts that format to a plain semicolon-separated cookie string.
    """
    stripped = raw.strip()
    if not stripped.startswith("{"):
        return raw
    try:
        data = json.loads(stripped)
        cookies = data.get("cookies", [])
        if not cookies:
            return raw
        return "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("name"))
    except Exception:
        return raw


@router.post("/api/pinterest/save_cookie")
def save_default_pinterest_cookie(cookie_string: str = Form(...)):
    """Save a Pinterest cookie string to disk. Accepts both plain cookie strings
    and browser-extension JSON exports."""
    normalized = _normalize_cookie_input(cookie_string)
    PINTEREST_COOKIE_PATH.parent.mkdir(exist_ok=True)
    PINTEREST_COOKIE_PATH.write_text(
        json.dumps({"cookie_string": normalized}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    PINTEREST_COOKIE_CACHE_PATH.unlink(missing_ok=True)
    return {"ok": True}


@router.get("/api/pinterest/check_cookie")
async def check_pinterest_cookie():
    """Validate the saved Pinterest cookie by launching a real browser session."""
    if not PINTEREST_COOKIE_PATH.exists():
        return {"valid": False, "reason": "no_cookie"}

    data = json.loads(PINTEREST_COOKIE_PATH.read_text(encoding="utf-8"))
    cookie_str = data.get("cookie_string", "")
    if not cookie_str.strip():
        return {"valid": False, "reason": "empty_cookie"}

    # Return cached result if fresh enough (avoids relaunching browser on every poll)
    if PINTEREST_COOKIE_CACHE_PATH.exists():
        try:
            cache = json.loads(PINTEREST_COOKIE_CACHE_PATH.read_text(encoding="utf-8"))
            if time.time() - cache.get("cached_at", 0) < _COOKIE_CACHE_TTL:
                return {k: v for k, v in cache.items() if k != "cached_at"}
        except Exception:
            pass

    result = await asyncio.to_thread(_check_cookie_with_browser, cookie_str)
    try:
        PINTEREST_COOKIE_CACHE_PATH.write_text(
            json.dumps({**result, "cached_at": time.time()}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass
    return result


def _check_cookie_with_browser(cookie_str: str) -> dict:
    """Launch a headless browser, inject cookies, and verify Pinterest login."""
    from undetected_playwright.sync_api import sync_playwright
    from crawlers.pinterest.utils import parse_cookie_string

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/131.0.0.0 Safari/537.36"
                    ),
                )
                context.add_cookies(parse_cookie_string(cookie_str))
                page = context.new_page()

                resp = page.goto("https://www.pinterest.com", wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(2000)

                current_url = page.url
                if "pinterest.com/login" in current_url or "pinterest.com/auth" in current_url:
                    return {"valid": False, "reason": "expired"}

                if resp and resp.status in (301, 302, 401, 403):
                    return {"valid": False, "reason": "expired"}

                is_auth = page.evaluate("() => document.cookie.includes('_auth=1')")
                if not is_auth:
                    return {"valid": False, "reason": "expired"}

                return {"valid": True}

            finally:
                browser.close()

    except Exception as exc:
        return {"valid": False, "reason": "network_error", "detail": str(exc)}


@router.post("/api/pinterest/upload_and_search", response_model=PinterestUploadSearchResponse)
async def pinterest_upload_and_search(
    file: UploadFile = File(..., description="Ảnh cần upload lên Pinterest"),
    title: str = Form("", description="Tiêu đề pin (tuỳ chọn)"),
    description: str = Form("", description="Mô tả pin (tuỳ chọn)"),
    link: str = Form("", description="Link đính kèm pin (tuỳ chọn)"),
    cookie_string: str = Form("", description="Cookie string (để trống = dùng cookie đã lưu)"),
    headless: bool = Form(True, description="Chạy trình duyệt ẩn (True) hay hiện (False)"),
    scroll_rounds: int = Form(2, description="Số lần phân trang (mỗi lần ~25 pin)"),
):
    """
    Upload ảnh lên Pinterest, tạo pin, rồi lấy danh sách pin tương tự (visual search).
    Kết quả được lưu vào history.
    """
    if not cookie_string.strip():
        try:
            saved = get_default_pinterest_cookie()
            cookie_string = saved.get("cookie_string", "")
        except Exception:
            pass
    if not cookie_string.strip():
        raise HTTPException(status_code=400, detail="Chưa có cookie Pinterest. Vui lòng lưu cookie trước.")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Vui lòng gửi file ảnh (image/*).")

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File ảnh rỗng.")

    ext = (file.filename or "image.jpg").rsplit(".", 1)[-1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name

    try:
        result = await asyncio.to_thread(
            upload_pin_sync,
            tmp_path, cookie_string, title, description, link, headless, scroll_rounds,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload thất bại: {e}")
    finally:
        os.unlink(tmp_path)

    similar_pins_raw = result.get("similar_pins") or []
    pin_infos_display = [normalize_to_display(p, "pinterest") for p in similar_pins_raw]

    pins_by_source = {"pinterest": similar_pins_raw}
    keyword = title or f"image_upload_{result['pin_id']}"
    history_id = await asyncio.to_thread(save_history, keyword, pins_by_source, "pinterest_image")

    return PinterestUploadSearchResponse(
        pin_id=result["pin_id"],
        pin_url=result["pin_url"],
        image_signature=result["image_signature"],
        similar_pin_ids=result["similar_pin_ids"],
        similar_pins=pin_infos_display,
        history_id=history_id or "",
    )
