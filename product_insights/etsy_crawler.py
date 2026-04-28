"""
Etsy listing review crawler.
Adapted from test/crawl-review-etsy.py — callable as an async function.
Runs headless=False so the user can solve CAPTCHA if Etsy shows one.
"""
import asyncio
import json
import logging
import pathlib
import re

logger = logging.getLogger(__name__)


def extract_listing_id(url: str) -> int:
    m = re.search(r"/listing/(\d+)", url)
    if not m:
        raise ValueError(f"Cannot extract listing_id from URL: {url}")
    return int(m.group(1))


def build_reviews_payload(listing_id: int, shop_id: int, page_num: int = 1) -> dict:
    return {
        "log_performance_metrics": True,
        "specs": {
            "deep_dive_reviews": [
                r"Etsy\Modules\ListingPage\Reviews\DeepDive\AsyncApiSpec",
                {
                    "listing_id": listing_id,
                    "shop_id": shop_id,
                    "scope": "listingReviews",
                    "page": page_num,
                    "sort_option": "Relevancy",
                    "rating_filter": None,
                    "tag_filters": [],
                    "review_highlight_transaction_id": None,
                    "should_lazy_load_images": False,
                    "should_show_variations": True,
                    "photo_aesthetics_ranking_dataset_version": "v1",
                },
            ]
        },
        "runtime_analysis": False,
    }


REVIEWS_API = "https://www.etsy.com/api/v3/ajax/bespoke/member/neu/specs/deep_dive_reviews"


