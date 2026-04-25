"""
Fetch external trend signals for a product using Tavily search and Google Trends.
No LLM synthesis — raw data only.
"""
import asyncio
import os


def _extract_base_keyword(product_name: str) -> str:
    """Extract a short, clean niche keyword from the product title.
    Takes the first segment (before '|', '-', or ','), then keeps the first 4 words.
    """
    segment = product_name.split("|")[0].split(" - ")[0].split(",")[0].strip()
    words = segment.split()
    # Drop trailing noise words like "Pattern", "Bundle", "PDF", "Digital", "File"
    noise = {"pattern", "bundle", "pdf", "digital", "file", "printable", "download", "set", "pack"}
    cleaned = [w for w in words if w.lower() not in noise]
    return " ".join(cleaned[:4]).strip() or segment[:40]


def _build_trend_queries(product_name: str, tags: list[str] = None) -> list[str]:
    base = _extract_base_keyword(product_name)
    if not base:
        return []
    return [
        f"{base} viral site:tiktok.com",
        f"{base} site:instagram.com",
        f"{base} ideas site:pinterest.com",
        f"{base} discussion site:reddit.com",
        f"{base} trending 2025",
        f"{base} site:etsy.com trending",
    ]


async def fetch_tavily_results(queries: list[str]) -> list[dict]:
    """Run Tavily searches for each query. Returns list of {query, results, error?}."""
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        raise ValueError("TAVILY_API_KEY is not set in .env")

    from tavily import TavilyClient
    client = TavilyClient(api_key=api_key)
    loop = asyncio.get_event_loop()

    output = []
    for query in queries:
        try:
            response = await loop.run_in_executor(
                None,
                lambda q=query: client.search(query=q, search_depth="basic", max_results=5),
            )
            output.append({
                "query": query,
                "results": response.get("results", []),
            })
        except Exception as e:
            output.append({"query": query, "results": [], "error": str(e)})

    return output


def fetch_google_trends(keyword: str) -> dict:
    """Fetch Google Trends data via SerpApi (blocking — run in executor).
    Makes two requests: TIMESERIES (interest over time) and GEO_MAP_0 (interest by region).
    Returns raw SerpApi structures unchanged.
    """
    import httpx

    _EMPTY = {"keyword": keyword, "interest_over_time": [], "interest_by_region": []}

    api_key = os.environ.get("SERPAPI_API_KEY", "").strip()
    if not api_key:
        return {**_EMPTY, "error": "SERPAPI_API_KEY is not set in .env"}

    base_params = {
        "engine": "google_trends",
        "q": keyword,
        "api_key": api_key,
    }

    def _get(data_type: str) -> dict:
        resp = httpx.get(
            "https://serpapi.com/search.json",
            params={**base_params, "data_type": data_type},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    interest_over_time = []
    interest_by_region = []
    errors = []

    try:
        ts_data = _get("TIMESERIES")
        interest_over_time = ts_data.get("interest_over_time", {}).get("timeline_data", [])
    except Exception as e:
        errors.append(f"TIMESERIES: {e}")

    try:
        geo_data = _get("GEO_MAP_0")
        interest_by_region = geo_data.get("interest_by_region", [])
    except Exception as e:
        errors.append(f"GEO_MAP_0: {e}")

    result = {
        "keyword": keyword,
        "interest_over_time": interest_over_time,
        "interest_by_region": interest_by_region,
    }
    if errors:
        result["error"] = "; ".join(errors)
    return result
