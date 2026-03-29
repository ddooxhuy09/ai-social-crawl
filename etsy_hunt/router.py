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
from fastapi import APIRouter, HTTPException, Request
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

from etsy_hunt.etsy_hunt_keyword import _keyword_history_dir
from etsy_hunt.etsy_hunt_product import _product_history_dir
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


# ── Reverse Proxy: HEnull ─────────────────────────────────────────────────────

PROXY_TARGETS = {
    "main": "https://www.henull.com",
    "tool": "https://lzgawl7j.realnull.com",
}
PROXY_URL_MAP = {v: f"/api/henull_proxy/{k}" for k, v in PROXY_TARGETS.items()}

_INJECT_SCRIPT_TPL = (
    "<script>(function(){"
    "var M={'https://www.henull.com':'/api/henull_proxy/main',"
    "'https://lzgawl7j.realnull.com':'/api/henull_proxy/tool'};"
    "var P='__PFX__';"
    "function rw(u){"
    "if(!u||typeof u!=='string')return u;"
    "for(var k in M){if(u.indexOf(k)===0)return M[k]+u.slice(k.length);}"
    "if(u.indexOf('/')===0 && u.indexOf('/api/henull_proxy/')!==0)return P+u;"
    "return u;"
    "}"
    "var oF=window.fetch.bind(window);"
    "window.fetch=function(i,n){return oF(typeof i==='string'?rw(i):i,n);};"
    "var oO=XMLHttpRequest.prototype.open;"
    "XMLHttpRequest.prototype.open=function(m,u){"
    "return oO.apply(this,[m,rw(u)].concat([].slice.call(arguments,2)));};"
    "function ph(f){return function(s,t,u){"
    "if(u&&u[0]==='/'&&u.indexOf('/api/')!==0)u=P+u;"
    "return f.call(this,s,t,u);};}"
    "if(history.pushState){history.pushState=ph(history.pushState);}"
    "if(history.replaceState){history.replaceState=ph(history.replaceState);}"
    "})();</script>"
)

