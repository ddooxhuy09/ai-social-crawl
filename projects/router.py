from typing import List
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from projects.db import (
    _load_projects,
    _load_projects_meta,
    _new_project,
    _get_project,
    _update_project,
    _delete_project,
    _load_queue,
    _save_queue,
)

from projects.original_phase import router as original_router
from projects.redesign_phase import router as redesign_router
from projects.final_phase import router as final_router

router = APIRouter(prefix="/api/projects", tags=["projects"])

# ── Queue endpoints ───────────────────────────────────────────────

class QueueItem(BaseModel):
    id: str
    title: str
    type: str = "crawl_keyword"
    keyword: Optional[str] = None
    projectId: str
    projectName: str
    phaseName: str = "redesign"
    status: str
    result: Optional[dict] = None
    errorMessage: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    sources: Optional[List[str]] = None
    limit_per_source: Optional[int] = None

class QueueResponse(BaseModel):
    running: bool
    tasks: List[QueueItem]

@router.get("/queue", response_model=QueueResponse)
async def get_queue():
    return _load_queue()

@router.post("/queue")
async def update_queue(data: QueueResponse):
    _save_queue(data.dict())
    return {"ok": True}

@router.post("/queue/status")
async def toggle_queue_status(status: dict):
    # status: {"running": bool}
    queue_data = _load_queue()
    queue_data["running"] = status.get("running", False)
    _save_queue(queue_data)
    return {"ok": True}

@router.post("/queue/add")
async def add_to_queue(item: QueueItem):
    queue_data = _load_queue()
    queue_data["tasks"].append(item.dict())
    _save_queue(queue_data)
    return {"ok": True}

@router.delete("/queue")
async def clear_queue():
    _save_queue({"running": False, "tasks": []})
    return {"ok": True}

@router.get("/history", response_model=List[QueueItem])
async def get_history_global():
    from projects.db import _load_history_global
    return _load_history_global()

@router.delete("/history")
async def clear_history_global():
    from projects.db import _save_history_global
    _save_history_global([])
    return {"ok": True}

# ── Project CRUD ──────────────────────────────────────────────────────────────

@router.get("")
def list_projects():
    return _load_projects_meta()

@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_project(body: dict):
    from projects.db import _new_project, _save_project
    project = _new_project(
        name=body.get("name", "Untitled Project"),
        description=body.get("description", ""),
        phases=body.get("phases")
    )
    _save_project(project)
    return project

@router.get("/{project_id}")
def get_project(project_id: str):
    return _get_project(project_id)

@router.put("/{project_id}")
def update_project(project_id: str, body: dict):
    project = _get_project(project_id)
    updated = {**project, **{k: v for k, v in body.items() if k != "id"}}
    return _update_project(project_id, updated)

@router.delete("/{project_id}")
def delete_project(project_id: str):
    _delete_project(project_id)
    return {"ok": True}

# ── Include Sub-Routers ───────────────────────────────────────────────────────
router.include_router(original_router)
router.include_router(redesign_router)
router.include_router(final_router)
