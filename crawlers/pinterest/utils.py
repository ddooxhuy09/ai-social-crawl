"""
Các helper dùng chung cho Pinterest crawler & uploader.
"""
import re
from pathlib import Path

PIN_HREF_RE = re.compile(r"/pin/(\d+)/?")
_BASE_DIR = Path(__file__).resolve().parent.parent.parent  # ai_pinterest root

_DEFAULT_MAX_PINS = 100
_DEFAULT_SCROLL_ROUNDS = 10
_DEFAULT_HEADLESS = True


def extract_pin_id_from_href(href: str | None) -> str | None:
    if not href:
        return None
    m = PIN_HREF_RE.search(href.strip())
    return m.group(1) if m else None


async def collect_pin_ids_from_page(page) -> list[str]:
    hrefs = await page.eval_on_selector_all(
        'a[href*="/pin/"]',
        "els => els.map(e => e.getAttribute('href'))",
    )
    pin_ids: list[str] = []
    seen: set[str] = set()
    for href in hrefs:
        pin_id = extract_pin_id_from_href(href)
        if pin_id and pin_id not in seen:
            seen.add(pin_id)
            pin_ids.append(pin_id)
    return pin_ids


async def get_pws_context(page) -> dict | None:
    data = await page.evaluate(
        """
        () => {
            const el = document.querySelector('#__PWS_DATA__');
            if (!el) return null;
            try {
                return JSON.parse(el.textContent || el.innerHTML || '{}');
            } catch (e) {
                return null;
            }
        }
        """
    )
    if not data:
        return None

    ctx = data.get("context") or {}
    return {
        "origin": ctx.get("origin", "https://www.pinterest.com"),
        "path": ctx.get("path", "/"),
        "experiment_hash": ctx.get("experiment_hash", ""),
        "app_version": data.get("appVersion", ""),
        "handler_id": data.get("initialHandlerId", ""),
    }


def build_pin_info(pin_data: dict) -> dict:
    pin_join = pin_data.get("pin_join", {}) or {}
    canonical_pin = pin_join.get("canonical_pin", {}) or {}
    pinner = pin_data.get("pinner", {}) or {}
    board = pin_data.get("board", {}) or {}
    reaction_counts = pin_data.get("reaction_counts") or {}
    aggregated = pin_data.get("aggregated_pin_data") or {}
    agg_stats = aggregated.get("aggregated_stats") or {}
    is_video = bool(pin_data.get("is_video")) or bool(pin_data.get("videos"))

    # Pinterest:
    # - Tổng số lần pin được save: aggregated_pin_data.aggregated_stats.saves
    # - Số repin hiện tại của pin này: repin_count
    save_count = int(agg_stats.get("saves") or 0)
    repin_count = int(pin_data.get("repin_count") or 0)
    reaction_count = sum(int(v) for v in reaction_counts.values()) or 0

    return {
        "pin_url": f"https://www.pinterest.com/pin/{pin_data.get('id', '')}",
        "canonical_pin_id": canonical_pin.get("id", ""),
        "title": pin_data.get("seo_title") or "",
        "description": pin_data.get("description") or "",
        "image_url": pin_data.get("image_medium_url") or "",
        "created_at": pin_data.get("created_at") or "",
        "save_count": save_count,
        "reaction_count": reaction_count,
        "repin_count": repin_count,
        "comment_count": int(aggregated.get("comment_count") or pin_data.get("comment_count") or 0),
        "share_count": pin_data.get("share_count", 0),
        "tracked_link": pin_data.get("tracked_link") or "",
        "pinner_username": pinner.get("username", ""),
        "pinner_full_name": pinner.get("full_name", ""),
        "board_name": board.get("name") or "",
        "board_url": f"https://www.pinterest.com{board.get('url') or ''}",
        "link": pin_data.get("link") or "",
        "hashtags": ", ".join(pin_data.get("hashtags") or []),
        "content_type": "video" if is_video else "photo",
        "source": "pinterest",
    }


def parse_cookie_string(cookie_str: str) -> list[dict]:
    cookies = []
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" not in part:
            continue
        name, _, value = part.partition("=")
        name = name.strip()
        value = value.strip()
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        cookies.append({
            "name": name,
            "value": value,
            "domain": ".pinterest.com",
            "path": "/",
            "httpOnly": name in ("_pinterest_sess", "__Secure-s_a"),
            "secure": True,
            "sameSite": "Lax",
        })
    return cookies