_SKIP_REQ_HEADERS = {"host", "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "te"}
_SKIP_RESP_HEADERS = {
    "content-encoding", "content-length", "transfer-encoding",
    "x-frame-options", "content-security-policy",
    "content-security-policy-report-only", "strict-transport-security",
}

def _rewrite_content(text: str, prefix: str) -> str:
    """Rewrite absolute URLs and escaped absolute URLs in text/js/css."""
    for orig, proxy in PROXY_URL_MAP.items():
        text = text.replace(orig, proxy)
        text = text.replace(orig.replace("/", "\\/"), proxy.replace("/", "\\/"))
    return text

def _rewrite_html(html: str, prefix: str) -> str:
    html = _rewrite_content(html, prefix)
    inject = _INJECT_SCRIPT_TPL.replace("__PFX__", prefix)
    lo = html.lower()
    if "<head>" in lo:
        idx = lo.index("<head>") + 6
        html = html[:idx] + inject + html[idx:]
    elif "<body>" in lo:
        idx = lo.index("<body>") + 6
        html = html[:idx] + inject + html[idx:]
    else:
        html = inject + html
    return html

async def _run_keyword_crawl_bg(orig_url: str, headers: dict, project_id: str = None) -> None:
    try:
        from etsy_hunt.etsy_hunt_keyword import crawl_keyword_pages, save_keywords_csv
        items = await crawl_keyword_pages(orig_url, headers, project_id)
        if items:
            kw = parse_qs(urlparse(orig_url).query).get("kw", ["unknown"])[0]
            save_keywords_csv(kw, items, project_id)
    except Exception as e:
        print(f"[proxy crawl] lỗi: {e}")

@router.api_route(
    "/api/henull_proxy/{target}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
)
async def henull_proxy(target: str, path: str, request: Request):
    if target not in PROXY_TARGETS:
        raise HTTPException(status_code=404, detail="Invalid proxy target")

    base = PROXY_TARGETS[target]
    target_url = f"{base}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    # Forward headers
    fwd: dict = {}
    for k, v in request.headers.items():
        kl = k.lower()
        if kl in _SKIP_REQ_HEADERS: continue
        if kl == "origin": fwd["origin"] = base
        elif kl == "referer":
            for pfx_key in PROXY_TARGETS:
                pfx = f"/api/henull_proxy/{pfx_key}"
                if pfx in v:
                    v = v.replace(str(request.base_url).rstrip("/") + pfx, PROXY_TARGETS[pfx_key])
                    v = v.replace(pfx, PROXY_TARGETS[pfx_key])
            fwd["referer"] = v
        else: fwd[k] = v
    fwd["host"] = base.replace("https://", "").replace("http://", "")

    body = await request.body()

    # Capture auth for keyword hunt
    from etsy_hunt.etsy_hunt_keyword import KEYWORD_API_PATH, PRODUCT_API_PATH, _save_auth
    auth = request.headers.get("authorization", "")
    if auth:
        if KEYWORD_API_PATH in target_url and request.method == "GET":
            kw = parse_qs(urlparse(target_url).query).get("kw", [""])[0].strip()
            if kw:
                _save_auth({"authorization": auth, "cookie": fwd.get("cookie", ""), "user-agent": request.headers.get("user-agent", "")})
                print(f"[proxy] ✅ Captured auth for '{kw}'")
                asyncio.create_task(_run_keyword_crawl_bg(target_url, dict(fwd)))
        elif PRODUCT_API_PATH in target_url and request.method == "POST":
            _save_auth({"authorization": auth, "cookie": fwd.get("cookie", ""), "user-agent": request.headers.get("user-agent", "")})
            print(f"[proxy] ✅ Captured auth from product API")

    # Request to target
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=30.0, verify=False) as client:
            resp = await client.request(
                method=request.method, url=target_url, headers=fwd, content=body
            )
    except Exception as e:
        print(f"[proxy] ERROR requesting {target_url}: {e}")
        raise HTTPException(status_code=502, detail=f"Proxy error: {e}")

    # LOGGING: Giúp bạn debug trên VPS
    print(f"[proxy] {request.method} {resp.status_code} {target_url}")

    # Response headers
    resp_headers: dict = {}
    for k, v in resp.headers.items():
        kl = k.lower()
        if kl in _SKIP_RESP_HEADERS: continue
        if kl == "location":
            if v.startswith("/") and not v.startswith("/api/henull_proxy/"):
                v = f"/api/henull_proxy/{target}{v}"
            else:
                for orig, proxy in PROXY_URL_MAP.items():
                    v = v.replace(orig, proxy)
            resp_headers[k] = v
        elif kl == "set-cookie":
            # Gỡ bỏ Domain và Secure để trình duyệt chấp nhận Cookie trên IP VPS
            v = re.sub(r";\s*Domain=[^;,]+", "", v, flags=re.IGNORECASE)
            v = re.sub(r";\s*Secure(?=;|,|$)", "", v, flags=re.IGNORECASE)
            # Ép SameSite=Lax để Session hoạt động tốt trong Iframe
            if "SameSite=" in v:
                v = re.sub(r";\s*SameSite=[^;,]+", "; SameSite=Lax", v, flags=re.IGNORECASE)
            else:
                v += "; SameSite=Lax"
            resp_headers[k] = v
        else: resp_headers[k] = v

    # Thêm CORS headers để tránh bị trình duyệt chặn các request AJAX từ HEnull
    resp_headers["Access-Control-Allow-Origin"] = "*"
    resp_headers["Access-Control-Allow-Methods"] = "*"
    resp_headers["Access-Control-Allow-Headers"] = "*"

    # Content rewrite
    ct = resp.headers.get("content-type", "").lower()
    content = resp.content
    prefix = f"/api/henull_proxy/{target}"
    if "text/html" in ct:
        content = _rewrite_html(content.decode("utf-8", errors="replace"), prefix).encode("utf-8")
    elif "javascript" in ct or "css" in ct:
        content = _rewrite_content(content.decode("utf-8", errors="replace"), prefix).encode("utf-8")

    return Response(content=content, status_code=resp.status_code, headers=resp_headers, media_type=ct)


# ── Rest of routes (Status, History, etc.) ────────────────────────────────────

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
