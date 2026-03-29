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


# ── Models ────────────────────────────────────────────────────────────────────

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
    is_raving: int = 0
    is_pick: int = 0
    is_bestsell: int = 0
    listed_time: str = ""
    country: str = ""
    is_first: str = "false"
    currency_code: str = "USD"
    is_batch: int = 0
    sort_by: int = 1
    desc: int = 1
    page_num: int = 1
    page_size: int = 20
    is_switch_view: str = "false"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_prompt_template() -> str:
    """Load classify prompt template from prompts.json."""
    try:
        data = json.loads(ETSY_HUNT_PROMPTS_FILE.read_text(encoding="utf-8"))
        return data["classify_keywords"]["prompt_template"]
    except Exception:
        return (
            "Bạn là chuyên gia phân tích từ khóa Etsy. Phân tích từng keyword và trích xuất các thành phần NER.\n\n"
            "Trả về JSON array, mỗi phần tử:\n"
            '{"keyword":"...","Màu sắc":"","Kích thước":"","Hoa văn":"","Khác":"",'
            '"Tính năng/hiệu quả":"","Đối tượng":"","Phong cách/kiểu dáng":"","Cảnh":"",'
            '"Từ theo mùa/sự kiện đặc biệt":"","Dòng sản phẩm/mô hình bổ sung":""}\n\n'
            "Chỉ trả về JSON array, không giải thích thêm.\n\nKeywords:\n{keywords_list}"
        )


def _classify_keywords_gemini(keywords: list) -> dict:
    """Call Gemini to NER-classify a list of keywords. Returns {keyword: {attr: value}}."""
    from create_image_by_ai.image_generator import _get_gemini_client, GEMINI_TEXT_MODEL

    prompt_template = _load_prompt_template()
    client = _get_gemini_client()
    results = {}
    batch_size = 80

    for i in range(0, len(keywords), batch_size):
        batch = keywords[i: i + batch_size]
        numbered = "\n".join(f"{j+1}. {kw}" for j, kw in enumerate(batch))
        prompt = prompt_template.replace("{keywords_list}", numbered)
        print(f"[classify] batch {i//batch_size + 1} / {(len(keywords)-1)//batch_size + 1} ({len(batch)} keywords)")
        try:
            response = client.models.generate_content(model=GEMINI_TEXT_MODEL, contents=prompt)
            raw = (response.text or "").strip()
            raw = re.sub(r"```(?:json)?\s*", "", raw)
            raw = re.sub(r"```\s*$", "", raw).strip()
            parsed = json.loads(raw)
            for item in parsed:
                kw = item.get("keyword", "")
                if kw:
                    results[kw] = {a: str(item.get(a, "")) for a in NER_ATTRS}
        except Exception as e:
            print(f"[classify] batch error: {e}")

    empty = {a: "" for a in NER_ATTRS}
    for kw in keywords:
        if kw not in results:
            results[kw] = dict(empty)
    return results


# ── Reverse Proxy: HEnull ─────────────────────────────────────────────────────
# Thay thế Playwright subprocess — user đăng nhập HEnull qua iframe trong tool,
# VPS proxy bắt Authorization header và trigger crawl tự động.

PROXY_TARGETS = {
    "main": "https://www.henull.com",
    "tool": "https://lzgawl7j.realnull.com",
}
PROXY_URL_MAP = {v: f"/api/henull_proxy/{k}" for k, v in PROXY_TARGETS.items()}

# Shared cookie jar — duy trì session HEnull giữa các requests
_proxy_cookies: dict = {}

