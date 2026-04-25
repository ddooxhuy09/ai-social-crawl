import re
from bs4 import BeautifulSoup
from .utils import log_session

ITEMS_PER_PAGE = 20


def parse_listing_cards(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    cards = soup.find_all(attrs={"data-listing-card-v2": True})

    for card in cards:
        listing_id = card.get("data-listing-id", "").strip()
        if not listing_id:
            continue

        img = card.find("img", attrs={"data-listing-card-listing-image": True})
        image_url = img["src"] if img and img.get("src") else ""

        title_tag = card.find("h3", id=f"listing-title-{listing_id}")
        title = title_tag.get_text(strip=True) if title_tag else ""

        link_tag = card.find("a", attrs={"data-listing-link": True})
        listing_url = link_tag["href"].split("?")[0] if link_tag and link_tag.get("href") else f"https://www.etsy.com/listing/{listing_id}"

        price_val = ""
        currency = ""
        screen_reader = card.find("span", class_="wt-screen-reader-only", string=re.compile(r"Sale Price|Price"))
        if screen_reader:
            raw = screen_reader.get_text(strip=True)
            m = re.search(r"[\d,\.]+", raw)
            if m:
                price_val = m.group(0)
            currency_tag = card.find("span", class_="currency-symbol")
            currency = currency_tag.get_text(strip=True) if currency_tag else ""
        else:
            val_tag = card.find("span", class_="currency-value")
            sym_tag = card.find("span", class_="currency-symbol")
            price_val = val_tag.get_text(strip=True) if val_tag else ""
            currency = sym_tag.get_text(strip=True) if sym_tag else ""

        review_rating = ""
        review_count = ""
        review_div = card.find("div", role="img", attrs={"aria-label": re.compile(r"star rating")})
        if review_div:
            label = review_div.get("aria-label", "")
            m_rating = re.search(r"([\d.]+)\s+star", label)
            m_count = re.search(r"with\s+([\d.,k]+)\s+review", label)
            review_rating = m_rating.group(1) if m_rating else ""
            review_count = m_count.group(1) if m_count else ""

        shop_tag = card.find("p", attrs={"data-seller-name-container": True})
        shop_name = ""
        if shop_tag:
            visible = shop_tag.find("span", attrs={"aria-hidden": "true"})
            shop_name = visible.get_text(strip=True) if visible else ""

        results.append({
            "listing_id": listing_id,
            "title": title,
            "listing_url": listing_url,
            "image_url": image_url,
            "price": price_val,
            "currency": currency,
            "shop_name": shop_name,
            "review_rating": review_rating,
            "review_count": review_count,
        })

    return results


async def fetch_favorite_items(page, profile_url: str, session_id: str, buyer_id: str):
    log_session(session_id, buyer_id, "[Items] Scraping favorite listings (all pages)...")
    all_items: list[dict] = []
    page_num = 1

    while True:
        log_session(session_id, buyer_id, f"  -- Page {page_num} --")
        if page_num > 1:
            url = f"{profile_url}?page={page_num}"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                await page.wait_for_timeout(2500)
            except Exception as e:
                log_session(session_id, buyer_id, f"  Navigation error: {e}")
                break

        html = await page.content()
        cards = parse_listing_cards(html)

        if not cards:
            log_session(session_id, buyer_id, "  No cards found — stopping.")
            break

        all_items.extend(cards)
        log_session(session_id, buyer_id, f"  -> {len(cards)} items | Total: {len(all_items)}")

        if len(cards) < ITEMS_PER_PAGE:
            log_session(session_id, buyer_id, "  Last page reached.")
            break

        page_num += 1
        await page.wait_for_timeout(1500)

    return all_items, len(all_items)
