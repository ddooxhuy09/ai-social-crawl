import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from crawlers.utils import _run_async

from history_utils import HISTORY_DIR

router = APIRouter(tags=["product_insights"])

PRODUCT_DIR = HISTORY_DIR / "product-insights"


def _safe_name(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in name.strip())[:60] or "product"


def _product_folders() -> list[Path]:
    PRODUCT_DIR.mkdir(parents=True, exist_ok=True)
    folders = []
    for f in sorted(PRODUCT_DIR.iterdir(), reverse=True):
        if f.is_dir() and (f / "meta.json").exists():
            folders.append(f)
    return folders


def _read_meta(folder: Path) -> dict:
    try:
        return json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _product_summary(folder: Path) -> dict:
    meta = _read_meta(folder)
    return {
        "id": meta.get("id", folder.name),
        "name": meta.get("name", ""),
        "status": meta.get("status", "empty"),
        "created_at": meta.get("created_at", ""),
    }


def _product_detail(folder: Path) -> dict:
    meta = _read_meta(folder)
    result = {
        "id": meta.get("id", folder.name),
        "name": meta.get("name", ""),
        "url": meta.get("url", ""),
        "notes": meta.get("notes", ""),
        "status": meta.get("status", "empty"),
        "created_at": meta.get("created_at", ""),
    }

    product_info_path = folder / "product_info.json"
    if product_info_path.exists():
        try:
            info = json.loads(product_info_path.read_text(encoding="utf-8"))
            result["raw_text"] = info.get("raw_text", "")
            result["product_name"] = info.get("product_name", "")
            result["product_description"] = info.get("description", "")
            result["product_image"] = (info.get("image_urls") or [""])[0]
            result["image_urls"] = info.get("image_urls", [])
            result["shop_name"] = info.get("shop_name", "")
            result["price"] = info.get("price", "")
            result["original_price"] = info.get("original_price", "")
            result["on_sale"] = info.get("on_sale", False)
            result["avg_rating"] = info.get("avg_rating", "")
            result["total_review_count"] = info.get("total_review_count", "")
            result["total_sales"] = info.get("total_sales", "")
            result["tags"] = info.get("tags", [])
        except Exception:
            pass

    product_review_path = folder / "product_review.json"
    if product_review_path.exists():
        try:
            reviews = json.loads(product_review_path.read_text(encoding="utf-8"))
            result["reviews"] = reviews
        except Exception:
            result["reviews"] = []
    else:
        result["reviews"] = []

    result["trend_status"] = meta.get("trend_status", "idle")
    result["trend_error"] = meta.get("trend_error", "")

    trend_path = folder / "trend_research.json"
    if trend_path.exists():
        try:
            result["trend_research"] = json.loads(trend_path.read_text(encoding="utf-8"))
        except Exception:
            result["trend_research"] = None
    else:
        result["trend_research"] = None

    return result


def _find_folder(product_id: str) -> Path | None:
    for folder in _product_folders():
        meta = _read_meta(folder)
        if meta.get("id") == product_id:
            return folder
    return None


_background_tasks: set[asyncio.Task] = set()


async def _run_crawl(product_id: str, folder: Path, url: str):
    meta = _read_meta(folder)
    meta["status"] = "running"
    _write_json(folder / "meta.json", meta)

    try:
        from product_insights.etsy_crawler import crawl_etsy_reviews

        result = await asyncio.to_thread(lambda: _run_async(crawl_etsy_reviews(url)))

        product_info = {
            "product_name": result.get("product_name", meta.get("name", "")),
            "shop_name": result.get("shop_name", ""),
            "description": result.get("description", ""),
            "price": result.get("price", ""),
            "original_price": result.get("original_price", ""),
            "on_sale": result.get("on_sale", False),
            "avg_rating": result.get("avg_rating", ""),
            "total_review_count": result.get("total_review_count", ""),
            "total_sales": result.get("total_sales", ""),
            "tags": result.get("tags", []),
            "image_urls": result.get("image_urls", []),
            "url": url,
        }
        _write_json(folder / "product_info.json", product_info)

        reviews = result.get("reviews", [])
        _write_json(folder / "product_review.json", reviews)

        meta["status"] = "done"
        _write_json(folder / "meta.json", meta)

    except Exception as e:
        meta["status"] = "error"
        meta["error"] = str(e)
        _write_json(folder / "meta.json", meta)


