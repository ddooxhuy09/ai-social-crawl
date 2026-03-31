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

# ── Helpers ────────────────────────────────────────────────────────────────────

def _load_prompt_template() -> str:
    try:
        data = json.loads(ETSY_HUNT_PROMPTS_FILE.read_text(encoding="utf-8"))
        return data["classify_keywords"]["prompt_template"]
    except Exception:
        return (
            "You are an expert Etsy keyword analyst. Analyze each keyword and extract NER components.\n\n"
            "Return a JSON array, each element:\n"
            '{"keyword":"...","Màu sắc":"","Kích thước":"","Hoa văn":"","Khác":"","Chất liệu":"",'
            '"Tính năng/hiệu quả":"","Đối tượng":"","Phong cách/kiểu dáng":"","Cảnh":"",'
            '"Từ theo mùa/sự kiện đặc biệt":"","Dòng sản phẩm/mô hình bổ sung":""}\n\n'
            "Return only the JSON array, no explanation.\n\nKeywords:\n{keywords_list}"
        )


def _classify_keywords_gemini(keywords: list) -> dict:
    from create_image_by_ai.image_generator import _get_gemini_client, GEMINI_TEXT_MODEL
    prompt_template = _load_prompt_template()
    client = _get_gemini_client()
    results = {}
    batch_size = 80
    for i in range(0, len(keywords), batch_size):
        batch = keywords[i: i + batch_size]
        numbered = "\n".join(f"{j+1}. {kw}" for j, kw in enumerate(batch))
        prompt = prompt_template.replace("{keywords_list}", numbered)
        try:
            response = _gemini_call_with_retry(client.models.generate_content, model=GEMINI_TEXT_MODEL, contents=prompt)
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

@router.post("/api/etsy_hunt/history/{filename}/classify")
async def classify_etsy_keywords(filename: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    filepath = hist_dir / filename
    if not filepath.exists() or not filename.endswith(".csv"):
        raise HTTPException(status_code=404, detail="File not found")
    rows = []
    with filepath.open("r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f): rows.append(dict(row))
    keywords = [r.get("keyword", "").strip() for r in rows if r.get("keyword", "").strip()]
    if not keywords:
        raise HTTPException(status_code=400, detail="No keywords found")
    try:
        classifications = await asyncio.to_thread(_classify_keywords_gemini, keywords)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini error: {e}")
    empty = {a: "" for a in NER_ATTRS}
    result_rows = [{**row, **classifications.get(row.get("keyword", ""), empty)} for row in rows]
    result = {"filename": filename, "total": len(result_rows),
              "classified_at": datetime.now().isoformat(timespec="seconds"), "rows": result_rows}
    save_path = hist_dir / filename.replace(".csv", "_classified.json")
    save_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result

@router.get("/api/etsy_hunt/history/{filename}/classify")
async def get_etsy_keywords_classify(filename: str, project_id: str = None):
    hist_dir = _keyword_history_dir(project_id)
    save_path = hist_dir / filename.replace(".csv", "_classified.json")
    if not save_path.exists(): raise HTTPException(status_code=404, detail="No classification found")
    return json.loads(save_path.read_text(encoding="utf-8"))

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


class GroupSearchRequest(BaseModel):
    query: str
    project_id: str = None

EMBED_MODEL = "gemini-embedding-001"
EMBED_BATCH = 250   # embed_content supports up to 250 texts per call
EMBED_THRESHOLD_L2 = 0.35   # cosine distance cutoff for L2 clusters
EMBED_THRESHOLD_L3 = 0.20   # cosine distance cutoff for L3 sub-clusters
N_L2_MAX = 8
N_L3_MAX = 6


def _gemini_call_with_retry(fn, *args, max_retries=5, **kwargs):
    """Call a Gemini API function with retry, respecting retryDelay from 429/503."""
    import time
    for attempt in range(max_retries):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            msg = str(e)
            is_retryable = "503" in msg or "429" in msg or "UNAVAILABLE" in msg or "RESOURCE_EXHAUSTED" in msg
            if attempt < max_retries - 1 and is_retryable:
                # Parse suggested delay from error message e.g. "retry in 37.2s"
                delay = 60  # default fallback
                import re as _re
                m = _re.search(r"retry in (\d+(?:\.\d+)?)\s*s", msg, _re.IGNORECASE)
                if m:
                    delay = float(m.group(1)) + 2  # add 2s buffer
                print(f"[gemini retry] attempt {attempt+1}/{max_retries}, sleeping {delay:.0f}s")
                time.sleep(delay)
            else:
                raise


def _embed_keywords_sync(client, keywords: list[str]) -> list[list[float]]:
    """Embed all keywords in batches, return list of vectors."""
    import time
    vectors = []
    batches = [keywords[i: i + EMBED_BATCH] for i in range(0, len(keywords), EMBED_BATCH)]
    for idx, batch in enumerate(batches):
        resp = _gemini_call_with_retry(
            client.models.embed_content,
            model=EMBED_MODEL,
            contents=batch,
            config={"task_type": "CLUSTERING"},
        )
        for emb in resp.embeddings:
            vectors.append(emb.values)
        # Stay under free tier: 100 req/min → ~1.5s between batches
        if idx < len(batches) - 1:
            time.sleep(1.5)
    return vectors


def _cosine_sim(a, b):
    import numpy as np
    a, b = np.array(a), np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))


