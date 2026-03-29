# etsy_listing/ — Etsy Listing AI Generator

## Role
AI-powered Etsy product listing generator. Organizes the 5-step REQ pipeline
for generating keywords, title, tags, description, and image alt-text.
Backend for the `EtsyListingPage` frontend.

## Folder Structure

```
etsy_listing/
├── listings_router.py              # Aggregates req1–req5 routers into one APIRouter
├── req1_list_keywords.py           # REQ1: Extract/score keywords from Etsy product URL
├── req2_generate_title_listing.py  # REQ2: Generate Etsy listing title using AI
├── req3_generate_tags.py           # REQ3: Generate 13 Etsy tags using AI
├── req4_generate_description_listing.py  # REQ4: Generate structured description + extract from docx/pdf
├── req5_generate_image_alt_text.py # REQ5: Generate alt-text for product images
├── shared.py                       # Shared helpers (history I/O, prompt loader, etc.)
├── prompts.json                    # All Gemini prompts for REQ1–REQ5 (externalized)
└── claude.md                       # This file
```

## Routes

All routes aggregated through `listings_router.py`, included in `backend_main.py`
as `app.include_router(listings_router)`.

| Method | Path | REQ | Description |
|--------|------|-----|-------------|
| POST | `/api/listing/keywords` | REQ1 | Crawl and score keywords from Etsy product |
| POST | `/api/listing/generate_title` | REQ2 | AI-generate listing title |
| POST | `/api/listing/generate_tags` | REQ3 | AI-generate 13 Etsy tags |
| POST | `/api/listing/generate_description` | REQ4 | AI-generate full structured description |
| POST | `/api/listing/extract-pattern-info` | REQ4 | Extract fields from .docx/.pdf pattern file |
| POST | `/api/listing/generate_alt_text` | REQ5 | AI-generate image alt text |

## REQ Pipeline Flow

```
User uploads product → REQ1 (keywords) → REQ2 (title) → REQ3 (tags)
                                       → REQ4 (description, can import .docx/.pdf)
                                       → REQ5 (alt text for images)
```

Each REQ reads from and writes to a shared `listing_history` JSON file
stored in `history/etsy-listing/listing/{listing_name}.json`.

## Shared Utilities (`shared.py`)

- `load_listing_history(listing_name)` — load or create listing JSON
- `save_listing_history(history)` — write listing JSON back to disk
- `build_listing_history_response(history)` — format response for frontend
- `get_prompt_config(key)` — load a prompt config from `prompts.json`
- `now_iso()` — current timestamp as ISO string
- `raise_for_ai_error(e, context)` — unified AI error handler
- `strip_code_fence(text)` — strip ```json fences from Gemini output

## REQ4 Special Feature: Pattern File Import
- Accepts `.docx` or `.pdf` file upload
- Extracts text using `python-docx` / `pypdf`
- Sends text (up to 6000 chars) to Gemini to extract:
  `listing_title`, `materials_skill_level`, `finished_sizes`, `story_ideas`
- Returns extracted fields to auto-fill the REQ4 form in the frontend
- Dependencies in `requirements.txt`: `python-docx`, `pypdf`

## Description Text Format (REQ4 output)
```
🌸 {listing_title}
________________________________________
✨ PLEASE READ BEFORE PURCHASING
• {digital_notice_lines}
________________________________________
🧶 Materials & Skill Level
• {materials_skill_level_lines}
________________________________________
📏 Finished Sizes
• {finished_sizes_lines}
________________________________________
💛 Product Story
{brand_story_paragraph}
________________________________________
📜 Usage & Copyright
• {copyright_lines}
________________________________________
🌿 {shop_link}
```

## Prompts Structure (`prompts.json`)
Each REQ has its own entry:
```json
{
  "req1_keyword_extractor":      { "role": "...", "task": "...", "rules": [...] },
  "req2_title_generator":        { "role": "...", "task": "...", "rules": [...] },
  "req3_tags_generator":         { "role": "...", "task": "...", "rules": [...] },
  "req4_description_generator":  { "role": "...", "task": "...", "rules": [...] },
  "req5_alt_text_generator":     { "role": "...", "task": "...", "rules": [...] }
}
```

## Tasks Done
- [x] REQ4: Added pattern file import (.docx/.pdf) → Gemini field extraction
- [x] All 5 REQ routers separated into individual files
- [x] Prompts externalized to `prompts.json`

## Knowledge Base
- Gemini model: `GEMINI_TEXT_MODEL` (from `create_image_by_ai.image_generator`)
- All AI responses are JSON; `strip_code_fence()` handles ```json``` wrapping
- Listing history persists all REQ outputs together in one JSON file per listing
- `temperature=0.65` for descriptive content, `temperature=0.2` for structured extraction
