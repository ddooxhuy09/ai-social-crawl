# product_requirements/ — AI Product Requirements Generator

## Role
Generates structured product requirement documents using Gemini AI.
Used by sellers to create detailed specs before designing or listing a product.
Backend for the `ProductRequirementsPage` frontend.

## Folder Structure

```
product_requirements/
├── __init__.py     # Empty package marker
├── router.py       # FastAPI APIRouter — /api/requirements/* routes
├── prompts.py      # Gemini prompt for requirements generation
└── claude.md       # This file
```

## Routes (router.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/requirements` | List all requirement documents |
| GET | `/api/requirements/{doc_name}` | Load a specific document |
| POST | `/api/requirements` | Create a new blank document |
| PUT | `/api/requirements/{doc_name}` | Update document content |
| DELETE | `/api/requirements/{doc_name}` | Delete a document |
| POST | `/api/requirements/{doc_name}/generate` | AI-generate requirements from brief |

## Data Model

Documents stored in `history/product-requirements/{slug}.json`:

```json
{
  "doc_name": "My Crochet Blanket",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "brief": "Short description from user",
  "content": "AI-generated full requirements text (markdown)"
}
```

## Document Slug
- `_slugify(name)` converts doc name to URL-safe slug
- Example: `"My Crochet Blanket!"` → `"my-crochet-blanket"`
- Used as filename: `history/product-requirements/my-crochet-blanket.json`

## AI Generation
- Calls `_get_gemini_client()` from `create_image_by_ai.image_generator`
- Uses `PRODUCT_REQUIREMENTS_PROMPT` from `prompts.py`
- Input: user's `brief` text
- Output: structured requirements document (markdown-formatted)

## Helpers
- `_slugify(name)` — convert doc name to URL-safe slug
- `_doc_path(doc_name)` → `Path` to the JSON file
- `_now()` → ISO timestamp string
- `_read_doc(doc_name)` → load and parse JSON, 404 if missing
- `_write_doc(doc)` → write JSON, auto-set `updated_at`

## Tasks Done
- [x] Separated from `backend_main.py` into own router
- [x] Prompts stored in `prompts.py`
- [x] Registered in `backend_main.py`

## Pending
- [ ] Migrate prompt from `prompts.py` (Python string) to `prompts.json` (JSON file)
      to be consistent with other packages (`etsy_hunt`, `etsy_listing`)

## Knowledge Base
- `REQUIREMENTS_DIR = Path("history/product-requirements")` — relative path,
  server must be started from project root
- Documents are not versioned — each save overwrites previous `content`
- Gemini model used: `GEMINI_TEXT_MODEL` from `create_image_by_ai.image_generator`
