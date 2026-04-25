import asyncio
import random
import json
from pathlib import Path
from undetected_playwright.async_api import async_playwright
from crawlers.utils import _run_async

_BASE_DIR = Path(__file__).resolve().parent.parent
_COOKIES_DIR = _BASE_DIR / "cookies_instagram"

_SEARCH_GQL_PREFIX = "PolarisKeywordSearchExplorePage"


def _get_random_cookie_file() -> str:
    if not _COOKIES_DIR.exists():
        raise FileNotFoundError(f"Thư mục {_COOKIES_DIR} không tồn tại")
    cookie_files = [f for f in _COOKIES_DIR.iterdir() if f.suffix == ".json"]
    if not cookie_files:
        raise FileNotFoundError("Không tìm thấy file cookie nào")
    selected = random.choice(cookie_files)
    print(f"Cookie: {selected.name}")
    return str(selected)


def _extract_gql_items(response_data: dict) -> list[dict]:
    """Extract media items từ GraphQL search response."""
    serp = response_data.get("data", {}).get("xdt_fbsearch__top_serp_graphql")
    if not serp:
        return []
    items = []
    for edge in serp.get("edges", []):
        for item in edge.get("node", {}).get("items", []):
            if item.get("code"):
                items.append(item)
    return items


def _classify_media(media: dict) -> str:
    if media.get("media_type") == 2:
        return "reel"
    return "photo"


def _parse_media_to_item(media: dict) -> dict | None:
    code = media.get("code", "")
    if not code:
        return None

    content_type = _classify_media(media)

    if content_type == "reel":
        url = f"https://www.instagram.com/reel/{code}/"
    else:
        url = f"https://www.instagram.com/p/{code}/"

    caption = ""
    cap = media.get("caption")
    if isinstance(cap, dict):
        caption = cap.get("text", "")
    elif isinstance(cap, str):
        caption = cap

    username = ""
    user = media.get("user")
    if isinstance(user, dict):
        username = user.get("username", "")

    image_url = ""
    iv2 = media.get("image_versions2")
    if iv2 and iv2.get("candidates"):
        image_url = iv2["candidates"][0].get("url", "")

    item = {
        "url": url,
        "code": code,
        "content_type": content_type,
        "created_at": media.get("taken_at", 0),
        "like_count": media.get("like_count", 0),
        "comment_count": media.get("comment_count", 0),
        "username": username,
        "caption": caption,
        "image_url": image_url,
        "pk": str(media.get("pk", "")),
    }

    if content_type == "reel":
        item["view_count"] = media.get("view_count") or media.get("play_count") or 0

    return item


async def _crawl_instagram_async(
    keyword: str, max_items: int = 20
) -> dict[str, list[dict]]:
    photos_by_id: dict[str, dict] = {}
    reels_by_id: dict[str, dict] = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )

        try:
            cookie_file = _get_random_cookie_file()
            with open(cookie_file, "r") as f:
                cookies = json.load(f)
            await context.add_cookies(cookies)
        except Exception as e:
            print(f"Lỗi load cookies: {e}")

        page = await context.new_page()

        async def handle_response(response):
            resp_url = response.url
            if "/graphql/query" not in resp_url:
                return
            friendly = response.request.headers.get("x-fb-friendly-name", "")
            if not friendly.startswith(_SEARCH_GQL_PREFIX):
                return

            try:
                data = await response.json()
                medias = _extract_gql_items(data)
                for media in medias:
                    item = _parse_media_to_item(media)
                    if not item:
                        continue
                    code = item["code"]
                    if item["content_type"] == "reel":
                        if code not in reels_by_id:
                            reels_by_id[code] = item
                    else:
                        if code not in photos_by_id:
                            photos_by_id[code] = item
                print(f"  GQL: +{len(medias)} items → photos={len(photos_by_id)}, reels={len(reels_by_id)}")
            except Exception:
                pass

        page.on("response", handle_response)

        search_url = f"https://www.instagram.com/explore/search/keyword/?q={keyword}"
        await page.goto(search_url, wait_until="domcontentloaded")

        scroll_rounds = max(3, (max_items // 15) + 1)
        for _ in range(scroll_rounds):
            try:
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await asyncio.sleep(random.uniform(2.5, 5.5))
                try:
                    await page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass
            except Exception:
                break

        await browser.close()

    photos = list(photos_by_id.values())
    reels = list(reels_by_id.values())
    print(f"Instagram: {len(photos)} photos, {len(reels)} reels")
    return {"photos": photos, "reels": reels}




def crawl_instagram_all_sync(
    keyword: str, max_items: int = 20
) -> dict[str, list[dict]]:
    return _run_async(_crawl_instagram_async(keyword, max_items=max_items))


def crawl_instagram_sync(keyword: str, max_items: int = 20) -> list[dict]:
    result = crawl_instagram_all_sync(keyword, max_items=max_items)
    return result["photos"] + result["reels"]
