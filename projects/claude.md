# projects/ — Project Management System

## Role
Manages the 3-phase design project workflow: Original (crawl) → Redesign → Final.
Includes a task queue for background processing and the HEnull Etsy search proxy.
Backend for the `ProjectsPage` frontend.

## Folder Structure

```
projects/
├── router.py        # FastAPI APIRouter — /api/projects/* routes
├── projects.json    # [RUNTIME] Stored project data (array of project objects)
├── queue.json       # [RUNTIME] Task queue data (array of queue items)
└── claude.md        # This file
```

## Routes (router.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create a new project |
| GET | `/api/projects/{id}` | Get project detail |
| PUT | `/api/projects/{id}` | Update/save a full project object |
| DELETE | `/api/projects/{id}` | Delete a project |
| GET | `/api/projects/queue` | Get current task queue |
| POST | `/api/projects/queue` | Add item to queue |
| DELETE | `/api/projects/queue/{item_id}` | Remove item from queue |
| POST | `/api/projects/{id}/original/search-etsy` | Proxy HEnull Etsy keyword search |

## Project Data Model

```json
{
  "id": "uuid4-string",
  "name": "Project Name",
  "created_at": "ISO timestamp",
  "original": {
    "history_id": "20260321_...",
    "status": "done | in_progress | empty"
  },
  "redesign": {
    "status": "done | in_progress | empty",
    "tasks": [
      {
        "id": "task-uuid4",
        "pin_url": "...",
        "image_url": "...",
        "status": "pending | in_progress | done",
        "last_history_id": "..."
      }
    ]
  },
  "final": {
    "status": "done | in_progress | empty",
    "word_filename": "output_final.docx"
  }
}
```

## Phase Lifecycle
1. **Original**: User selects a `history_id` from crawl results → saved to `project.original`
2. **Redesign**: Each pin becomes a task; tasks run through the AI image generation queue
3. **Final**: Summary of completed redesign tasks; user generates Word document output

## Task Queue (`queue.json`)
- Frontend `App.jsx:runQueue()` processes tasks sequentially
- On task completion, `last_history_id` is written back to the matching task
  in `project.redesign.tasks` by matching `task.id`

## HEnull Etsy Search (`POST /api/projects/{id}/original/search-etsy`)
- Reads `etsy_hunt/henull_auth.json` for JWT token
- Checks token expiry before calling API (decodes JWT base64 payload)
- Proxies to HEnull keyword search endpoint
- Handles gzip/deflate response decompression

### JWT Expiry Check
```python
payload_data = json.loads(_b64.urlsafe_b64decode(padded).decode("utf-8"))
exp = payload_data.get("expire") or payload_data.get("exp")
if exp and int(exp) < int(_time.time()):
    raise HTTPException(status_code=403, detail="Token HEnull đã hết hạn...")
```

### Response Decompression
```python
encoding = resp.headers.get("Content-Encoding", "")
if encoding == "gzip":    raw = gzip.decompress(raw)
elif encoding == "deflate": raw = zlib.decompress(raw)
```

## Tasks Done
- [x] All project CRUD routes in `router.py`
- [x] JWT expiry check before HEnull API call
- [x] Gzip/deflate decompression for HEnull response
- [x] 3-phase model: `original / redesign / final` (replaced old `phases[]` array)

## Knowledge Base
- `projects.json` and `queue.json` paths are relative — server must start from project root
- Project `id` is a UUID4 string generated at creation time
- `redesign.tasks[].id` is also UUID4 — used by `App.jsx:runQueue()` to match tasks
- HEnull auth file lives in `etsy_hunt/henull_auth.json` (not in projects/)
- `projects.json` and `queue.json` are runtime data — add to `.gitignore`
