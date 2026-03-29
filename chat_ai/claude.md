# chat_ai/ — Chat AI Session History

## Role
Persists and retrieves chat sessions for the AI chat interface embedded in
`ChatCreateImagePage`. Sessions are stored as JSON files on disk.
No AI inference happens here — this is pure CRUD for session persistence.

## Folder Structure

```
chat_ai/
├── router.py      # FastAPI APIRouter — /api/chat-ai/* routes
└── claude.md      # This file
```

## Routes (router.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat-ai/history` | List all sessions (id, title, created_at, message_count) |
| GET | `/api/chat-ai/history/{session_id}` | Load full session (messages array) |
| POST | `/api/chat-ai/history` | Create or update a session |
| DELETE | `/api/chat-ai/history/{session_id}` | Delete a session |

## Data Schema

Session files stored in `history/chat-ai/{session_id}.json`:

```json
{
  "id": "20260321_143022_45",
  "title": "Chat 20260321_143022",
  "created_at": "2026-03-21T14:30:22",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

## Session ID Generation
- If `id` provided in POST body → use it (update existing session)
- If not provided → auto-generated: `datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:20]`

## Storage
- Directory: `history/chat-ai/` (auto-created on first write via `mkdir(parents=True)`)
- One `.json` file per session
- Listed newest-first (filenames start with timestamp → sorted desc = newest first)

## Tasks Done
- [x] Created `chat_ai/` directory
- [x] Created `chat_ai/router.py` with all 4 routes
- [x] Moved `CHAT_AI_DIR` path constant into `router.py`
- [x] Registered `chat_router` in `backend_main.py`
- [x] Removed all 4 routes and `CHAT_AI_DIR` from `backend_main.py`

## Knowledge Base
- Frontend sends full `messages` array on every save (no delta updates)
- `title` defaults to `"Chat " + session_id[:15]` if not provided in POST body
- `created_at` defaults to current ISO timestamp if not in POST body
- No authentication — sessions are local only
