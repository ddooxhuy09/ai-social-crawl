# etsy_hunt — Folder Documentation

## Folder Structure

```
etsy_hunt/
├── router.py                  # FastAPI APIRouter — all /api/etsy_hunt/* and /api/open_henull routes
├── prompts.json               # AI prompts (Gemini NER classify keyword prompt)
├── etsy_hunt.py               # Playwright script — opened as subprocess to launch browser
├── etsy_hunt_keyword.py       # Keyword crawl logic (called by etsy_hunt.py)
├── etsy_hunt_product.py       # Product crawl logic (called by etsy_hunt.py)
├── export_etsy_keywords_csv.py   # Export keyword results to CSV
├── export_etsy_products_csv.py   # Export product results to CSV
├── henull_auth.json           # Captured JWT token + cookie from HEnull browser session
├── status.json                # Crawl status: {state, keyword, updated_at}
├── product_last_results.json  # Cache of last product search results
└── claude.md                  # This documentation file
```

## Routes (router.py)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/open_henull` | Launch browser via Playwright subprocess |
| GET | `/api/etsy_hunt/status` | Get current crawl state (idle/crawling) |
| GET | `/api/etsy_hunt/history` | List all keyword CSV files |
| GET | `/api/etsy_hunt/history/{filename}` | Load a keyword CSV as JSON rows |
| DELETE | `/api/etsy_hunt/history/{filename}` | Delete a keyword CSV |
| GET | `/api/etsy_hunt/history/{filename}/download` | Download a keyword CSV |
| POST | `/api/etsy_hunt/history/{filename}/classify` | Classify keywords via Gemini NER |
| GET | `/api/etsy_hunt/history/{filename}/classify` | Load saved classification JSON |
| GET | `/api/etsy_hunt/product_results` | Get latest product CSV (most recent file) |
| GET | `/api/etsy_hunt/product_history` | List all product CSV files |
| GET | `/api/etsy_hunt/product_history/{filename}` | Load a product CSV as JSON rows |
| DELETE | `/api/etsy_hunt/product_history/{filename}` | Delete a product CSV |
| GET | `/api/etsy_hunt/product_history/{filename}/download` | Download a product CSV |
| POST | `/api/etsy_hunt/products` | Proxy product list request to HEnull API |

## Tasks Done

1. **Extracted all etsy_hunt routes** from `backend_main.py` into `router.py`
2. **Created `prompts.json`** — moved the hardcoded NER classify prompt out of Python code into an editable JSON file. The `_load_prompt_template()` function reads from this file at runtime.
3. **Fixed "Mở HEnull" button**: explicitly uses `social_crawl/Scripts/python.exe` (venv with `undetected_playwright`) instead of the system/Anaconda Python.
4. **Fixed UnicodeEncodeError**: subprocess launched with `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1` env vars to handle Vietnamese print statements on Windows.

## Knowledge Base

### JWT Token (`henull_auth.json`)
- Contains `authorization` (Bearer JWT), `cookie`, `user-agent`, `saved_at`
- JWT payload has `expire` field (Unix timestamp) — checked before each API call in `projects/router.py`
- Token expires when `expire < time.time()` → returns 403 with descriptive message
- Token is captured automatically by `etsy_hunt.py` (Playwright intercepts XHR)

### Subprocess Launch (open_henull)
- Must use **venv Python** at `social_crawl/Scripts/python.exe` — not Anaconda's `python.exe`
- Reason: `undetected_playwright` is only installed in the venv
- Must set `PYTHONIOENCODING=utf-8` to avoid UnicodeEncodeError with Vietnamese console output

### NER Classify
- Prompt lives in `prompts.json` under `classify_keywords.prompt_template`
- Uses `{keywords_list}` placeholder — replaced with numbered keyword list at call time
- Batched in groups of 80 keywords per Gemini request
- Output: JSON array → converted to `{keyword: {attr: value}}` dict
- Saved as `{filename}_classified.json` alongside the original CSV

### History Directories
- Keyword CSVs: `history/hunt/keyword/*.csv`
- Product CSVs: `history/hunt/product/*.csv`
- Both directories are auto-created if missing

### HEnull Product API
- Endpoint: `https://lzgawl7j.realnull.com/api/product/list`
- Requires `authorization` header from `henull_auth.json`
- Backend acts as proxy to avoid CORS issues on the frontend
