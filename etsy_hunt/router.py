import asyncio
import csv
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter(tags=["etsy_hunt"])

# ── Paths ─────────────────────────────────────────────────────────────────────

def _etsy_hunt_base() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "etsy_hunt"
    return Path(__file__).resolve().parent

HISTORY_DIR = Path("history")
ETSY_HUNT_HISTORY_DIR = HISTORY_DIR / "hunt" / "keyword"
ETSY_HUNT_PRODUCT_HISTORY_DIR = HISTORY_DIR / "hunt" / "product"
ETSY_HUNT_STATUS_FILE = _etsy_hunt_base() / "status.json"

def _get_status_file(project_id: str = None) -> Path:
    return _etsy_hunt_base() / f"status_{project_id}.json" if project_id else ETSY_HUNT_STATUS_FILE

from etsy_hunt.etsy_hunt_keyword import (
    _keyword_history_dir, crawl_keyword_pages, save_keywords_csv,
    _save_auth, HENULL_LOGIN_URL, KEYWORD_API_PATH, PRODUCT_API_PATH,
)
from etsy_hunt.etsy_hunt_product import _product_history_dir, crawl_products
ETSY_HUNT_PROMPTS_FILE = _etsy_hunt_base() / "prompts.json"

NER_ATTRS = [
    "Màu sắc", "Kích thước", "Hoa văn", "Khác",
    "Chất liệu", "Tính năng/hiệu quả", "Đối tượng",
    "Phong cách/kiểu dáng", "Cảnh",
    "Từ theo mùa/sự kiện đặc biệt", "Dòng sản phẩm/mô hình bổ sung",
]

class ProductListRequest(BaseModel):
    search_key: str = ""
    category: str = ""
    price: str = ""
    sales_weekly: str = ""
    sales: str = ""
    favorites: str = ""
    favorites_weekly: str = ""
    reviews: str = ""
    reviews_weekly: str = ""
    product_type: str = ""
    listed_time: str = ""
    country: str = ""
    page_num: int = 1
    page_size: int = 20



@router.websocket("/ws/henull-browser")
async def henull_browser_ws(
    websocket: WebSocket,
    mode: str = "product",
    project_id: str = None,
):
    """
    Stream Playwright browser → user thao tác login + search → bắt API.
    mode: "product" | "keyword"
    """
    await websocket.accept()
    stop = asyncio.Event()
    captured_event = asyncio.Event()
    captured_info: dict = {}

    try:
        from undetected_playwright.async_api import async_playwright
        from urllib.parse import parse_qs, urlparse
        import json as _j

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=False)
            context = await browser.new_context(
                ignore_https_errors=True,
                viewport={"width": 1280, "height": 800},
            )
            page = await context.new_page()

            def on_request(req):
                if captured_event.is_set():
                    return
                if mode == "keyword":
                    if KEYWORD_API_PATH not in req.url:
                        return
                    kw = parse_qs(urlparse(req.url).query).get("kw", [""])[0].strip()
                    if not kw:
                        return
                    captured_info.update({"type": "keyword", "url": req.url, "headers": dict(req.headers)})
                else:
                    if PRODUCT_API_PATH not in req.url or req.method != "POST":
                        return
                    hdrs = dict(req.headers)
                    if not hdrs.get("authorization"):
                        return
                    try:
                        body = _j.loads(req.post_data or "{}")
                        sk = body.get("search_key", "").strip()
                        if not sk:
                            return
                    except Exception:
                        return
                    captured_info.update({"type": "product", "url": req.url, "headers": hdrs, "body": body, "search_key": sk})
                captured_event.set()
                stop.set()

            page.on("request", on_request)
            context.on("page", lambda pg: pg.on("request", on_request))
            await page.goto(HENULL_LOGIN_URL, timeout=60000, wait_until="domcontentloaded")

            # Task 1: stream screenshots
            async def send_screenshots():
                while not stop.is_set():
                    try:
                        shot = await page.screenshot(type="jpeg", quality=60)
                        await websocket.send_bytes(shot)
                    except Exception:
                        stop.set()
                        return
                    await asyncio.sleep(0.05)

            # Task 2: receive input events from user
            async def recv_input():
                while not stop.is_set():
                    try:
                        msg = await websocket.receive()
                        if msg["type"] == "websocket.disconnect":
                            stop.set()
                            return
                        text = msg.get("text")
                        if not text:
                            continue
                        ev = _j.loads(text)
                        t = ev.get("type")
                        if t == "mousemove":
                            await page.mouse.move(ev["x"], ev["y"])
                        elif t == "click":
                            await page.mouse.click(ev["x"], ev["y"])
                        elif t == "scroll":
                            await page.mouse.wheel(ev.get("deltaX", 0), ev.get("deltaY", 0))
                        elif t == "keydown":
                            await page.keyboard.down(ev["key"])
                        elif t == "keyup":
                            await page.keyboard.up(ev["key"])
                        elif t == "type":
                            await page.keyboard.type(ev["text"])
                    except WebSocketDisconnect:
                        stop.set()
                        return
                    except Exception:
                        pass

            t1 = asyncio.create_task(send_screenshots())
            t2 = asyncio.create_task(recv_input())
            await stop.wait()
            t1.cancel()
            t2.cancel()
            await asyncio.gather(t1, t2, return_exceptions=True)
            await browser.close()

        if not captured_event.is_set():
            return  # user disconnected without capturing

        _save_auth(captured_info["headers"])
        await websocket.send_text(json.dumps({"type": "captured", "mode": captured_info["type"]}))

        # Start crawl in background
        from urllib.parse import parse_qs, urlparse
        if captured_info["type"] == "keyword":
            async def _crawl_kw():
                items = await crawl_keyword_pages(captured_info["url"], captured_info["headers"], project_id)
                if items:
                    kw = parse_qs(urlparse(captured_info["url"]).query).get("kw", ["unknown"])[0]
                    save_keywords_csv(kw, items, project_id)
            asyncio.create_task(_crawl_kw())
        else:
            asyncio.create_task(crawl_products(
                captured_info["url"], captured_info["headers"],
                captured_info["body"], captured_info["search_key"], project_id,
            ))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


