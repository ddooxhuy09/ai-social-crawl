from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from history_utils import read_json, write_json, list_json_dir

router = APIRouter(tags=["chat_ai"])

# ── Storage ────────────────────────────────────────────────────────────────────

CHAT_AI_DIR = Path("history/chat-ai")
CHAT_AI_DIR.mkdir(parents=True, exist_ok=True)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/api/chat-ai/history")
def list_chat_sessions():
    """List all saved chat sessions (id, title, created_at, message_count)."""
    return list_json_dir(
        CHAT_AI_DIR,
        lambda data, path: {
            "id":            data.get("id", path.stem),
            "title":         data.get("title", path.stem),
            "created_at":    data.get("created_at", ""),
            "message_count": len(data.get("messages", [])) if isinstance(data, dict) else 0,
        },
    )


@router.get("/api/chat-ai/history/{session_id}")
def get_chat_session(session_id: str):
    """Load the full content of a chat session."""
    path = CHAT_AI_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    return read_json(path)


@router.post("/api/chat-ai/history")
def save_chat_session(body: dict):
    """Create or update a chat session. Auto-generates ID if not provided."""
    session_id = body.get("id") or datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:20]
    path = CHAT_AI_DIR / f"{session_id}.json"
    payload = {
        "id": session_id,
        "title": body.get("title", "Chat " + session_id[:15]),
        "created_at": body.get("created_at", datetime.now().isoformat(timespec="seconds")),
        "messages": body.get("messages", []),
    }
    write_json(path, payload)
    return {"id": session_id, "ok": True}


@router.delete("/api/chat-ai/history/{session_id}")
def delete_chat_session(session_id: str):
    """Delete a chat session permanently."""
    path = CHAT_AI_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    path.unlink()
    return {"ok": True}
