# services/ — Shared Backend Services

## Role
Holds stateless utility modules that are **shared across multiple routers**.
No FastAPI routes live here. No business logic specific to one page.

## Target Folder Structure

```
services/
├── history_utils.py      # History I/O: save/load/delete crawl data
├── clip_service.py       # CLIP image embedding + similarity search
├── open_clip_service.py  # OpenCLIP text-to-image search
├── translate_service.py  # Vietnamese → English translation (for CLIP)
└── claude.md             # This file
```

## Files & Responsibilities

### `history_utils.py` (moved from project root)
- **Exports**: `save_history()`, `load_history_data()`, `delete_history()`,
  `normalize_to_display()`, `HISTORY_DIR`, `CRAWL_DIR`, `IMAGE_DIR`,
  `_safe_keyword_for_path()`
- Manages the `history/crawl/` and `history/pinterest_image/` directory structure
- Normalizes native pin schemas from Pinterest/TikTok/Instagram/Reddit/YouTube
  into one common display format (`pin_url`, `image_url`, `like_count`, etc.)
- Supports two on-disk formats:
  - **New**: `info.json` (meta) + separate `{source}.json` files
  - **Legacy**: `info.json` with inline `pins` array (still loaded for backward compat)
- History ID format: `{YYYYMMDD_HHMMSS}_{safe_keyword}`

### `clip_service.py` (moved from project root)
- **Exports**: `search_by_image()`, `ClipNotAvailableError`
- Uses `sentence-transformers` CLIP model (`clip-ViT-B-32`)
- Lazy-loads model to avoid blocking startup
- Caches embeddings in `history/{id}/embeddings.json`
- Import is always lazy (inside `_run()`) to avoid DLL errors on Windows
  when PyTorch is not installed

### `open_clip_service.py` (moved from project root)
- **Exports**: `search_by_prompt_open_clip()`, `OpenClipNotAvailableError`
- Uses `open-clip-torch` for text→image matching
- Also lazy-loaded to avoid import-time DLL errors

### `translate_service.py` (moved from project root)
- **Exports**: `translate_prompt_for_clip(prompt) → (search_prompt, translated)`
- Uses Helsinki-NLP/opus-mt-vi-en transformer model
- Detects Vietnamese input; if not Vietnamese, returns prompt unchanged
- Used by `create_image_by_ai/router.py` before calling OpenCLIP

## Import Rule After Migration
All other routers must import from `services.*` not from the root:
```python
# BEFORE
from history_utils import save_history, HISTORY_DIR
from clip_service import search_by_image

# AFTER
from services.history_utils import save_history, HISTORY_DIR
from services.clip_service import search_by_image
```

## Tasks Done
- [ ] Move `history_utils.py` from root → `services/history_utils.py`
- [ ] Move `clip_service.py` from root → `services/clip_service.py`
- [ ] Move `open_clip_service.py` from root → `services/open_clip_service.py`
- [ ] Move `translate_service.py` from root → `services/translate_service.py`
- [ ] Update all imports across all routers

## Knowledge Base
- These files are imported lazily in some routes (inside `_run()`) to prevent
  PyTorch DLL errors from crashing the whole server on startup
- `history_utils.py` imports `sys` to detect PyInstaller frozen mode and redirect
  `HISTORY_DIR` to the exe's parent directory