def _hierarchical_cluster(vectors, n_max: int, distance_threshold: float) -> list[list[int]]:
    """Cluster vectors using Ward linkage. Returns list of index groups."""
    import numpy as np
    from scipy.cluster.hierarchy import linkage, fcluster
    from scipy.spatial.distance import pdist

    mat = np.array(vectors, dtype=float)
    # Normalize for cosine
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    mat = mat / (norms + 1e-10)

    if len(mat) == 1:
        return [[0]]
    if len(mat) <= n_max:
        return [[i] for i in range(len(mat))]

    dists = pdist(mat, metric="cosine")
    Z = linkage(dists, method="ward")
    n_clusters = min(n_max, len(mat))
    labels = fcluster(Z, t=n_clusters, criterion="maxclust")
    groups: dict[int, list[int]] = {}
    for idx, lbl in enumerate(labels):
        groups.setdefault(int(lbl), []).append(idx)
    return list(groups.values())


def _name_clusters_sync(client, query: str, cluster_samples: list[list[str]], model: str) -> list[dict]:
    """Ask Gemini to name each cluster. Returns [{group, icon}]."""
    lines = []
    for i, samples in enumerate(cluster_samples):
        lines.append(f"Cluster {i+1}: {', '.join(samples[:8])}")
    prompt = (
        f"The user is researching Etsy keywords related to \"{query}\".\n\n"
        f"Below are {len(cluster_samples)} keyword clusters. For each cluster give a concise English group name and a single emoji.\n\n"
        + "\n".join(lines)
        + "\n\nReturn ONLY a JSON array:\n"
        "[{\"group\": \"Name\", \"icon\": \"emoji\"}, ...]\n\n"
        "One object per cluster, same order. No explanation."
    )
    resp = _gemini_call_with_retry(client.models.generate_content, model=model, contents=prompt)
    text = re.sub(r"```(?:json)?\s*", "", resp.text.strip())
    text = re.sub(r"```\s*$", "", text).strip()
    parsed = json.loads(text)
    # Pad/trim to match cluster count
    result = []
    for i, samples in enumerate(cluster_samples):
        name = parsed[i]["group"] if i < len(parsed) else f"Group {i+1}"
        icon = parsed[i]["icon"] if i < len(parsed) else "📌"
        result.append({"group": name, "icon": icon})
    return result


def _run_group_search(client, query: str, keywords: list[str], model: str) -> list[dict]:
    """Full embedding+clustering+naming pipeline. Returns L2/L3 structure."""
    # 1. Filter relevant keywords using query embedding similarity
    query_vec = _embed_keywords_sync(client, [query])[0]
    kw_vecs = _embed_keywords_sync(client, keywords)

    # Keep keywords with cosine sim > threshold to query
    relevant_idx = [
        i for i, v in enumerate(kw_vecs)
        if _cosine_sim(query_vec, v) > 0.25
    ]
    if len(relevant_idx) < 3:
        relevant_idx = list(range(len(keywords)))  # fallback: keep all

    rel_kws = [keywords[i] for i in relevant_idx]
    rel_vecs = [kw_vecs[i] for i in relevant_idx]

    # 2. L2 clustering
    l2_groups = _hierarchical_cluster(rel_vecs, N_L2_MAX, EMBED_THRESHOLD_L2)

    # 3. Name L2 clusters
    l2_samples = [[rel_kws[i] for i in grp] for grp in l2_groups]
    l2_names = _name_clusters_sync(client, query, l2_samples, model)

    # 4. L3 clustering within each L2
    result = []
    for li, (l2_idxs, l2_meta) in enumerate(zip(l2_groups, l2_names)):
        l2_kws = [rel_kws[i] for i in l2_idxs]
        l2_vecs_sub = [rel_vecs[i] for i in l2_idxs]

        l3_groups = _hierarchical_cluster(l2_vecs_sub, N_L3_MAX, EMBED_THRESHOLD_L3)
        l3_samples = [[l2_kws[i] for i in grp] for grp in l3_groups]
        l3_names = _name_clusters_sync(client, f"{query} > {l2_meta['group']}", l3_samples, model)

        subgroups = []
        for sgi, (l3_idxs, l3_meta) in enumerate(zip(l3_groups, l3_names)):
            subgroups.append({
                "group": l3_meta["group"],
                "icon": l3_meta["icon"],
                "keywords": [l2_kws[i] for i in l3_idxs],
            })
        subgroups.sort(key=lambda x: len(x["keywords"]), reverse=True)

        result.append({
            "group": l2_meta["group"],
            "icon": l2_meta["icon"],
            "subgroups": subgroups,
            "count": len(l2_kws),
        })
    result.sort(key=lambda x: x["count"], reverse=True)
    return result, len(relevant_idx)


@router.post("/api/etsy_hunt/history/{filename}/group-search")
async def group_search_keywords(filename: str, req: GroupSearchRequest):
    """Embedding-based keyword grouping: embed → cluster → name (L1=query, L2, L3)."""
    from create_image_by_ai.image_generator import _get_gemini_client, GEMINI_TEXT_MODEL

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

    client = _get_gemini_client()
    try:
        groups, n_relevant = await asyncio.to_thread(
            _run_group_search, client, req.query.strip(), keywords, GEMINI_TEXT_MODEL
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding/clustering error: {e}")

    # Attach full row data to each keyword
    row_map = {r.get("keyword", "").strip().lower(): r for r in rows}
    for l2 in groups:
        for l3 in l2.get("subgroups", []):
            l3["keywords"] = [row_map.get(kw.lower(), {"keyword": kw}) for kw in l3["keywords"]]
            l3["count"] = len(l3["keywords"])

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
