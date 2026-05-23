import shutil
from pathlib import Path

from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
import telegram_bot.notify as tg

from etsy_listing.shared import (
    build_listing_history_response,
    ensure_listing_name,
    get_listing_asset_dir,
    get_listing_history_path,
    load_listing_history,
    now_iso,
    save_listing_history,
)
from history_utils import write_json

from etsy_listing.req1_list_keywords import router as req1_router
from etsy_listing.req2_generate_title_listing import router as req2_router
from etsy_listing.req3_generate_tags import router as req3_router
from etsy_listing.req4_generate_description_listing import router as req4_router
from etsy_listing.req5_generate_image_alt_text import router as req5_router


router = APIRouter()
router.include_router(req1_router, tags=["Listings"])
router.include_router(req2_router, tags=["Listings"])
router.include_router(req3_router, tags=["Listings"])
router.include_router(req4_router, tags=["Listings"])
router.include_router(req5_router, tags=["Listings"])


class FinishListingRequest(BaseModel):
    listing_name: str
    listing_title: str = ""
    project_name: str = ""


class UpdateDraftRequest(BaseModel):
    listing_name: str
    price: str | None = None
    quantity: int | None = None
    when_made: str | None = None


@router.post("/api/listing/update_draft", tags=["Listings"])
async def update_listing_draft(req: UpdateDraftRequest):
    listing_name = ensure_listing_name(req.listing_name)
    history = load_listing_history(listing_name)
    if not history:
        raise Exception(f"Listing '{listing_name}' not found")
    if req.price is not None:
        history["price"] = req.price
    if req.quantity is not None:
        history["quantity"] = req.quantity
    if req.when_made is not None:
        history["when_made"] = req.when_made
    history = save_listing_history(history)
    return build_listing_history_response(history)


@router.post("/api/listing/upload_digital_file", tags=["Listings"])
async def upload_digital_file(listing_name: str, file: UploadFile = File(...)):
    listing_name = ensure_listing_name(listing_name)
    history = load_listing_history(listing_name)
    if not history:
        raise Exception(f"Listing '{listing_name}' not found")

    asset_dir = get_listing_asset_dir(listing_name, "digital")
    asset_dir.mkdir(parents=True, exist_ok=True)

    timestamp = now_iso().replace(":", "").replace("-", "").replace("T", "_")[:15]
    safe_stem = Path(file.filename or "file").stem.replace(" ", "_")
    suffix = Path(file.filename or "file").suffix
    stored_filename = f"{timestamp}_{safe_stem}{suffix}"
    dest = asset_dir / stored_filename

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    from etsy_listing.shared import build_listing_asset_url
    history["digital_file"] = {
        "original_filename": file.filename or stored_filename,
        "stored_filename": stored_filename,
        "asset_url": build_listing_asset_url(listing_name, "digital", stored_filename),
        "size": dest.stat().st_size,
    }
    history = save_listing_history(history)
    return build_listing_history_response(history)


@router.delete("/api/listing/digital_file", tags=["Listings"])
async def delete_digital_file(listing_name: str):
    listing_name = ensure_listing_name(listing_name)
    history = load_listing_history(listing_name)
    if not history:
        raise Exception(f"Listing '{listing_name}' not found")

    df = history.get("digital_file")
    if df and df.get("stored_filename"):
        asset_dir = get_listing_asset_dir(listing_name, "digital")
        target = asset_dir / df["stored_filename"]
        if target.exists():
            target.unlink()

    history["digital_file"] = None
    history = save_listing_history(history)
    return {"status": "ok"}


@router.post("/api/listing/finish", tags=["Listings"])
async def finish_listing(req: FinishListingRequest):
    p_name = req.project_name or "Etsy Listing"
    display_title = req.listing_title or req.listing_name
    try:
        tg.notify_listing_done(p_name, display_title)
    except Exception as e:
        print("Lỗi gửi telegram:", e)
    return {"status": "ok"}
