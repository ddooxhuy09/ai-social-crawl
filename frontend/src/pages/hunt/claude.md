# frontend/src/pages/hunt/ — Etsy Hunt Page

## Role
UI for Etsy keyword research and product discovery using HEnull data.
Split from the original single `HuntPage.jsx` (85KB) into focused sub-components.

## Target Structure

```
frontend/src/pages/hunt/
├── index.jsx              # Main HuntPage — layout + sub-component orchestration
├── KeywordTable.jsx       # Keyword CSV table with NER columns, sorting, filtering
├── ProductTable.jsx       # Product search results table
├── HuntFilters.jsx        # Filter controls (competition, views, sales, reviews)
├── HuntHistoryPicker.jsx  # Modal/panel to select a previously saved keyword CSV
├── ClassifyPanel.jsx      # AI classify button + status display
└── claude.md              # This file
```

## Component Responsibilities

### `index.jsx`
- Imports and composes all sub-components
- Owns top-level state (active file, view mode: keywords vs products)
- Calls `useHuntData()` hook for all data operations
- Renders page layout: sidebar controls + main content area

### `KeywordTable.jsx`
- Renders keyword rows from CSV data
- Columns: keyword + all NER attributes (Màu sắc, Kích thước, etc.)
- Filters out `_rowId` column (internal React key — not a real column)
- Supports sort by column header click
- Shows classified NER data when available

### `ProductTable.jsx`
- Renders Etsy product search results from HEnull API
- Columns: product name, price, sales, favorites, reviews, listing date
- Works with `HuntFilters` for filter parameters

### `HuntFilters.jsx`
- Filter bar for product search
- Maps to `ProductListRequest` fields in the backend:
  price, sales_weekly, sales, favorites, reviews, competition, etc.

### `HuntHistoryPicker.jsx`
- Lists previously saved keyword CSV files
- Shows: filename, size_kb, created_at
- Allows user to select a file to load into `KeywordTable`

### `ClassifyPanel.jsx`
- "🤖 AI Classify" button — always visible (not conditional on file loaded)
- If no file loaded → opens `HuntHistoryPicker`
- If file loaded → calls `POST /api/etsy_hunt/history/{filename}/classify`
- Shows "⏳ Đang phân loại..." while in progress

## Known Issues Fixed
- `_rowId` was appearing as a table column
  Fix: `cols.filter(c => c !== "keyword" && c !== "_rowId")`
- AI Classify button was hidden when no file was loaded
  Fix: button always rendered; conditionally classifies or opens history picker

## Tasks Done
- [ ] Split `HuntPage.jsx` into sub-components listed above
- [ ] Create `HuntHistoryPicker.jsx`
- [ ] Move state to `useHuntData()` hook
