import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from fastapi import HTTPException

PROJECTS_DIR = Path("history/projects")
QUEUE_FILE = PROJECTS_DIR / "queue.json"
HISTORY_FILE = PROJECTS_DIR / "history.json"

_EXCLUDED_FILES = {"queue.json", "history.json", "projects.json", "projects.json.bak"}

def _load_projects():
    projects = []
    if PROJECTS_DIR.exists():
        for filename in os.listdir(PROJECTS_DIR):
            if filename.endswith(".json") and filename not in _EXCLUDED_FILES:
                filepath = PROJECTS_DIR / filename
                try:
                    p = json.loads(filepath.read_text(encoding="utf-8"))
                    if "id" in p:
                        projects.append(p)
                except Exception:
                    pass
    projects.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return projects

def _load_projects_meta():
    """Lightweight version: returns only id/name/description/created_at/phases + phase statuses."""
    projects = []
    if PROJECTS_DIR.exists():
        for filename in os.listdir(PROJECTS_DIR):
            if filename.endswith(".json") and filename not in _EXCLUDED_FILES:
                filepath = PROJECTS_DIR / filename
                try:
                    p = json.loads(filepath.read_text(encoding="utf-8"))
                    if "id" in p:
                        projects.append({
                            "id": p["id"],
                            "name": p.get("name", ""),
                            "description": p.get("description", ""),
                            "created_at": p.get("created_at", ""),
                            "phases": p.get("phases", ["original", "redesign", "final"]),
                            "original": {"status": p.get("original", {}).get("status", "empty")},
                            "redesign": {"status": p.get("redesign", {}).get("status", "empty")},
                            "final":    {"status": p.get("final",    {}).get("status", "empty")},
                        })
                except Exception:
                    pass
    projects.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return projects

def _get_project_path(project_id: str) -> Path:
    return PROJECTS_DIR / f"{project_id}.json"

def _save_project(project: dict):
    path = _get_project_path(project["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")

def _get_project(project_id: str):
    path = _get_project_path(project_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return json.loads(path.read_text(encoding="utf-8"))

def _update_project(project_id: str, updated: dict):
    _get_project(project_id)  # assure it exists
    _save_project(updated)
    return updated

def _delete_project(project_id: str):
    path = _get_project_path(project_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    path.unlink()

def _get_project_queue_path(project_id: str) -> Path:
    # Legacy path, we now use global queue.json
    return PROJECTS_DIR / project_id / "queue.json"

def _load_queue():
    default = {"running": False, "tasks": []}
    if not QUEUE_FILE.exists():
        return default
    try:
        data = json.loads(QUEUE_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            # Migrate old list format to new object format
            return {"running": False, "tasks": data}
        return data
    except Exception:
        return default

def _save_queue(data: dict):
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    QUEUE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def _load_history_global():
    if not HISTORY_FILE.exists():
        return []
    try:
        return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []

def _save_history_global(data: list):
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Giới hạn lịch sử khoảng 1000 task gần nhất cho nhẹ
    HISTORY_FILE.write_text(json.dumps(data[:1000], ensure_ascii=False, indent=2), encoding="utf-8")

def archive_task(task: dict):
    """Di chuyển task từ queue sang history và cập nhật vào project tương ứng."""
    # 1. Thêm vào history tổng
    history = _load_history_global()
    history.insert(0, task) # Mới nhất lên đầu
    _save_history_global(history)
    
    # 2. Xóa khỏi queue
    queue_data = _load_queue()
    queue_data["tasks"] = [t for t in queue_data["tasks"] if t.get("id") != task.get("id")]
    _save_queue(queue_data)
    
    # 3. Cập nhật vào Project file
    pid = task.get("projectId")
    if pid and pid != "global":
        try:
            project = _get_project(pid)
            phase = task.get("phaseName", "redesign")
            if phase in project:
                # Lưu vào danh sách task của phase đó
                if "tasks" not in project[phase]: project[phase]["tasks"] = []
                project[phase]["tasks"].insert(0, task)
                
                # Nếu là crawl kết quả, lưu vào social_results
                if task.get("result") and "social_results" in project[phase]:
                    res = task["result"]
                    # Giả sử result có dạng { "pins": [...] } hoặc { "results": [...] }
                    new_items = res.get("pins") or res.get("results") or []
                    if new_items:
                        project[phase]["social_results"] = new_items + project[phase]["social_results"]
                
                _update_project(pid, project)
        except Exception as e:
            print(f"Error archiving task to project {pid}: {e}")

def _get_keyword_tasks_path(project_id: str) -> Path:
    return Path(f"history/projects/{project_id}/keyword_tasks.json")

def _load_keyword_tasks(project_id: str) -> list:
    p = _get_keyword_tasks_path(project_id)
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("[]", encoding="utf-8")
    return json.loads(p.read_text(encoding="utf-8"))

def _save_keyword_tasks(project_id: str, tasks: list):
    p = _get_keyword_tasks_path(project_id)
    p.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")

def _empty_phase(status="empty"):
    return {"status": status}

def _new_project(name: str, description: str = "", phases: list = None) -> dict:
    if phases is None:
        phases = ["original", "redesign", "final"]
        
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "description": description,
        "phases": phases,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "original": {
            "status": "empty",
            "keyword": "",
            "etsy_products": [],
            "selected_etsy_ids": [],
            "social_results": [],
            "original_item": None,
            "hunt_keywords": [],
        },
        "redesign": {
            "status": "empty",
            "social_results": [],
            "tasks": [],
            "keyword_tasks": [],
        },
        "final": {
            "status": "empty",
            "word_file": None,
        },
    }
