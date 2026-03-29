# crawlers/ — Social Media Crawlers + Crawl API Router

## Role
All social media crawling logic **and** the FastAPI routes for search, history,
and Pinterest upload live here. This is the backend for the `CrawlPage` frontend.

## Folder Structure

```
crawlers/
├── __init__.py               # Package exports (unchanged)
├── router.py                 # FastAPI routes for /api/search, /api/history/*, /api/pinterest/*
├── pinterest/
│   ├── __init__.py
│   ├── crawler.py            # Playwright/Selenium Pinterest crawler
│   ├── upload.py             # Pinterest pin upload + visual search
│   └── utils.py              # Pinterest-specific utilities
├── instagram_crawler.py      # Instagram crawler (Playwright)
├── tiktok_crawler.py         # TikTok crawler (Playwright)
├── reddit_crawler.py         # Reddit crawler (PRAW API)
├── youtube_crawler.py        # YouTube crawler
└── claude.md                 # This file
```

## Routes (router.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/history` | List all crawl history items (meta only) |
| GET | `/api/history/{id}` | Load full history (pins + by_source), optional `?sort_by=view_count` |
| GET | `/api/history/{id}/download` | Download history as UTF-8-BOM CSV |
| DELETE | `/api/history/{id}` | Delete history folder permanently |
| POST | `/api/search` | Multi-source crawl: Pinterest + Instagram + TikTok + Reddit + YouTube in parallel |
| GET | `/api/pinterest/default_cookie` | Load saved default Pinterest cookie string |
| POST | `/api/pinterest/save_cookie` | Save default Pinterest cookie string to file |
| POST | `/api/pinterest/upload_and_search` | Upload image to Pinterest, return similar pins |

## Pydantic Models (moved from backend_main.py)

```python
class KeywordRequest(BaseModel):
    keyword: str
    sources: list[str] | None = None
    limit_per_source: int | None = None
    pinterest_scroll_rounds: int | None = None
    pinterest_headless: bool | None = None
    pinterest_mode: str | None = None
    pinterest_saves_min: int | None = None
    pinterest_repins_min: int | None = None

class PinInfo(BaseModel): ...           # Common display schema for all sources
class SearchResponse(BaseModel): ...    # keyword + total + pins + pins_by_source + history_id
class HistoryItem(BaseModel): ...       # id + keyword + created_at + counts per source
class PinterestUploadSearchResponse(BaseModel): ...
```

## Key Behaviors

### Multi-source `/api/search`
- Runs up to 5 crawlers in parallel via `asyncio.gather()`
- Each crawler has a random 0–4s stagger to avoid rate-limit clustering
- `limit_per_source` controls how many items to request from each source
- Pinterest scroll rounds are auto-computed from limit but capped by `pinterest_scroll_rounds`
- All results normalized via `history_utils.normalize_to_display()`
- Final list sorted descending by `view_count`
- Result saved to `history/crawl/` and `history_id` returned

### `/api/history` Loading
- Scans `CRAWL_DIR`, `IMAGE_DIR`, `HISTORY_DIR` (in that order) for `info.json`
- De-duplicates by folder name (seen set)
- Sorted by `created_at` descending
- Instagram count merges `instagram_photo` + `instagram_reels`

### Pinterest Upload
- Saves uploaded image to a temp file for `upload_pin_sync`
- Temp file cleaned up in `finally` block
- Result normalized via `normalize_to_display(p, "pinterest")`
- Saved to `history/pinterest_image/` subdirectory

## Cookie Storage
- Pinterest: `cookies_pinterest/cookie_1.json` → `{"cookie_string": "..."}`
- Instagram: `cookies_instagram/` (managed by instagram_crawler.py directly)

## Crawler Notes
- `CRAWL_SOURCES = ("pinterest", "instagram", "tiktok", "reddit", "youtube")`
- Unknown sources in request → 400 error
- Individual crawler failures are caught and logged; other sources continue
- Instagram returns `{"photos": [...], "reels": [...]}` — special merging needed

## Tasks Done
- [x] Create `crawlers/router.py` with all routes listed above
- [x] Move `KeywordRequest`, `PinInfo`, `SearchResponse`, `HistoryItem`,
      `PinterestUploadSearchResponse` models into `router.py`
- [x] Move `load_history_meta()`, `load_history_detail()`, `build_history_csv()`,
      `_counts_by_source()` helpers into `router.py`
- [x] Register `crawlers_router` in `backend_main.py`
- [x] Remove extracted code from `backend_main.py`

## Knowledge Base
- `PinInfo` is the canonical shared display model — imported by
  `create_image_by_ai/router.py` for `PinInfoWithScore` and `PinInfoWithPromptScore`
- History utility functions come from `history_utils` at project root
  (future: will move to `services/history_utils.py`)
- `CRAWL_SOURCES` tuple defines valid source names for validation
