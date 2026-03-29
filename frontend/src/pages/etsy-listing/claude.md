# frontend/src/pages/etsy-listing/ — Etsy Listing Generator Page

## Role
UI for the 5-step AI listing generation pipeline (REQ1–REQ5).
Split from the original single `EtsyListingPage.jsx` (52KB) into per-step components.

## Target Structure

```
frontend/src/pages/etsy-listing/
├── index.jsx              # Main EtsyListingPage — step navigator + shared state
├── Req1Keywords.jsx       # Step 1: Keyword extraction from Etsy URL
├── Req2Title.jsx          # Step 2: AI title generation
├── Req3Tags.jsx           # Step 3: AI tag generation (13 tags)
├── Req4Description.jsx    # Step 4: AI description + pattern file auto-fill
├── Req5AltText.jsx        # Step 5: Image alt-text generation
└── claude.md              # This file
```

## Component Responsibilities

### `index.jsx`
- Renders step progress bar (REQ1 → REQ5)
- Owns `listing_name` (shared session key for all REQ history)
- Owns `listingHistory` (full history object from backend)
- Passes relevant slice of history as props to each REQ component

### `Req1Keywords.jsx`
- Input: Etsy product URL
- Button: "Fetch Keywords" → `POST /api/listing/keywords`
- Displays scored keyword table
- Shows seed keyword selection

### `Req2Title.jsx`
- Input: seed keyword (pre-filled from REQ1)
- Button: "Generate Title" → `POST /api/listing/generate_title`
- Displays generated title with copy button

### `Req3Tags.jsx`
- Button: "Generate Tags" → `POST /api/listing/generate_tags`
- Displays 13 tags as chips with copy-all button

### `Req4Description.jsx`
- Inputs: listing_title, materials_skill_level, finished_sizes, story_ideas, shop_link
- **"📄 Auto-fill from file"** button:
  - Opens hidden file input (`.docx`, `.pdf`)
  - `POST /api/listing/extract-pattern-info` → auto-fills all 4 text fields
  - Shows "⏳ Extracting..." during upload; toast on success/error
- Button: "Generate Description" → `POST /api/listing/generate_description`
- Displays formatted description with copy button

### `Req5AltText.jsx`
- Image upload area (one or more images)
- Button: "Generate Alt Text" → `POST /api/listing/generate_alt_text`
- Displays alt text per image with copy button

## Shared State (in `index.jsx`)
- `listingName` — string key identifying the listing session
- `listingHistory` — full JSON from backend `build_listing_history_response()`:
  - `history.req1` → keyword data
  - `history.req2` → title data
  - `history.req3` → tags data
  - `history.req4` → description + section data
  - `history.req5` → alt text data

## Tasks Done
- [x] REQ4 "Auto-fill from file" feature implemented (in current `EtsyListingPage.jsx`)
- [x] Backend endpoint `POST /api/listing/extract-pattern-info` created

## Pending
- [ ] Split `EtsyListingPage.jsx` into sub-components listed above
- [ ] Create `useEtsyListing()` hook in `frontend/src/hooks/`