async def crawl_etsy_reviews(
    url: str,
    progress_cb=None,
    on_captcha_detected=None,
    captcha_done_event: asyncio.Event | None = None,
) -> dict:
    """
    Crawl all reviews from an Etsy listing URL.
    Runs with headless=False — opens a visible browser window.

    If Etsy shows a CAPTCHA:
      1. Calls on_captcha_detected() so the caller can mark job status.
      2. Waits on captcha_done_event (set by caller when user clicks "Continue").
      3. Continues extracting CSRF + crawling after the event is set.

    progress_cb(page_done, total_pages) called after each page.
    Returns dict with product meta, description, reviews, etc.
    """
    from undetected_playwright.async_api import async_playwright

    listing_id = extract_listing_id(url)
    description = ""
    all_reviews: list[dict] = []
    page_meta: dict = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-web-security",
            ],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1366, "height": 768},
            locale="en-US",
            timezone_id="America/New_York",
            java_script_enabled=True,
        )
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
        """)

        page = await context.new_page()

        # Navigate to listing
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
            await page.wait_for_timeout(5000)
        except Exception:
            pass

        # ── CAPTCHA detection ─────────────────────────────────────────────────
        current_url = page.url
        captcha = await page.query_selector(
            "iframe[src*='hcaptcha'], iframe[src*='datadome'], #datadome, #hcaptcha"
        )
        if captcha or "datadome" in current_url or "challenge" in current_url:
            if on_captcha_detected:
                on_captcha_detected()
            if captcha_done_event:
                await captcha_done_event.wait()
            else:
                await asyncio.sleep(180)
            await page.wait_for_timeout(4000)

        await page.wait_for_timeout(10_000)

        product_name = ""
        try:
            title_el = await page.query_selector("h1[data-buy-box-listing-title]")
            if not title_el:
                title_el = await page.query_selector("h1")
            if title_el:
                product_name = (await title_el.inner_text()).strip()
        except Exception:
            pass

        shop_name = ""
        try:
            shop_el = await page.query_selector("a[href*='/shop/']")
            if shop_el:
                shop_name = (await shop_el.inner_text()).strip()
        except Exception:
            pass

        price = ""
        original_price = ""
        on_sale = False
        avg_rating = ""
        total_review_count = ""
        total_sales = ""
        tags = []
        image_urls = []

        try:
            raw = await page.evaluate("""() => {
                const r = {price:'', original_price:'', on_sale:false, avg_rating:'', total_review_count:'', total_sales:'', tags:[]};

                // --- PRICE ---
                const bb = document.querySelector('[data-buy-box-region="price"]');
                if (bb) {
                    const priceP = bb.querySelector('p.wt-text-title-larger');
                    if (priceP) {
                        let t = priceP.textContent.trim();
                        t = t.replace(/^Price\\s*:\\s*/i, '');
                        if (t) r.price = t;
                    }
                    const origP = bb.querySelector('p.wt-text-caption');
                    if (origP) {
                        let t = origP.textContent.trim();
                        t = t.replace(/^Original Price\\s*:\\s*/i, '');
                        if (t) { r.original_price = t; r.on_sale = true; }
                    }
                    if (!r.original_price) {
                        const strike = bb.querySelector('span.wt-text-strikethrough');
                        if (strike) {
                            r.original_price = strike.textContent.trim();
                            r.on_sale = true;
                        }
                    }
                }

                // --- STRUCTURED DATA (aggregateRating) ---
                let structuredRating = null;
                document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
                    try {
                        const d = JSON.parse(s.textContent);
                        if (d['@type'] === 'Product' && d.aggregateRating) {
                            structuredRating = d.aggregateRating;
                        }
                    } catch(e) {}
                });

                // --- AVG RATING ---
                if (structuredRating && structuredRating.ratingValue) {
                    r.avg_rating = String(structuredRating.ratingValue);
                }

                // --- REVIEW COUNT (prefer listing-specific over shop aggregate) ---
                const rc = document.querySelector('[data-appears-component-name="listing_page_reviews_container_top"]');
                if (rc) {
                    try {
                        const ed = JSON.parse(rc.getAttribute('data-appears-event-data') || '{}');
                        if (ed.listing_rating_count) r.total_review_count = String(ed.listing_rating_count);
                    } catch(e) {}
                }
                if (!r.total_review_count && structuredRating && structuredRating.reviewCount) {
                    r.total_review_count = String(structuredRating.reviewCount);
                }

                // --- SALES ---
                const body = document.body?.innerText || '';
                const sm = body.match(/([\\d,.]+k?)\\s+sales/i);
                if (sm) r.total_sales = sm[1];

                // --- TAGS ---
                document.querySelectorAll('[data-tag]').forEach(el => {
                    const type = el.getAttribute('data-tag-type');
                    if (type === 'Expressive' || type === 'Informative') {
                        const txt = el.textContent.trim();
                        if (txt && !r.tags.includes(txt)) r.tags.push(txt);
                    }
                });

                return r;
            }""")
            if raw.get("price"):
                price = raw["price"]
            if raw.get("original_price"):
                original_price = raw["original_price"]
            on_sale = raw.get("on_sale", False)
            if raw.get("avg_rating"):
                avg_rating = raw["avg_rating"]
            if raw.get("total_review_count"):
                total_review_count = raw["total_review_count"]
            if raw.get("total_sales"):
                total_sales = raw["total_sales"]
            if raw.get("tags"):
                tags = raw["tags"]
            print(f"[DEBUG] extract: price={price!r} avg_rating={avg_rating!r} review_count={total_review_count!r} sales={total_sales!r} tags_count={len(tags)}", flush=True)
        except Exception as e:
            print(f"[DEBUG] raw extract failed: {e}", flush=True)

        image_urls = []
        try:
            image_urls = await page.evaluate("""
                () => [...document.querySelectorAll('meta[property="og:image"]')]
                    .map(t => t.content).filter(Boolean)
            """)
        except Exception:
            pass

        page_meta = {
            "product_name": product_name,
            "shop_name": shop_name,
            "price": price,
            "original_price": original_price or None,
            "on_sale": on_sale,
            "avg_rating": avg_rating,
            "total_review_count": total_review_count,
            "total_sales": total_sales,
            "tags": tags,
            "image_urls": image_urls,
        }

        # ── Extract description (Playwright for JS-rendered content) ───────────
        try:
            desc_sel = "p[data-product-details-description-text-content]"
            await page.wait_for_selector(desc_sel, timeout=20_000)
            read_more_btn = await page.query_selector("button[data-read-more='true']")
            if read_more_btn:
                await read_more_btn.click()
                await page.wait_for_timeout(400)
            desc_el = await page.query_selector(desc_sel)
            if desc_el:
                description = (await desc_el.inner_text()).strip()
        except Exception:
            pass

        # ── Extract CSRF token and shop_id ────────────────────────────────────
        csrf_token = None
        shop_id = None
        for _ in range(3):
            csrf_token, shop_id = await page.evaluate("""
                () => {
                    const text = [...document.querySelectorAll('script')]
                        .map(s => s.textContent).join('\\n');
                    const csrf = (text.match(/"csrf_nonce"\\s*:\\s*"([^"]+)"/) ||
                                  text.match(/"csrfToken"\\s*:\\s*"([^"]+)"/) || [])[1] || null;
                    const sid  = (text.match(/"shop_id"\\s*:\\s*(\\d+)/) || [])[1] || null;
                    return [csrf, sid ? parseInt(sid) : null];
                }
            """)
            if csrf_token and shop_id:
                break
            await page.wait_for_timeout(4000)

        if not csrf_token or not shop_id:
            await browser.close()
            raise RuntimeError(
                "Could not extract CSRF token or shop_id. "
                "The page may not have loaded correctly — try again."
            )

        # ── Paginate reviews ──────────────────────────────────────────────────
        page_num = 1
        total_pages = 1
        while page_num <= total_pages:
            payload = build_reviews_payload(listing_id, int(shop_id), page_num)
            resp = await context.request.post(
                REVIEWS_API,
                headers={
                    "content-type": "application/json",
                    "x-csrf-token": csrf_token,
                    "x-requested-with": "XMLHttpRequest",
                },
                data=json.dumps(payload),
            )
            if resp.status != 200:
                break

            data = await resp.json()
            js_data = data.get("jsData", {})
            reviews = js_data.get("reviews", [])
            for r in reviews:
                text = r.get("reviewContent", {}).get("reviewText", "")
                if not text:
                    continue
                author = (
                    r.get("buyerInfo", {}).get("name", "")
                    or ""
                )
                rating = (
                    r.get("reviewInfo", {}).get("rating")
                    or 0
                )
                all_reviews.append({
                    "author": author,
                    "rating": rating,
                    "text": text,
                })

            total_pages = js_data.get("totalPages", 1)
            if progress_cb:
                progress_cb(page_num, total_pages)
            if page_num >= total_pages:
                break
            page_num += 1
            await page.wait_for_timeout(1500)

        await browser.close()

    return {
        **page_meta,
        "description": description,
        "reviews": all_reviews,
        "total": len(all_reviews),
    }
