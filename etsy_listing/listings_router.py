from fastapi import APIRouter
from pydantic import BaseModel
import projects.telegram_notify as tg

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

@router.post("/api/listing/finish", tags=["Listings"])
async def finish_listing(req: FinishListingRequest):
    p_name = req.project_name or "Etsy Listing"
    display_title = req.listing_title or req.listing_name
    try:
        tg.notify_listing_done(p_name, display_title)
    except Exception as e:
        print("Lỗi gửi telegram:", e)
    return {"status": "ok"}