async def _run_trend_research(folder: Path, product_info: dict, trends_keyword: str = ""):
    meta = _read_meta(folder)
    meta["trend_status"] = "running"
    meta.pop("trend_error", None)
    _write_json(folder / "meta.json", meta)

    try:
        from product_insights.trend_researcher import _extract_base_keyword, _build_trend_queries, fetch_tavily_results, fetch_google_trends

        product_name = product_info.get("product_name", "")
        base_keyword = trends_keyword.strip() if trends_keyword and trends_keyword.strip() else _extract_base_keyword(product_name)
        queries = _build_trend_queries(product_name)

        tavily_results = await fetch_tavily_results(queries)

        loop = asyncio.get_event_loop()
        google_trends = await loop.run_in_executor(None, fetch_google_trends, base_keyword)

        _write_json(folder / "trend_research.json", {
            "queried_at": datetime.now().isoformat(),
            "queries": queries,
            "tavily_results": tavily_results,
            "google_trends": google_trends,
        })

        meta = _read_meta(folder)
        meta["trend_status"] = "done"
        _write_json(folder / "meta.json", meta)

    except Exception as e:
        meta = _read_meta(folder)
        meta["trend_status"] = "error"
        meta["trend_error"] = str(e)
        _write_json(folder / "meta.json", meta)


class CreateProductRequest(BaseModel):
    name: str


class UpdateProductRequest(BaseModel):
    url: Optional[str] = None
    notes: Optional[str] = None


class StartTrendResearchRequest(BaseModel):
    trends_keyword: Optional[str] = None


class SaveManualInfoRequest(BaseModel):
    raw_text: str


@router.get("/api/product-insights/prompt")
async def get_prompt():
    prompt_path = Path(__file__).resolve().parent / "prompt.md"
    if not prompt_path.exists():
        raise HTTPException(status_code=404, detail="prompt.md not found")
    return {"prompt": prompt_path.read_text(encoding="utf-8")}


@router.post("/api/product-insights/products")
async def create_product(req: CreateProductRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Product name is required")

    product_id = uuid.uuid4().hex[:12]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = _safe_name(name)
    folder_name = f"{safe}_{ts}"
    folder = PRODUCT_DIR / folder_name
    folder.mkdir(parents=True, exist_ok=True)

    meta = {
        "id": product_id,
        "name": name,
        "url": "",
        "notes": "",
        "status": "empty",
        "created_at": datetime.now().isoformat(),
    }
    _write_json(folder / "meta.json", meta)

    return {"id": product_id}


@router.get("/api/product-insights/products")
async def list_products():
    folders = _product_folders()
    return [_product_summary(f) for f in folders]


@router.get("/api/product-insights/products/{product_id}")
async def get_product(product_id: str):
    folder = _find_folder(product_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_detail(folder)


@router.put("/api/product-insights/products/{product_id}")
async def update_product(product_id: str, req: UpdateProductRequest):
    folder = _find_folder(product_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Product not found")

    meta = _read_meta(folder)
    if req.url is not None:
        meta["url"] = req.url
    if req.notes is not None:
        meta["notes"] = req.notes
    _write_json(folder / "meta.json", meta)

    return _product_detail(folder)


@router.post("/api/product-insights/products/{product_id}/start")
async def start_research(product_id: str):
    folder = _find_folder(product_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Product not found")

    meta = _read_meta(folder)
    url = meta.get("url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Etsy URL is required before starting research")

    if meta.get("status") == "running":
        raise HTTPException(status_code=400, detail="Research is already running")

    task = asyncio.create_task(_run_crawl(product_id, folder, url))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    meta["status"] = "running"
    _write_json(folder / "meta.json", meta)

    return _product_detail(folder)


@router.post("/api/product-insights/products/{product_id}/trend-research")
async def start_trend_research(product_id: str, req: StartTrendResearchRequest = StartTrendResearchRequest()):
    folder = _find_folder(product_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Product not found")

    meta = _read_meta(folder)
    if meta.get("status") != "done":
        raise HTTPException(status_code=400, detail="Complete the Etsy crawl before running trend research")

    if meta.get("trend_status") == "running":
        raise HTTPException(status_code=400, detail="Trend research is already running")

    product_info_path = folder / "product_info.json"
    if not product_info_path.exists():
        raise HTTPException(status_code=400, detail="Product info not found")

    product_info = json.loads(product_info_path.read_text(encoding="utf-8"))

    task = asyncio.create_task(_run_trend_research(folder, product_info, req.trends_keyword or ""))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    meta["trend_status"] = "running"
    _write_json(folder / "meta.json", meta)

    return _product_detail(folder)


@router.post("/api/product-insights/products/{product_id}/manual-info")
async def save_manual_info(product_id: str, req: SaveManualInfoRequest):
    folder = _find_folder(product_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Product not found")
    _write_json(folder / "product_info.json", {"raw_text": req.raw_text})
    return _product_detail(folder)