# Inject script nhỏ gọn: rewrite fetch/XHR URLs + patch history.pushState
_INJECT_SCRIPT_TPL = (
    "<script>(function(){"
    "var M={'https://www.henull.com':'/api/henull_proxy/main',"
    "'https://lzgawl7j.realnull.com':'/api/henull_proxy/tool'};"
    "var P='__PFX__';"
    "function rw(u){if(!u||typeof u!=='string')return u;"
    "for(var k in M){if(u.indexOf(k)===0)return M[k]+u.slice(k.length);}return u;}"
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

_SKIP_REQ_HEADERS = {
    "host", "content-length", "transfer-encoding",
    "connection", "keep-alive", "upgrade", "te",
}
_SKIP_RESP_HEADERS = {
    "content-encoding", "content-length", "transfer-encoding",
    "x-frame-options", "content-security-policy",
    "content-security-policy-report-only", "strict-transport-security",
}


def _make_inject_script(prefix: str) -> str:
    return _INJECT_SCRIPT_TPL.replace("__PFX__", prefix)


def _rewrite_html(html: str, prefix: str) -> str:
    """Rewrite absolute HEnull URLs in HTML + inject monkey-patch script."""
    for orig, proxy in PROXY_URL_MAP.items():
        html = html.replace(f'"{orig}', f'"{proxy}')
        html = html.replace(f"'{orig}", f"'{proxy}")
        html = html.replace(f"={orig}", f"={proxy}")
    inject = _make_inject_script(prefix)
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
    """Background task: crawl p=1..100 keyword pages and save CSV."""
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
    """Reverse proxy HEnull qua VPS — bắt Authorization header và trigger crawl."""
    if target not in PROXY_TARGETS:
        raise HTTPException(status_code=404, detail="Invalid proxy target")

    base = PROXY_TARGETS[target]
    target_url = f"{base}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    # Build forwarded headers
    fwd: dict = {}
    for k, v in request.headers.items():
        kl = k.lower()
        if kl in _SKIP_REQ_HEADERS:
            continue
        if kl == "origin":
            fwd["origin"] = base
        elif kl == "referer":
            for proxy_pfx in PROXY_TARGETS:
                pfx = f"/api/henull_proxy/{proxy_pfx}"
                if pfx in v:
                    v = v.replace(str(request.base_url).rstrip("/") + pfx, PROXY_TARGETS[proxy_pfx])
                    v = v.replace(pfx, PROXY_TARGETS[proxy_pfx])
            fwd["referer"] = v
        else:
            fwd[k] = v
    fwd["host"] = base.replace("https://", "").replace("http://", "")

    # Merge stored session cookies
    if _proxy_cookies:
        existing = fwd.get("cookie", "")
        extra = "; ".join(f"{k}={v}" for k, v in _proxy_cookies.items())
        fwd["cookie"] = f"{existing}; {extra}".strip("; ") if existing else extra

    body = await request.body()

    # ── Bắt token + trigger crawl khi thấy keyword/product API ──────────────────
    from etsy_hunt.etsy_hunt_keyword import KEYWORD_API_PATH, PRODUCT_API_PATH, _save_auth
    auth = request.headers.get("authorization", "")
    if auth:
        if KEYWORD_API_PATH in target_url and request.method == "GET":
            kw = parse_qs(urlparse(target_url).query).get("kw", [""])[0].strip()
            if kw:
                _save_auth({
                    "authorization": auth,
                    "cookie": fwd.get("cookie", ""),
                    "user-agent": request.headers.get("user-agent", ""),
                })
                print(f"[proxy] ✅ Bắt token + trigger crawl keyword='{kw}'")
                asyncio.create_task(_run_keyword_crawl_bg(target_url, dict(fwd)))
        elif PRODUCT_API_PATH in target_url and request.method == "POST":
            _save_auth({
                "authorization": auth,
                "cookie": fwd.get("cookie", ""),
                "user-agent": request.headers.get("user-agent", ""),
            })
            print("[proxy] ✅ Bắt token từ product API")

    # ── Forward request ───────────────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(
            follow_redirects=False, timeout=30.0, verify=False
        ) as client:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=fwd,
                content=body,
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy error: {e}")

    # Lưu cookies từ response vào shared jar
    for ck_name, ck_val in resp.cookies.items():
        _proxy_cookies[ck_name] = ck_val

    # ── Build response headers ────────────────────────────────────────────────────
    resp_headers: dict = {}
    for k, v in resp.headers.items():
        kl = k.lower()
        if kl in _SKIP_RESP_HEADERS:
            continue
        if kl == "location":
            for orig, proxy in PROXY_URL_MAP.items():
                v = v.replace(orig, proxy)
            resp_headers[k] = v
        elif kl == "set-cookie":
            v = re.sub(r";\s*Domain=[^;,]+", "", v, flags=re.IGNORECASE)
            v = re.sub(r";\s*Secure(?=;|,|$)", "", v, flags=re.IGNORECASE)
            v = re.sub(r";\s*SameSite=[^;,]+", "; SameSite=Lax", v, flags=re.IGNORECASE)
            resp_headers[k] = v
        else:
            resp_headers[k] = v

    # ── Rewrite HTML content ──────────────────────────────────────────────────────
    content_type = resp.headers.get("content-type", "")
    content = resp.content
    if "text/html" in content_type:
        text = content.decode("utf-8", errors="replace")
        text = _rewrite_html(text, f"/api/henull_proxy/{target}")
        content = text.encode("utf-8")

    return Response(
        content=content,
        status_code=resp.status_code,
        headers=resp_headers,
        media_type=content_type,
    )


