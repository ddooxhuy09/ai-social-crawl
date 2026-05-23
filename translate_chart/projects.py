from pathlib import Path

from history_utils import read_json, write_json
from translate_chart.paths import PROJECTS_ROOT


def project_dir(project_id: str) -> Path:
    return PROJECTS_ROOT / project_id


def read_meta(project_id: str) -> dict | None:
    p = project_dir(project_id) / "project.json"
    return read_json(p) if p.exists() else None


def write_meta(project_id: str, meta: dict) -> None:
    d = project_dir(project_id)
    d.mkdir(parents=True, exist_ok=True)
    write_json(d / "project.json", meta)
