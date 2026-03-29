import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["chat_ai"])

# ── Storage ────────────────────────────────────────────────────────────────────

CHAT_AI_DIR = Path("history/chat-ai")
CHAT_AI_DIR.mkdir(parents=True, exist_ok=True)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/api/chat-ai/history")
def list_chat_sessions():
    """List all saved chat sessions (id, title, created_at, message_count)."""
    sessions = []
    for f in sorted(CHAT_AI_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            sessions.append({
                "id": f.stem,
                "title": data.get("title", f.stem),
                "created_at": data.get("created_at", ""),
                "message_count": len(data.get("messages", [])),
            })
        except Exception:
            continue
    return sessions


@router.get("/api/chat-ai/history/{session_id}")
def get_chat_session(session_id: str):
    """Load the full content of a chat session."""
    path = CHAT_AI_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    return json.loads(path.read_text(encoding="utf-8"))


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
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"id": session_id, "ok": True}


@router.delete("/api/chat-ai/history/{session_id}")
def delete_chat_session(session_id: str):
    """Delete a chat session permanently."""
    path = CHAT_AI_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    path.unlink()
    return {"ok": True}