@router.get("/api/etsy_hunt/status")
async def get_etsy_hunt_status(project_id: str = None):
    status_file = _get_status_file(project_id)
    if not status_file.exists(): return {"state": "idle"}
    try:
        data = json.loads(status_file.read_text(encoding="utf-8"))
        return {"state": data.get("state", "idle"), "keyword": data.get("keyword"), "updated_at": data.get("updated_at")}
    except Exception: return {"state": "idle"}

@router.get("/api/etsy_hunt/history")
async def list_etsy_hunt_history(project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    if not hist_dir.exists(): return []
    return [{"filename": f.name, "size_kb": round(f.stat().st_size / 1024, 1),
             "created_at": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")}
            for f in sorted(hist_dir.glob("*.csv"), reverse=True)]

@router.get("/api/etsy_hunt/history/{filename}")
async def get_etsy_hunt_csv(filename: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    filepath = hist_dir / filename
    if not filepath.exists() or not filepath.suffix == ".csv": raise HTTPException(status_code=404)
    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader: rows.append(row)
    return {"filename": filename, "total": len(rows), "rows": rows}

@router.delete("/api/etsy_hunt/history/{filename}")
async def delete_etsy_hunt_csv(filename: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    filepath = hist_dir / filename
    if filepath.exists(): filepath.unlink()
    return {"ok": True}

@router.get("/api/etsy_hunt/history/{filename}/download")
async def download_etsy_hunt_csv(filename: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    filepath = hist_dir / filename
    if not filepath.exists(): raise HTTPException(status_code=404)
    return Response(content=filepath.read_bytes(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

@router.get("/api/etsy_hunt/product_results")
async def get_product_results(project_id: str = None):
    prod_dir = _product_history_dir(project_id)
    csvs = sorted(prod_dir.glob("*.csv"), reverse=True)
    if not csvs: raise HTTPException(status_code=404, detail="Chưa có kết quả.")
    filepath = csvs[0]
    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader: rows.append(row)
    return {"list": rows, "filename": filepath.name}

@router.get("/api/etsy_hunt/product_history")
async def list_etsy_hunt_product_history(project_id: str = None):
    prod_dir = _product_history_dir(project_id)
    return [{"filename": f.name, "size_kb": round(f.stat().st_size / 1024, 1),
             "created_at": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")}
            for f in sorted(prod_dir.glob("*.csv"), reverse=True)]

@router.get("/api/etsy_hunt/product_history/{filename}")
async def get_etsy_hunt_product_csv(filename: str, project_id: str = None):
    prod_dir = _product_history_dir(project_id)
    filepath = prod_dir / filename
    if not filepath.exists(): raise HTTPException(status_code=404)
    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader: rows.append(row)
    return {"filename": filename, "total": len(rows), "rows": rows}

@router.delete("/api/etsy_hunt/product_history/{filename}")
async def delete_etsy_hunt_product_csv(filename: str, project_id: str = None):
    prod_dir = _product_history_dir(project_id)
    filepath = prod_dir / filename
    if filepath.exists(): filepath.unlink()
    return {"ok": True}

@router.get("/api/etsy_hunt/product_history/{filename}/download")
async def download_etsy_hunt_product_csv(filename: str, project_id: str = None):
    prod_dir = _product_history_dir(project_id)
    filepath = prod_dir / filename
    if not filepath.exists(): raise HTTPException(status_code=404)
    return Response(content=filepath.read_bytes(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

@router.post("/api/etsy_hunt/products")
async def get_etsy_hunt_products(req_data: ProductListRequest):
    auth_file = _etsy_hunt_base() / "henull_auth.json"
    if not auth_file.exists(): raise HTTPException(status_code=403, detail="Chưa có token auth.")
    auth = json.loads(auth_file.read_text(encoding="utf-8"))
    api_url = os.getenv("HENULL_PRODUCT_API_URL", "https://lzgawl7j.realnull.com/api/product/list")
    headers = {
        "authorization": auth.get("authorization", ""),
        "content-type": "application/json",
        "cookie": auth.get("cookie", ""),
        "user-agent": auth.get("user-agent", ""),
        "referer": os.getenv("HENULL_REFERER", "https://lzgawl7j.realnull.com/iframe/etsy-product-research"),
    }
    async with httpx.AsyncClient(verify=False) as client:
        resp = await client.post(api_url, json=req_data.model_dump(), headers=headers)
        return resp.json()
