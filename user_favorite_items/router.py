"""
User Favorite Items — crawl Etsy favorite listings & shops for multiple buyers
extracted from a Sold Orders CSV, then run collaborative filtering.
"""
import asyncio
import csv
import io
import json
import uuid
from datetime import date as _date

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from pydantic import BaseModel

from .utils import STORAGE_DIR, _SESSIONS
from .crawler_orchestrator import run_session

router = APIRouter(tags=["user_favorites"])


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse_month(raw: str) -> str:
    """Convert 'MM/DD/YY' → 'MM/YYYY'. Returns '' on failure."""
    parts = raw.strip().split("/")
    if len(parts) == 3:
        mm, _, yy = parts
        year = f"20{yy}" if len(yy) == 2 else yy
        return f"{mm.zfill(2)}/{year}"
    return ""

def _load_file(path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


# ── CSV Parsing ────────────────────────────────────────────────────────────────

@router.post("/api/user-favorites/parse-csv")
async def parse_csv(file: UploadFile = File(...)):
    raw = await file.read()
    content = None
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            content = raw.decode(enc)
            break
        except Exception:
            continue

    if content is None:
        raise HTTPException(status_code=400, detail="Cannot decode CSV file.")

    try:
        reader = csv.DictReader(io.StringIO(content))
        headers = reader.fieldnames or []
        buyer_col = next((h for h in headers if h and h.strip().lower() == "buyer user id"), None)
        date_col  = next((h for h in headers if h and h.strip().lower() == "sale date"), None)
        if not buyer_col:
            raise HTTPException(status_code=400, detail="Column 'Buyer User ID' not found.")

        seen: dict[str, str] = {}  # buyer_id → month (first occurrence)
        for row in reader:
            bid = (row.get(buyer_col) or "").strip()
            if not bid or bid in seen:
                continue
            raw_date = (row.get(date_col) or "").strip() if date_col else ""
            seen[bid] = _parse_month(raw_date)

        buyers = [{"buyer_id": bid, "month": month} for bid, month in seen.items()]
        return {"buyers": buyers, "total": len(buyers)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {str(e)}")


# ── Pydantic models ────────────────────────────────────────────────────────────

class BuyerEntry(BaseModel):
    buyer_id: str
    month: str = ""

class StartRequest(BaseModel):
    buyers: list[BuyerEntry] = []
    buyer_ids: list[str] = []   # legacy: re-crawl from UI (no month context)

class AnalyzeRequest(BaseModel):
    target_buyer_id: str


# ── Helper ─────────────────────────────────────────────────────────────────────

def load_buyer_file(buyer_id: str) -> dict:
    f = STORAGE_DIR / f"{buyer_id}_favorites.json"
    return _load_file(f) if f.exists() else {}


# ── API Routes ─────────────────────────────────────────────────────────────────

@router.post("/api/user-favorites/start")
async def start_session(body: StartRequest):
    if body.buyers:
        buyer_month = {b.buyer_id.strip(): b.month for b in body.buyers if b.buyer_id.strip()}
    else:
        current = _date.today().strftime("%m/%Y")
        buyer_month = {bid.strip(): current for bid in body.buyer_ids if bid.strip()}

    if not buyer_month:
        raise HTTPException(status_code=400, detail="No buyer IDs provided.")

    session_id = str(uuid.uuid4())
    _SESSIONS[session_id] = {
        "status": "running",
        "buyer_ids": list(buyer_month.keys()),
        "buyer_month": buyer_month,
        "current_index": 0,
        "logs": [],
        "results": {},
        "captcha_required": False,
        "cancelled": False,
        "_captcha_event": asyncio.Event(),
    }

    asyncio.create_task(run_session(session_id, True, True))
    return {"session_id": session_id}


@router.get("/api/user-favorites/status/{session_id}")
async def get_session_status(session_id: str):
    if session_id not in _SESSIONS:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {k: v for k, v in _SESSIONS[session_id].items() if not k.startswith("_")}


@router.post("/api/user-favorites/captcha-solved/{session_id}")
async def captcha_solved(session_id: str):
    if session_id not in _SESSIONS:
        raise HTTPException(status_code=404, detail="Session not found.")
    event: asyncio.Event | None = _SESSIONS[session_id].get("_captcha_event")
    if event:
        event.set()
    return {"ok": True}


@router.get("/api/user-favorites/files")
async def list_files():
    files = []
    for f in sorted(STORAGE_DIR.glob("*_favorites.json")):
        buyer_id = f.stem.replace("_favorites", "")
        data = _load_file(f)
        try:
            item_source = data.get("item_data", data)
            shop_source = data.get("shop_data", data)
            items_list  = item_source.get("items", [])
            items_count = len(items_list) if items_list else len(item_source.get("listing_ids", []))
            files.append({
                "buyer_id":    buyer_id,
                "filename":    f.name,
                "total_items": items_count,
                "total_shops": len(shop_source.get("shops", [])),
            })
        except Exception:
            files.append({"buyer_id": buyer_id, "filename": f.name, "total_items": 0, "total_shops": 0})
    return files


@router.get("/api/user-favorites/months")
async def list_months():
    """Return all unique MM/YYYY values found across all buyer files."""
    months: set[str] = set()
    for f in STORAGE_DIR.glob("*_favorites.json"):
        data = _load_file(f)
        item_source = data.get("item_data", data)
        shop_source = data.get("shop_data", data)
        for item in item_source.get("items", []):
            if item.get("date"):
                months.add(item["date"])
        for shop in shop_source.get("shops", []):
            if shop.get("date"):
                months.add(shop["date"])
    return sorted(months)


@router.post("/api/user-favorites/analyze")
async def analyze_similarity(body: AnalyzeRequest):
    target_data = load_buyer_file(body.target_buyer_id)
    if not target_data:
        raise HTTPException(status_code=404, detail="Target user not found.")

    def extract_set(data: dict) -> set:
        item_source = data.get("item_data", data)
        if "items" in item_source:
            return {item["listing_id"] for item in item_source.get("items", [])}
        return set(item_source.get("listing_ids", []))

    target_set = extract_set(target_data)
    if not target_set:
        raise HTTPException(status_code=400, detail="Target has no items data.")

    matches = []
    for f in STORAGE_DIR.glob("*_favorites.json"):
        bid = f.stem.replace("_favorites", "")
        if bid == body.target_buyer_id:
            continue
        try:
            data  = _load_file(f)
            common = target_set & extract_set(data)
            if common:
                matches.append({"user_id": bid, "common_count": len(common), "common_items": sorted(list(common))})
        except Exception:
            continue

    matches.sort(key=lambda x: x["common_count"], reverse=True)
    return {"target_user": body.target_buyer_id, "matches": matches}


@router.get("/api/user-favorites/aggregate")
async def aggregate_all(month: str = Query("")):
    """
    Aggregate favorite items/shops across all buyers.
    Option B: if month is given, include buyers who have any item/shop with that date,
    then return ALL of their favorites.
    """
    items_map: dict[str, dict] = {}
    shops_map: dict[str, dict] = {}

    for f in STORAGE_DIR.glob("*_favorites.json"):
        buyer_id = f.stem.replace("_favorites", "")
        data = _load_file(f)
        item_source = data.get("item_data", data)
        shop_source = data.get("shop_data", data)
        all_items = item_source.get("items", [])
        all_shops = shop_source.get("shops", [])

        if month:
            qualifies = (
                any(i.get("date") == month for i in all_items) or
                any(s.get("date") == month for s in all_shops)
            )
            if not qualifies:
                continue

        for item in all_items:
            lid = str(item.get("listing_id", "")).strip()
            if not lid:
                continue
            if lid not in items_map:
                items_map[lid] = {
                    "listing_id":    lid,
                    "listing_url":   item.get("listing_url") or item.get("url", f"https://www.etsy.com/listing/{lid}"),
                    "image_url":     item.get("image_url", ""),
                    "title":         item.get("title", ""),
                    "price":         item.get("price", ""),
                    "currency":      item.get("currency", ""),
                    "shop_name":     item.get("shop_name", ""),
                    "review_rating": item.get("review_rating", ""),
                    "review_count":  item.get("review_count", ""),
                    "users": [],
                }
            items_map[lid]["users"].append(buyer_id)

        for shop in all_shops:
            name = shop.get("shop_name", "")
            if not name:
                continue
            if name not in shops_map:
                shops_map[name] = {
                    "shop_name":  name,
                    "url":        shop.get("url", f"https://www.etsy.com/shop/{name}"),
                    "avatar_url": shop.get("icon_url_fullxfull", "") or shop.get("avatar_url", ""),
                    "users": [],
                }
            shops_map[name]["users"].append(buyer_id)

    def build(entry: dict) -> dict:
        users = sorted(entry.pop("users"))
        return {**entry, "user_count": len(users), "users": users}

    return {
        "items": sorted([build(dict(v)) for v in items_map.values()], key=lambda x: x["user_count"], reverse=True),
        "shops": sorted([build(dict(v)) for v in shops_map.values()], key=lambda x: x["user_count"], reverse=True),
    }
