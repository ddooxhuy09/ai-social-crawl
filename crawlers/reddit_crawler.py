"""
Crawler Reddit qua JSON API: https://www.reddit.com/search.json?q=keyword&limit=N
Trả về list post dạng native (url, title, score, image_url, ...) để backend normalize.
"""
from __future__ import annotations

import os
import random
import time
import urllib.parse
from datetime import datetime
from typing import Any

import requests

REDDIT_BASE = "https://www.reddit.com"
SEARCH_URL = "https://www.reddit.com/search.json"

# Reddit yêu cầu User-Agent rõ ràng, không dùng mặc định
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _image_url_from_post(data: dict) -> str:
    """
    Lấy URL ảnh tốt nhất cho post: ưu tiên preview.source, fallback thumbnail.
    thumbnail có thể là "default" | "self" | "nsfw" | URL.
    """
    thumb = (data.get("thumbnail") or "").strip()
    if thumb and thumb not in ("default", "self", "nsfw", ""):
        return thumb
    try:
        preview = data.get("preview") or {}
        images = preview.get("images") or []
        if images and isinstance(images[0], dict):
            source = (images[0].get("source") or {}).get("url")
            if source:
                # Reddit trả về &amp; trong URL, decode cho đúng
                return source.replace("&amp;", "&")
    except (IndexError, KeyError, TypeError):
        pass
    return ""


def _parse_post(child: dict) -> dict | None:
    """Parse một item trong data.children (kind t3) sang dict native Reddit."""
    if (child.get("kind") or "") != "t3":
        return None
    data = child.get("data")
    if not data or not isinstance(data, dict):
        return None

    post_id = data.get("id") or ""
    permalink = (data.get("permalink") or "").strip()
    if permalink and not permalink.startswith("http"):
        url = REDDIT_BASE + permalink
    else:
        url = data.get("url") or ""

    created_utc = data.get("created_utc")
    if isinstance(created_utc, (int, float)):
        created_str = datetime.utcfromtimestamp(int(created_utc)).strftime("%Y-%m-%d %H:%M:%S")
    else:
        created_str = str(created_utc or "")

    return {
        "id": post_id,
        "url": url,
        "title": data.get("title") or "",
        "selftext": data.get("selftext") or "",
        "author": data.get("author") or "",
        "subreddit": data.get("subreddit") or "",
        "subreddit_name_prefixed": data.get("subreddit_name_prefixed") or "",
        "score": int(data.get("score", 0)),
        "num_comments": int(data.get("num_comments", 0)),
        "created_utc": created_str,
        "thumbnail": data.get("thumbnail") or "",
        "image_url": _image_url_from_post(data),
        "permalink": permalink,
        "is_video": bool(data.get("is_video")),
        "domain": data.get("domain") or "",
    }


def crawl_reddit_sync(keyword: str, max_items: int = 20) -> list[dict]:
    """
    Crawl Reddit search theo keyword qua JSON API.
    Trả về list post native (url, title, score, image_url, ...), tối đa max_items.
    """
    if not keyword or not keyword.strip():
        return []

    q = keyword.strip()
    params: dict[str, Any] = {
        "q": q,
        "limit": min(max_items, 25),  # Reddit tối đa 25/lần
        "restrict_sr": "false",
        "sort": "relevance",
    }
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
    proxies = None
    if os.getenv("HTTP_PROXY"):
        proxies = {"http": os.getenv("HTTP_PROXY"), "https": os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")}

    all_posts: list[dict] = []
    after: str | None = None

    while len(all_posts) < max_items:
        if after:
            params["after"] = after
            time.sleep(random.uniform(1.2, 3.5))
        params["limit"] = min(25, max_items - len(all_posts))

        try:
            resp = requests.get(
                SEARCH_URL,
                params=params,
                headers=headers,
                proxies=proxies,
                timeout=15,
            )
            resp.raise_for_status()
            body = resp.json()
        except Exception as e:
            print(f"Reddit crawl lỗi: {e}")
            break

        data = body.get("data")
        if not data:
            break
        children = data.get("children") or []
        after = data.get("after")

        for child in children:
            post = _parse_post(child)
            if post and post.get("id"):
                all_posts.append(post)
                if len(all_posts) >= max_items:
                    break
        if not children or not after:
            break

    return all_posts[:max_items]


if __name__ == "__main__":
    import sys
    kw = sys.argv[1] if len(sys.argv) > 1 else "turtle"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    posts = crawl_reddit_sync(kw, max_items=n)
    print(f"Got {len(posts)} Reddit posts for keyword '{kw}'")
    for i, p in enumerate(posts[:3], 1):
        title = (p.get("title") or "")[:60].encode("ascii", errors="replace").decode()
        img = (p.get("image_url") or "")[:50]
        print(f"  {i}. {title}... | score={p.get('score')} | {img}...")
