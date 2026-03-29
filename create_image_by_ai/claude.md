# create_image_by_ai/ — AI Image Generation & Analysis

## Role
All AI image generation, attribute analysis, redesign ideation, and prompt
building routes. Also provides the shared Gemini client used by other packages.
Backend for the `ChatCreateImagePage` frontend.

## Folder Structure

```
create_image_by_ai/
├── router.py           # FastAPI routes (moved from backend_main.py)
├── image_generator.py  # Core AI functions + shared Gemini client
├── prompt_store.py     # Persistent prompt history (save/list/delete/clear)
├── config.json         # [RUNTIME] Gemini API key storage [gitignore]
├── prompts.json        # Predefined image generation prompt templates
└── claude.md           # This file
```

## Routes (router.py)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/generate-image` | Generate image(s) from text prompt via Gemini Imagen |
| GET | `/api/generate-image/prompts` | List saved prompt history |
| DELETE | `/api/generate-image/prompts/{id}` | Delete one saved prompt |
| DELETE | `/api/generate-image/prompts` | Clear all saved prompts |
| GET | `/api/generate-image/config` | Get config (API key masked) |
| POST | `/api/generate-image/config` | Save Gemini API key |
| POST | `/api/generate-image/attributes` | Analyze uploaded images → attribute table (vision LLM) |
| POST | `/api/generate-image/idea` | Generate redesign idea from attribute table |
| POST | `/api/generate-image/suggest-attribute` | Suggest 3 creative values for one attribute |
| POST | `/api/generate-image/suggest-concepts` | Generate 3 overall design concepts |
| POST | `/api/generate-image/build-prompt` | Build image generation prompts from attribute table |
| POST | `/api/search_by_image` | CLIP similarity search against a crawl history |
| POST | `/api/search_by_prompt` | OpenCLIP text→image search against a crawl history |

## Pydantic Models (moved from backend_main.py)

```python
class GenerateImageRequest(BaseModel):
    prompt: str
    model: str = "imagen-3.0-generate-002"
    num_images: int = 1

class GenerateImageConfig(BaseModel):
    gemini_api_key: str = ""

# These extend PinInfo (imported from crawlers.router):
class PinInfoWithScore(PinInfo):
    similarity_score: float

class SearchByImageResponse(BaseModel):
    keyword: str; total: int; pins: List[PinInfoWithScore]

class PinInfoWithPromptScore(PinInfo):
    confidence_score: float; explanation: str

class SearchByPromptResponse(BaseModel):
    keyword: str; prompt: str; prompt_translated: str | None
    total: int; pins: List[PinInfoWithPromptScore]
```

## `image_generator.py` — Shared Gemini Client

**Critical**: This module exports `_get_gemini_client()` and `GEMINI_TEXT_MODEL`
which are imported by `etsy_listing`, `etsy_hunt`, `product_requirements`,
and `projects` routers. Do NOT rename or move without updating all importers.

```python
# Used across the entire backend:
from create_image_by_ai.image_generator import _get_gemini_client, GEMINI_TEXT_MODEL
```

Key functions:
- `_get_gemini_client()` — singleton Gemini client, reads API key from `config.json`
- `generate_images(prompt, model, num_images)` — calls Imagen API, returns base64 list
- `get_image_attributes(images, image_names)` — vision LLM attribute extraction
- `generate_idea(attribute_table)` — text LLM redesign ideation
- `suggest_attribute(name, current_values, full_table)` — creative attribute suggestion
- `suggest_concepts(attribute_table)` — 3 design concept generation
- `build_image_prompt(attribute_table)` — generate image prompts from attributes
- `get_config()` / `save_config()` — read/write `config.json`

## `prompt_store.py`
- Saves used prompts to a JSON file with timestamp
- `save_prompt(text, model)`, `list_prompts()`, `delete_prompt(id)`, `clear_prompts()`

## `search_by_image` & `search_by_prompt` — Lazy Imports
Both routes import `clip_service` and `open_clip_service` lazily inside `_run()`:
```python
def _run():
    from clip_service import search_by_image, ClipNotAvailableError
    ...
```
**Reason**: PyTorch DLL errors on Windows will crash the server at startup if imported
at module level. Lazy import means the server starts fine; bad DLL only fails the
specific route that actually calls CLIP.

## Tasks Done
- [x] Created `router.py` with all routes listed above
- [x] Moved all models from `backend_main.py`
- [x] Registered `image_router` in `backend_main.py`

## Knowledge Base
- Gemini Imagen model: `imagen-3.0-generate-002` (default, user can change)
- Gemini text model: stored in `GEMINI_TEXT_MODEL` constant in `image_generator.py`
- Images returned as base64 data URLs: `data:image/png;base64,...`
- `config.json` stores `{"gemini_api_key": "..."}` — must be in `.gitignore`
- API key masked in GET response: first 6 chars + `...` + last 4 chars
