import uuid
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException

from projects.db import _get_project, _update_project, _load_keyword_tasks, _save_keyword_tasks, PROJECTS_DIR
from history_utils import read_json, write_json

router = APIRouter()

# ── Redesign Chat History ──────────────────────────────────────────────────────

def _chat_path(project_id: str) -> Path:
    return PROJECTS_DIR / project_id / "redesign_chat.json"

def _load_chat(project_id: str) -> list:
    try:
        return read_json(_chat_path(project_id)) or []
    except Exception:
        return []

def _save_chat(project_id: str, messages: list):
    write_json(_chat_path(project_id), messages)


@router.get("/{project_id}/redesign/chat")
def get_redesign_chat(project_id: str):
    """Load redesign phase chat history."""
    return {"messages": _load_chat(project_id)}


@router.post("/{project_id}/redesign/chat")
def save_redesign_chat(project_id: str, body: dict):
    """Save (overwrite) the full redesign chat messages array."""
    messages = body.get("messages", [])
    _save_chat(project_id, messages)
    return {"ok": True, "count": len(messages)}


@router.delete("/{project_id}/redesign/chat")
def clear_redesign_chat(project_id: str):
    """Clear redesign phase chat history."""
    _save_chat(project_id, [])
    return {"ok": True}

@router.post("/{project_id}/redesign/add-tasks")
def add_redesign_tasks(project_id: str, body: dict):
    """Move selected social items into redesign tasks."""
    items = body.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="No items provided")
    project = _get_project(project_id)
    new_tasks = [
        {
            "id": str(uuid.uuid4()),
            "source_item": item,
            "attributes": {},
            "generated_image": None,
            "status": "todo",           # todo | running | done | error
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        for item in items
    ]
    project["redesign"]["tasks"].extend(new_tasks)
    project["redesign"]["status"] = "processing"
    _update_project(project_id, project)
    return {"added": len(new_tasks), "tasks": project["redesign"]["tasks"]}

@router.put("/{project_id}/redesign/tasks/{task_id}")
def update_redesign_task(project_id: str, task_id: str, body: dict):
    """Update a single redesign task (attributes, generated_image, status)."""
    project = _get_project(project_id)
    tasks = project["redesign"]["tasks"]
    for i, t in enumerate(tasks):
        if t["id"] == task_id:
            tasks[i] = {**t, **{k: v for k, v in body.items() if k != "id"}}
            project["redesign"]["tasks"] = tasks
            _update_project(project_id, project)
            return tasks[i]
    raise HTTPException(status_code=404, detail="Task not found")

@router.put("/{project_id}/redesign/social-results")
def save_redesign_social_results(project_id: str, body: dict):
    """Save crawled YT/TikTok results for redesign phase."""
    results = body.get("results", [])
    project = _get_project(project_id)
    project["redesign"]["social_results"] = results
    if project["redesign"]["status"] == "empty":
        project["redesign"]["status"] = "selecting"
    _update_project(project_id, project)
    return {"ok": True}

# ── Keyword Task Queue endpoints ──────────────────────────────────────────────

@router.get("/{project_id}/keyword-tasks")
def get_keyword_tasks(project_id: str):
    """Return the keyword task list for this project."""
    return _load_keyword_tasks(project_id)

@router.post("/{project_id}/keyword-tasks", status_code=201)
def add_keyword_tasks(project_id: str, body: dict):
    """Add keywords as pending tasks (deduplicates by keyword)."""
    keywords = body.get("keywords", [])
    source_file = body.get("source_file", "")
    if not keywords:
        raise HTTPException(status_code=400, detail="keywords required")
    
    existing = _load_keyword_tasks(project_id)
    existing_kws = {t["keyword"] for t in existing}
    new_tasks = [
        {
            "id": str(uuid.uuid4()),
            "keyword": kw,
            "source_file": source_file,
            "status": "pending",
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        for kw in keywords if kw and kw not in existing_kws
    ]
    
    tasks = existing + new_tasks
    _save_keyword_tasks(project_id, tasks)
    return {"added": len(new_tasks), "tasks": tasks}

@router.patch("/{project_id}/keyword-tasks/{task_id}")
def update_keyword_task(project_id: str, task_id: str, body: dict):
    """Update a keyword task's status (running / success / failed)."""
    tasks = _load_keyword_tasks(project_id)
    for i, t in enumerate(tasks):
        if t["id"] == task_id:
            tasks[i] = {**t, **{k: v for k, v in body.items() if k != "id"}}
            _save_keyword_tasks(project_id, tasks)
            return tasks[i]
    raise HTTPException(status_code=404, detail="Keyword task not found")

@router.delete("/{project_id}/keyword-tasks/{task_id}")
def delete_keyword_task(project_id: str, task_id: str):
    """Remove a keyword task from the queue."""
    tasks = _load_keyword_tasks(project_id)
    filtered = [t for t in tasks if t["id"] != task_id]
    if len(filtered) == len(tasks):
        raise HTTPException(status_code=404, detail="Keyword task not found")
    _save_keyword_tasks(project_id, filtered)
    return {"ok": True}
