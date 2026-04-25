from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from history_utils import read_json, write_json, list_json_dir
from services.ai_utils import slugify, now_iso

from create_image_by_ai.image_generator import GEMINI_TEXT_MODEL, _get_gemini_client
from product_requirements.prompts import PRODUCT_REQUIREMENTS_PROMPT

router = APIRouter(prefix="/api/requirements", tags=["Requirements"])

REQUIREMENTS_DIR = Path("history/product-requirements")


# ── helpers ──────────────────────────────────────────────────────────────────

def _doc_path(doc_name: str) -> Path:
    return REQUIREMENTS_DIR / f"{slugify(doc_name, fallback='doc')}.json"


def _read_doc(doc_name: str) -> dict:
    path = _doc_path(doc_name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        return read_json(path)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"Error reading document: {e}") from e


def _write_doc(doc: dict) -> dict:
    doc["updated_at"] = now_iso()
    write_json(_doc_path(doc["doc_name"]), doc)
    return doc


# ── request models ────────────────────────────────────────────────────────────

class CreateDocRequest(BaseModel):
    doc_name: str


class SaveDocRequest(BaseModel):
    doc_name: str
    product_name: str = ""
    purpose: str = ""
    general_requirements: str = ""
    attribute_table: str = ""
    attribute_source: str = "manual"   # "manual" | "chat"
    chat_session_id: str = ""
    result: str = ""


class GenerateRequest(BaseModel):
    doc_name: str
    product_name: str = ""
    purpose: str = ""
    general_requirements: str = ""
    attribute_table: str = ""


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/all")
async def list_requirements():
    return list_json_dir(
        REQUIREMENTS_DIR,
        lambda data, path: {
            "doc_name":     data.get("doc_name", path.stem),
            "product_name": data.get("product_name", ""),
            "updated_at":   data.get("updated_at", ""),
            "has_result":   bool(data.get("result", "").strip()),
        },
    )


@router.post("/create")
async def create_requirement_doc(req: CreateDocRequest):
    doc_name = (req.doc_name or "").strip()
    if not doc_name:
        raise HTTPException(status_code=400, detail="Doc name is required.")
    if _doc_path(doc_name).exists():
        raise HTTPException(status_code=409, detail="A document with this name already exists.")
    ts = now_iso()
    doc = {
        "doc_name":             doc_name,
        "product_name":         "",
        "purpose":              "",
        "general_requirements": "",
        "attribute_table":      "",
        "attribute_source":     "manual",
        "chat_session_id":      "",
        "result":               "",
        "created_at":           ts,
        "updated_at":           ts,
    }
    return _write_doc(doc)


@router.get("/{doc_name}")
async def load_requirement_doc(doc_name: str):
    return _read_doc(doc_name)


@router.put("/{doc_name}")
async def save_requirement_doc(doc_name: str, req: SaveDocRequest):
    path = _doc_path(doc_name)
    existing = read_json(path, default={"created_at": now_iso()})
    doc = {
        **existing,
        "doc_name":             req.doc_name or doc_name,
        "product_name":         req.product_name,
        "purpose":              req.purpose,
        "general_requirements": req.general_requirements,
        "attribute_table":      req.attribute_table,
        "attribute_source":     req.attribute_source,
        "chat_session_id":      req.chat_session_id,
        "result":               req.result,
    }
    return _write_doc(doc)


@router.delete("/{doc_name}")
async def delete_requirement_doc(doc_name: str):
    path = _doc_path(doc_name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Document not found.")
    path.unlink()
    return {"ok": True}


@router.post("/generate")
async def generate_product_requirements(req: GenerateRequest):
    if not req.attribute_table.strip():
        raise HTTPException(status_code=400, detail="Attribute table is required.")

    prompt = PRODUCT_REQUIREMENTS_PROMPT.format(
        product_name=req.product_name or "Không rõ",
        purpose=req.purpose or "Không rõ",
        general_requirements=req.general_requirements or "Không có yêu cầu bổ sung.",
        attribute_table=req.attribute_table,
    )

    try:
        client = _get_gemini_client()
        response = client.models.generate_content(model=GEMINI_TEXT_MODEL, contents=prompt)
        result_text = response.text or ""
    except Exception as e:
        import traceback
        print(f"[generate-requirements] LỖI: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e)) from e

    # Auto-save result back to the document
    if req.doc_name:
        path = _doc_path(req.doc_name)
        existing = read_json(path, default={"created_at": now_iso()})
        doc = {
            **existing,
            "doc_name":             req.doc_name,
            "product_name":         req.product_name,
            "purpose":              req.purpose,
            "general_requirements": req.general_requirements,
            "attribute_table":      req.attribute_table,
            "result":               result_text,
        }
        _write_doc(doc)

    return {"result": result_text}
