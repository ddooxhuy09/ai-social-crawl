"""
Instagram Reel/Post comment crawler.
Adapted from test/ig.py — callable as an async function.
Cookies file: social_research/ig_cookies.json (managed manually on server).
"""
import asyncio
import json
import urllib.parse
from pathlib import Path

COOKIES_PATH = Path(__file__).parent / "ig_cookies.json"
CACHE_PATH = Path(__file__).parent / "ig_request_cache.json"
GRAPHQL_URL = "https://www.instagram.com/graphql/query"
TARGET_FRIENDLY_NAME = "PolarisPostCommentsContainerQuery"

_USEFUL_HEADERS = {
    "content-type", "x-csrftoken", "x-ig-app-id", "x-fb-lsd",
    "x-fb-friendly-name", "x-asbd-id", "x-bloks-version-id",
    "cookie", "user-agent", "x-ig-www-claim",
}


def _has_cookies() -> bool:
    return COOKIES_PATH.exists()


async def _capture_headers(reel_url: str) -> dict | None:
    """Open Playwright once to capture GraphQL request headers, then close."""
    from undetected_playwright.async_api import async_playwright

    if not _has_cookies():
        raise RuntimeError(
            "Instagram cookies not found. Place ig_cookies.json in social_research/."
        )

    cookies = json.loads(COOKIES_PATH.read_text(encoding="utf-8"))
    captured = asyncio.Event()
    first_request_info: dict = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0"
            )
        )
        await context.add_cookies(cookies)
        page = await context.new_page()

        async def handle_response(response):
            if "graphql/query" not in response.url or captured.is_set():
                return
            try:
                req = response.request
                if req.headers.get("x-fb-friendly-name") != TARGET_FRIENDLY_NAME:
                    return
                data = await response.json()
                body = req.post_data or ""
                params = dict(urllib.parse.parse_qsl(body))
                useful_headers = {
                    k: v for k, v in req.headers.items()
                    if k.lower() in _USEFUL_HEADERS
                }
                first_request_info["headers"] = useful_headers
                first_request_info["params"] = params
                first_request_info["data"] = data
                captured.set()
            except Exception:
                pass

        page.on("response", handle_response)
        await page.goto(reel_url, wait_until="domcontentloaded")

        try:
            await asyncio.wait_for(captured.wait(), timeout=20)
        except asyncio.TimeoutError:
            await browser.close()
            raise RuntimeError(
                "Could not capture Instagram API headers. Check cookies validity."
            )

        # Save cache (headers + params only, no data) for fast subsequent runs
        CACHE_PATH.write_text(
            json.dumps(
                {"headers": first_request_info["headers"], "params": first_request_info["params"]},
                indent=2,
            ),
            encoding="utf-8",
        )
        await browser.close()

    return first_request_info


async def _fetch_all_comments(request_info: dict, progress_cb=None) -> list[dict]:
    """Use aiohttp to paginate through all comment pages directly."""
    import aiohttp

    all_comments: list[dict] = []
    params = dict(request_info["params"])
    headers = dict(request_info["headers"])
    headers.pop("content-length", None)
    headers.pop("Content-Length", None)
    headers.pop("accept-encoding", None)

    # If we have the first page data already, extract it
    page_info: dict = {}
    if "data" in request_info:
        conn = request_info["data"].get("data", {}).get(
            "xdt_api__v1__media__media_id__comments__connection", {}
        )
        edges = conn.get("edges", [])
        all_comments.extend(e["node"] for e in edges if "node" in e)
        page_info = conn.get("page_info", {})
    else:
        variables = json.loads(params.get("variables", "{}"))
        variables.pop("after", None)
        params["variables"] = json.dumps(variables, separators=(",", ":"))
        page_info = {"has_next_page": True, "end_cursor": None}

    page_num = 2 if "data" in request_info else 1

    async with aiohttp.ClientSession() as session:
        while page_info.get("has_next_page"):
            end_cursor = page_info.get("end_cursor")
            if end_cursor:
                variables = json.loads(params.get("variables", "{}"))
                variables["after"] = end_cursor
                params["variables"] = json.dumps(variables, separators=(",", ":"))

            body_str = urllib.parse.urlencode(params)
            try:
                async with session.post(GRAPHQL_URL, headers=headers, data=body_str) as resp:
                    text = await resp.text()
                    if text.startswith("for (;;);"):
                        text = text[len("for (;;);"):]
                    data = json.loads(text)
                    conn = data.get("data", {}).get(
                        "xdt_api__v1__media__media_id__comments__connection", {}
                    )
                    edges = conn.get("edges", [])
                    page_info = conn.get("page_info", {})
                    all_comments.extend(e["node"] for e in edges if "node" in e)
                    if progress_cb:
                        progress_cb(len(all_comments))
                    page_num += 1
            except Exception:
                break

    return all_comments


def _extract_text(comment_node: dict) -> str:
    return comment_node.get("text", "")


async def crawl_ig_comments(url: str, progress_cb=None) -> dict:
    """
    Crawl all comments from an Instagram Reel or Post URL.
    Returns {"comments": [str, ...], "total": int}
    Tries cache first; falls back to Playwright header capture.
    progress_cb(done_count) called after each page if provided.
    """
    request_info: dict | None = None

    # Fast path: use cached headers if available
    if CACHE_PATH.exists():
        try:
            request_info = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            request_info = None

    # Slow path: capture via Playwright
    if not request_info:
        request_info = await _capture_headers(url)

    nodes = await _fetch_all_comments(request_info, progress_cb=progress_cb)
    comments = [_extract_text(n) for n in nodes if _extract_text(n)]

    return {"comments": comments, "total": len(comments)}
