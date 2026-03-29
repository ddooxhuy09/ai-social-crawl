from fastapi import APIRouter

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
