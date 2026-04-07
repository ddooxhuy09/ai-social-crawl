import asyncio
import csv
import json
import os
import sys
import uuid
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
from etsy_hunt.search_ai import (
    _gemini_call_with_retry_async,
    _run_group_search,
)

# ── Background job store (in-memory) ─────────────────────────────────────────
# Each entry: {status, total, done, stage, result, error, saved_at}
_JOBS: dict[str, dict] = {}

# Keywords threshold — above this limit, run as background job + poll
GROUP_SEARCH_SYNC_MAX = 300


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
    listed_time: str = ""
    country: str = ""
    page_num: int = 1
    page_size: int = 20


class GroupSearchRequest(BaseModel):
    query: str
    project_id: str = None


# ── Job polling endpoint ──────────────────────────────────────────────────────

@router.get("/api/etsy_hunt/jobs/{job_id}")
async def get_job_status(job_id: str):
    if job_id not in _JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    return _JOBS[job_id]


# ── Background task runners ───────────────────────────────────────────────────


async def _run_group_search_job(
    job_id: str,
    query: str,
    keywords: list,
    rows: list,
    hist_dir: Path,
    filename: str,
) -> None:
    """Run group-search pipeline in background; writes progress to _JOBS[job_id]."""
    from create_image_by_ai.image_generator import _get_gemini_client, GEMINI_TEXT_MODEL

    job = _JOBS[job_id]

    def _progress(stage: str, done: int, total: int) -> None:
        job["stage"] = stage
        job["done"] = done
        job["total"] = total

    job["status"] = "running"
    job["stage"] = "embed"
    try:
        client = _get_gemini_client()
        groups, n_relevant = await asyncio.to_thread(
            _run_group_search, client, query, keywords, GEMINI_TEXT_MODEL, _progress
        )

        if n_relevant == 0:
            raise ValueError(f"No keywords related to \"{query}\" found in this file.")



        row_map = {r.get("keyword", "").strip().lower(): r for r in rows}
        for grp in groups:
            for sub in grp.get("subgroups", []):
                grp_items = []
                for kw in sub.get("keywords", []):
                    # In case it's already an dict (if the AI returns it somehow)
                    kw_str = kw if isinstance(kw, str) else kw.get("keyword", "")
                    rd = dict(row_map.get(kw_str.lower(), {"keyword": kw_str}))
                    grp_items.append(rd)
                sub["keywords"] = grp_items
                sub["count"] = len(sub["keywords"])

        entry = {
            "query": query,
            "total": n_relevant,
            "groups": groups,
            "saved_at": datetime.now().isoformat(timespec="seconds"),
        }
        save_path = hist_dir / filename.replace(".csv", "_group_search.json")
        all_searches = {}
        if save_path.exists():
            try:
                all_searches = json.loads(save_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        all_searches[query] = entry
        save_path.write_text(json.dumps(all_searches, ensure_ascii=False, indent=2), encoding="utf-8")
        job["status"] = "done"
        job["result"] = all_searches
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)


# ── Keyword history routes ────────────────────────────────────────────────────

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



# ── Group search ──────────────────────────────────────────────────────────────

@router.get("/api/etsy_hunt/history/{filename}/group-search")
async def get_group_search_result(filename: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    save_path = hist_dir / filename.replace(".csv", "_group_search.json")
    if not save_path.exists(): raise HTTPException(status_code=404, detail="No group search found")
    return json.loads(save_path.read_text(encoding="utf-8"))

@router.delete("/api/etsy_hunt/history/{filename}/group-search/{query}")
async def delete_group_search_result(filename: str, query: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    save_path = hist_dir / filename.replace(".csv", "_group_search.json")
    if save_path.exists():
        data = json.loads(save_path.read_text(encoding="utf-8"))
        data.pop(query, None)
        save_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True}

@router.put("/api/etsy_hunt/history/{filename}/group-search/{query}")
async def update_group_search_result(filename: str, query: str, request: Request, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    save_path = hist_dir / filename.replace(".csv", "_group_search.json")
    if not save_path.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy file group search")
    
    updated_groups = await request.json()
    
    data = json.loads(save_path.read_text(encoding="utf-8"))
    if query not in data:
        raise HTTPException(status_code=404, detail="Không tìm thấy truy vấn này")
        
    data[query]["groups"] = updated_groups
    total = sum(len(g.get("keywords", [])) for g in updated_groups)
    data[query]["total"] = total
    
    save_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "total": total}

@router.post("/api/etsy_hunt/history/{filename}/group-search")
async def group_search_keywords(filename: str, req: GroupSearchRequest):
    """Embedding-based keyword grouping: embed → cluster → name (L2/L3)."""
    hist_dir = _keyword_history_dir(req.project_id)
    filepath = hist_dir / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File không tồn tại.")
    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f): rows.append(row)
    if not rows:
        raise HTTPException(status_code=400, detail="File trống.")

    keywords = [r.get("keyword", "").strip() for r in rows if r.get("keyword", "").strip()]
    query = req.query.strip()

    # Large set → background job, return job_id for polling
    if len(keywords) > GROUP_SEARCH_SYNC_MAX:
        job_id = str(uuid.uuid4())
        _JOBS[job_id] = {"status": "queued", "total": len(keywords), "done": 0, "stage": "queued", "result": None, "error": None}
        asyncio.create_task(_run_group_search_job(job_id, query, keywords, rows, hist_dir, filename))
        return {"job_id": job_id, "status": "queued", "total": len(keywords), "query": query}

    # Small set → sync
    from create_image_by_ai.image_generator import _get_gemini_client, GEMINI_TEXT_MODEL
    client = _get_gemini_client()
    try:
        groups, n_relevant = await asyncio.to_thread(
            _run_group_search, client, query, keywords, GEMINI_TEXT_MODEL
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding/clustering error: {e}")

    if n_relevant == 0:
        raise HTTPException(status_code=422, detail=f"No keywords related to \"{query}\" found in this file. Try a broader or different search term.")

    row_map = {r.get("keyword", "").strip().lower(): r for r in rows}
    for grp in groups:
        for sub in grp.get("subgroups", []):
            grp_items = []
            for kw in sub.get("keywords", []):
                kw_str = kw if isinstance(kw, str) else kw.get("keyword", "")
                rd = dict(row_map.get(kw_str.lower(), {"keyword": kw_str}))
                grp_items.append(rd)
            sub["keywords"] = grp_items
            sub["count"] = len(sub["keywords"])

    entry = {"query": req.query, "total": n_relevant, "groups": groups,
             "saved_at": datetime.now().isoformat(timespec="seconds")}
    save_path = hist_dir / filename.replace(".csv", "_group_search.json")
    all_searches = {}
    if save_path.exists():
        try:
            all_searches = json.loads(save_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    all_searches[req.query] = entry
    save_path.write_text(json.dumps(all_searches, ensure_ascii=False, indent=2), encoding="utf-8")
    return all_searches


# ── Product history routes ────────────────────────────────────────────────────

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