# ── Routes: Status ─────────────────────────────────────────────────────────────

@router.get("/api/etsy_hunt/status")
async def get_etsy_hunt_status(project_id: str = None):
    """Trạng thái crawl: script etsy_hunt ghi 'crawling' khi vào vòng for, 'idle' khi xong."""
    status_file = _get_status_file(project_id)
    if not status_file.exists():
        return {"state": "idle"}
    try:
        data = json.loads(status_file.read_text(encoding="utf-8"))
        return {"state": data.get("state", "idle"), "keyword": data.get("keyword"), "updated_at": data.get("updated_at")}
    except Exception:
        return {"state": "idle"}


# ── Routes: Keyword History ────────────────────────────────────────────────────

@router.get("/api/etsy_hunt/history")
async def list_etsy_hunt_history(project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    if not hist_dir.exists():
        return []
    items = []
    for f in sorted(hist_dir.glob("*.csv"), reverse=True):
        stat = f.stat()
        items.append({
            "filename": f.name,
            "size_kb": round(stat.st_size / 1024, 1),
            "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        })
    return items


@router.get("/api/etsy_hunt/history/{filename}")
async def get_etsy_hunt_csv(filename: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    filepath = hist_dir / filename
    if not filepath.exists() or not filepath.suffix == ".csv":
        raise HTTPException(status_code=404, detail="File not found")
    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return {"filename": filename, "total": len(rows), "rows": rows}


@router.delete("/api/etsy_hunt/history/{filename}")
async def delete_etsy_hunt_csv(filename: str, project_id: str = None):
    if "/" in filename or "\\" in filename or not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    hist_dir = _keyword_history_dir(project_id)
    filepath = hist_dir / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    filepath.unlink()
    return {"ok": True}


@router.get("/api/etsy_hunt/history/{filename}/download")
async def download_etsy_hunt_csv(filename: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    filepath = hist_dir / filename
    if not filepath.exists() or not filepath.suffix == ".csv":
        raise HTTPException(status_code=404, detail="File not found")
    content = filepath.read_bytes()
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Routes: Keyword Classify ───────────────────────────────────────────────────

@router.post("/api/etsy_hunt/history/{filename}/classify")
async def classify_etsy_keywords(filename: str, project_id: str = None):
    """Classify keywords in a CSV using Gemini NER, return structured JSON."""
    if "/" in filename or "\\" in filename or not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    hist_dir = _keyword_history_dir(project_id)
    filepath = hist_dir / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(dict(row))

    keywords = [r.get("keyword", "").strip() for r in rows if r.get("keyword", "").strip()]
    if not keywords:
        raise HTTPException(status_code=400, detail="No keywords found in file")

    try:
        classifications = await asyncio.to_thread(_classify_keywords_gemini, keywords)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini classification failed: {e}")

    empty = {a: "" for a in NER_ATTRS}
    result_rows = []
    for row in rows:
        kw = row.get("keyword", "")
        cls = classifications.get(kw, empty)
        result_rows.append({**row, **cls})

    result = {
        "filename": filename,
        "total": len(result_rows),
        "classified_at": datetime.now().isoformat(timespec="seconds"),
        "rows": result_rows,
    }

    save_path = hist_dir / filename.replace(".csv", "_classified.json")
    save_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[classify] Saved -> {save_path}")

    return result


@router.get("/api/etsy_hunt/history/{filename}/classify")
async def get_etsy_keywords_classify(filename: str, project_id: str = None):
    """Load a previously saved classification result for a CSV file."""
    if "/" in filename or "\\" in filename or not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    hist_dir = _keyword_history_dir(project_id)
    save_path = hist_dir / filename.replace(".csv", "_classified.json")
    if not save_path.exists():
        raise HTTPException(status_code=404, detail="No classification found")
    return json.loads(save_path.read_text(encoding="utf-8"))


# ── Routes: Product History ────────────────────────────────────────────────────

@router.get("/api/etsy_hunt/product_results")
async def get_product_results(project_id: str = None):
    """Trả về kết quả product crawl lần cuối — đọc từ CSV mới nhất in history."""
    prod_dir = _product_history_dir(project_id)
    prod_dir.mkdir(parents=True, exist_ok=True)
    csvs = sorted(prod_dir.glob("*.csv"), reverse=True)
    if not csvs:
        raise HTTPException(status_code=404, detail="Chưa có kết quả. Hãy mở HEnull và search sản phẩm.")
    filepath = csvs[0]
    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    stem = filepath.stem
    parts = stem.split("_")
    search_key = " ".join(parts[2:-2]) if len(parts) > 4 else ""
    return {"search_key": search_key, "product_num": len(rows), "list": rows, "filename": filepath.name}


@router.get("/api/etsy_hunt/product_history")
async def list_etsy_hunt_product_history(project_id: str = None):
    prod_dir = _product_history_dir(project_id)
    prod_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(prod_dir.glob("*.csv"), reverse=True)
    result = []
    for f in existing:
        stat = f.stat()
        result.append({
            "filename": f.name,
            "size_kb": round(stat.st_size / 1024, 1),
            "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        })
    return result


@router.get("/api/etsy_hunt/product_history/{filename}")
async def get_etsy_hunt_product_csv(filename: str, project_id: str = None):
    if "/" in filename or "\\" in filename or not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    prod_dir = _product_history_dir(project_id)
    filepath = prod_dir / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return {"filename": filename, "total": len(rows), "rows": rows}


@router.delete("/api/etsy_hunt/product_history/{filename}")
async def delete_etsy_hunt_product_csv(filename: str, project_id: str = None):
    if "/" in filename or "\\" in filename or not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    prod_dir = _product_history_dir(project_id)
    filepath = prod_dir / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    filepath.unlink()
    return {"ok": True}


@router.get("/api/etsy_hunt/product_history/{filename}/download")
async def download_etsy_hunt_product_csv(filename: str, project_id: str = None):
    if "/" in filename or "\\" in filename or not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    prod_dir = _product_history_dir(project_id)
    filepath = prod_dir / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    content = filepath.read_bytes()
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Routes: Product Search ─────────────────────────────────────────────────────

@router.post("/api/etsy_hunt/products")
async def get_etsy_hunt_products(req_data: ProductListRequest):
    """Proxy tới HEnull product list API dùng token đã capture từ keyword hunt."""
    auth_file = _etsy_hunt_base() / "henull_auth.json"
    if not auth_file.exists():
        raise HTTPException(
            status_code=403,
            detail="Chưa có token auth. Hãy bấm 'Mở HEnull', đăng nhập và search keyword để lấy token."
        )
    try:
        auth = json.loads(auth_file.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="Lỗi đọc file auth.")

    henull_origin = os.getenv("HENULL_ORIGIN", "https://lzgawl7j.realnull.com")
    henull_referer = os.getenv("HENULL_REFERER", "https://lzgawl7j.realnull.com/iframe/etsy-product-research")
    henull_product_api = os.getenv("HENULL_PRODUCT_API_URL", "https://lzgawl7j.realnull.com/api/product/list")

    req_headers = {
        "accept": "application/json, text/plain, */*",
        "authorization": auth.get("authorization", ""),
        "content-type": "application/json",
        "user-agent": auth.get("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"),
        "origin": henull_origin,
        "referer": henull_referer,
    }
    if auth.get("cookie"):
        req_headers["cookie"] = auth["cookie"]

    body_bytes = json.dumps(req_data.model_dump()).encode("utf-8")

    def _call():
        http_req = urllib.request.Request(
            henull_product_api,
            data=body_bytes,
            headers=req_headers,
            method="POST",
        )
        with urllib.request.urlopen(http_req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))

    try:
        result = await asyncio.to_thread(_call)
        return result
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"API lỗi {e.code}: {e.reason}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Lỗi kết nối: {e}")
