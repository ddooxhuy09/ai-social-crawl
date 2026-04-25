import asyncio
import json
from undetected_playwright.async_api import async_playwright

from .utils import (
    STORAGE_DIR,
    _SESSIONS,
    log_session,
    launch_stealth_browser,
    check_and_solve_captcha,
)
from .favorite_item import fetch_favorite_items
from .favorite_shop import fetch_favorite_shops


def _merge(new_entries: list[dict], old_entries: list[dict], key: str, month: str) -> list[dict]:
    """
    Merge newly crawled entries with previously saved ones.
    - New entry not in old data  → assign date = month
    - Entry in both             → keep old date
    - Old entry not in new crawl → keep with old date (historical record)
    """
    old_by_key = {str(e.get(key, "")): e for e in old_entries}
    new_by_key = {str(e.get(key, "")): e for e in new_entries}

    merged = []
    for k, entry in new_by_key.items():
        entry["date"] = old_by_key[k].get("date", month) if k in old_by_key else month
        merged.append(entry)

    # preserve removed entries
    for k, entry in old_by_key.items():
        if k not in new_by_key:
            merged.append(entry)

    return merged


async def crawl_user(session_id: str, buyer_id: str, month: str, crawl_items: bool, crawl_shops: bool) -> None:
    session = _SESSIONS[session_id]
    profile_url = f"https://www.etsy.com/people/{buyer_id}"

    log_session(session_id, buyer_id, f"Profile URL: {profile_url}")

    output_file = STORAGE_DIR / f"{buyer_id}_favorites.json"

    existing_data = {}
    if output_file.exists():
        try:
            existing_data = json.loads(output_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    existing_items = existing_data.get("item_data", existing_data).get("items", [])
    existing_shops = existing_data.get("shop_data", existing_data).get("shops", [])

    try:
        async with async_playwright() as p:
            browser, context = await launch_stealth_browser(p)
            page = await context.new_page()

            async def safe_goto(url: str, retries: int = 3) -> None:
                for attempt in range(1, retries + 1):
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                        await page.wait_for_timeout(3000)
                        return
                    except Exception as e:
                        msg = str(e)
                        if "ERR_ABORTED" in msg or "net::" in msg:
                            log_session(session_id, buyer_id, f"Aborted ({attempt}/{retries}), retrying...")
                            await page.wait_for_timeout(3000)
                        else:
                            raise

            log_session(session_id, buyer_id, "[1/2] Opening Etsy homepage...")
            await safe_goto("https://www.etsy.com")

            log_session(session_id, buyer_id, "[2/2] Navigating to profile...")
            await safe_goto(profile_url)

            await check_and_solve_captcha(page, session_id, buyer_id)
            if session.get("status") == "error":
                await browser.close()
                return

            all_items = existing_items
            all_shops = existing_shops

            if crawl_items:
                new_items, _ = await fetch_favorite_items(page, profile_url, session_id, buyer_id)
                all_items = _merge(new_items, existing_items, "listing_id", month)

            if crawl_shops:
                new_shops, _ = await fetch_favorite_shops(page, profile_url, session_id, buyer_id)
                all_shops = _merge(new_shops, existing_shops, "shop_name", month)

            final_data = {
                "user_info": {"profile_url": profile_url},
                "item_data": {
                    "total_collected": len(all_items),
                    "items": all_items,
                },
                "shop_data": {
                    "total_shops_collected": len(all_shops),
                    "shops": all_shops,
                },
            }

            output_file.parent.mkdir(parents=True, exist_ok=True)
            output_file.write_text(json.dumps(final_data, ensure_ascii=False, indent=2), encoding="utf-8")
            log_session(session_id, buyer_id, f"[DONE] Saved {len(all_items)} items & {len(all_shops)} shops -> {output_file.name}")
            session["results"][buyer_id] = "done"
            await browser.close()

    except Exception as e:
        session["results"][buyer_id] = "error"
        log_session(session_id, buyer_id, f"[ERROR] {str(e)}")


async def run_session(session_id: str, crawl_items: bool = True, crawl_shops: bool = True) -> None:
    session = _SESSIONS[session_id]
    buyer_ids: list[str] = session["buyer_ids"]
    buyer_month: dict[str, str] = session.get("buyer_month", {})

    for i, buyer_id in enumerate(buyer_ids):
        if session.get("cancelled"):
            session["logs"].append("Session cancelled by user.")
            break

        session["current_index"] = i
        session["status"] = "running"
        session["logs"].append(f"\n=== [{i + 1}/{len(buyer_ids)}] Processing: {buyer_id} ===")

        await crawl_user(session_id, buyer_id, buyer_month.get(buyer_id, ""), crawl_items, crawl_shops)

        if i < len(buyer_ids) - 1 and not session.get("cancelled"):
            await asyncio.sleep(2)

    if not session.get("cancelled"):
        session["current_index"] = len(buyer_ids)
        session["status"] = "done"
        session["logs"].append("\n=== All users processed ===")
