"""
Translate Chart — FastAPI router (routes only).
Business logic lives in: ocr.py, translate.py, projects.py
Storage:
  - Terminology : translate_chart/terminology.json
  - Projects    : history/translate-chart/{project_id}/
"""
import shutil
import uuid

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from history_utils import read_json, write_json
from services.ai_utils import now_iso, slugify
from translate_chart.paths import TERMINOLOGY_PATH, PROJECTS_ROOT
from translate_chart.projects import project_dir, read_meta, write_meta
from translate_chart.ocr import run_ocr
from translate_chart.translate import SUPPORTED_LANGS, load_terminology, translate_one

router = APIRouter(prefix="/api/translate-chart")


# ── Terminology ───────────────────────────────────────────────────────────────

@router.get("/terminology")
async def get_terminology():
    if not TERMINOLOGY_PATH.exists():
        raise HTTPException(status_code=404, detail="terminology.json not found")
    return read_json(TERMINOLOGY_PATH)


@router.put("/terminology")
async def update_terminology(data: dict):
    write_json(TERMINOLOGY_PATH, data)
    return {"ok": True}


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects():
    results = []
    if PROJECTS_ROOT.exists():
        for d in PROJECTS_ROOT.iterdir():
            p = d / "project.json"
            if p.exists():
                try:
                    results.append(read_json(p))
                except Exception:
                    pass
    return sorted(results, key=lambda x: x.get("updated_at", ""), reverse=True)


class CreateProjectRequest(BaseModel):
    name: str


@router.post("/projects")
async def create_project(req: CreateProjectRequest):
    project_id = f"{uuid.uuid4().hex[:8]}_{slugify(req.name, fallback='project')}"
    now = now_iso()
    meta = {
        "id": project_id,
        "name": req.name,
        "created_at": now,
        "updated_at": now,
        "ocr_status": "idle",
        "ocr_error": None,
        "available_langs": [],
    }
    write_meta(project_id, meta)
    return meta


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    meta = read_meta(project_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Project not found")
    input_path = project_dir(project_id) / "input.md"
    meta["input_md"] = input_path.read_text(encoding="utf-8") if input_path.exists() else ""
    return meta


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    d = project_dir(project_id)
    if d.exists():
        shutil.rmtree(d)
    return {"ok": True}


class UpdateInputRequest(BaseModel):
    input_md: str


@router.put("/projects/{project_id}/input")
async def update_input(project_id: str, req: UpdateInputRequest):
    meta = read_meta(project_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Project not found")
    (project_dir(project_id) / "input.md").write_text(req.input_md, encoding="utf-8")
    meta["updated_at"] = now_iso()
    if meta.get("ocr_status") == "idle":
        meta["ocr_status"] = "ready"
    write_meta(project_id, meta)
    return {"ok": True}


# ── OCR ───────────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/ocr")
async def start_ocr(project_id: str, background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    meta = read_meta(project_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Project not found")
    if meta.get("ocr_status") == "processing":
        raise HTTPException(status_code=409, detail="OCR already in progress")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    pdf_bytes = await file.read()
    meta.update({"ocr_status": "processing", "ocr_error": None, "updated_at": now_iso()})
    write_meta(project_id, meta)
    background_tasks.add_task(run_ocr, project_id, pdf_bytes)
    return {"ok": True, "ocr_status": "processing"}


# ── Translation ───────────────────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    langs: list[str]
    bilingual: bool = False


@router.post("/projects/{project_id}/translate")
async def translate_project(project_id: str, req: TranslateRequest):
    meta = read_meta(project_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Project not found")

    input_path = project_dir(project_id) / "input.md"
    if not input_path.exists():
        raise HTTPException(status_code=400, detail="No input text. Run OCR or save text first.")

    invalid = [l for l in req.langs if l not in SUPPORTED_LANGS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unsupported languages: {invalid}")

    source = input_path.read_text(encoding="utf-8")
    terminology = load_terminology()
    errors: dict[str, str] = {}
    translated: list[str] = []

    for lang in req.langs:
        try:
            result = translate_one(source, lang, terminology, bilingual=req.bilingual)
            (project_dir(project_id) / f"result_{lang}.md").write_text(result, encoding="utf-8")
            translated.append(lang)
        except Exception as e:
            errors[lang] = str(e)

    existing = [l for l in meta.get("available_langs", []) if l not in translated]
    meta["available_langs"] = existing + translated
    meta["updated_at"] = now_iso()
    write_meta(project_id, meta)

    if errors:
        raise HTTPException(status_code=500, detail={"translated": translated, "errors": errors})
    return {"ok": True, "translated": translated}


@router.get("/projects/{project_id}/result/{lang}", response_class=PlainTextResponse)
async def get_result(project_id: str, lang: str):
    path = project_dir(project_id) / f"result_{lang}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No result for language: {lang}")
    return path.read_text(encoding="utf-8")
