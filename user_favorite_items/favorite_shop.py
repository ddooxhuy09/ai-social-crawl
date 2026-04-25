from typing import TypedDict
import asyncio
from .utils import log_session

class FavoriteShop(TypedDict):
    shop_id: str | int
    shop_name: str
    url: str
    avatar_url: str

async def fetch_favorite_shops(page, profile_url: str, session_id: str, buyer_id: str):
    log_session(session_id, buyer_id, "[Shops] Fetching favorite shops (all pages)...")
    
    all_shops: list[FavoriteShop] = []
    shops_total_count: int | None = None
    shops_page_num = 1

    while True:
        log_session(session_id, buyer_id, f"  -- Shops page {shops_page_num} --")
        shops_url = f"{profile_url}?tab=shops" + (f"&page={shops_page_num}" if shops_page_num > 1 else "")
        
        try:
            await page.goto(shops_url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(2000)
        except Exception as e:
            log_session(session_id, buyer_id, f"  [Shops] Navigation error: {e}")
            break

        shops_data = await page.evaluate("""
            () => {
                const scripts = [...document.querySelectorAll('script[type="text/props"]')];
                for (const s of scripts) {
                    const text = (s.textContent || '').trim();
                    if (!text.includes('"shopsCount"')) continue;
                    try {
                        const parsed = JSON.parse(text);
                        if (parsed && parsed.shops) return parsed;
                    } catch (e) {}
                }
                return null;
            }
        """)

        if not shops_data:
            log_session(session_id, buyer_id, "  No shops data embedded script found. Stopping shops.")
            break

        page_shops = shops_data.get("shops", [])
        
        if shops_total_count is None:
            shops_total_count = shops_data.get("shopsCount")
            total_pages = shops_data.get("totalPages", 1)
            if shops_total_count:
                log_session(session_id, buyer_id, f"  Total shops reported: {shops_total_count} ({total_pages} pages)")

        if not page_shops:
            log_session(session_id, buyer_id, "  No more shops in list. Stopping.")
            break

        # Map to our structure
        for s in page_shops:
            shop_name = s.get("shop_name", "Unknown")
            all_shops.append({
                "shop_id": s.get("shop_id", ""),
                "shop_name": shop_name,
                "url": s.get("url", f"https://www.etsy.com/shop/{shop_name}"),
                "avatar_url": s.get("icon_url_fullxfull", "")
            })

        log_session(session_id, buyer_id, f"  -> Got {len(page_shops)} shops | Accumulated: {len(all_shops)}")

        if shops_data.get("totalPages", 1) <= shops_page_num:
            break

        shops_page_num += 1
        await page.wait_for_timeout(1500)

    return all_shops, shops_total_count
