import asyncio
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from crawlers.router import PinInfo

router = APIRouter(tags=["image_generation"])


# ── Pydantic Models ────────────────────────────────────────────────────────────

class GenerateImageRequest(BaseModel):
    prompt: str
    model: str = "imagen-3.0-generate-002"
    num_images: int = 1


class GenerateImageConfig(BaseModel):
    gemini_api_key: str = ""


class PinInfoWithScore(PinInfo):
    similarity_score: float


class SearchByImageResponse(BaseModel):
    keyword: str
    total: int
    pins: List[PinInfoWithScore]


class PinInfoWithPromptScore(PinInfo):
    confidence_score: float
    explanation: str


class SearchByPromptResponse(BaseModel):
    keyword: str
    prompt: str
    prompt_translated: str | None = None
    total: int
    pins: List[PinInfoWithPromptScore]


# ── Routes: Image Generation ───────────────────────────────────────────────────

@router.post("/api/generate-image")
async def generate_image_endpoint(body: GenerateImageRequest):
    """Generate image(s) from a text prompt using Gemini Imagen."""
    from create_image_by_ai.image_generator import generate_images
    from create_image_by_ai.prompt_store import save_prompt
    try:
        images = await generate_images(
            prompt=body.prompt.strip(),
            model=body.model,
            num_images=max(1, min(body.num_images, 4)),
        )
        save_prompt(body.prompt.strip(), model=body.model)
        return {"images": images, "prompt": body.prompt, "model": body.model}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/generate-image/prompts")
def list_saved_prompts():
    """List saved prompt history."""
    from create_image_by_ai.prompt_store import list_prompts
    return list_prompts()


@router.delete("/api/generate-image/prompts/{prompt_id}")
def delete_saved_prompt(prompt_id: int):
    """Delete a saved prompt by ID."""
    from create_image_by_ai.prompt_store import delete_prompt
    if not delete_prompt(prompt_id):
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"ok": True}


@router.delete("/api/generate-image/prompts")
def clear_saved_prompts():
    """Clear all saved prompts."""
    from create_image_by_ai.prompt_store import clear_prompts
    clear_prompts()
    return {"ok": True}


@router.get("/api/generate-image/config")
def get_generate_image_config():
    """Get current Gemini API key status (masked)."""
    import os
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    gemini_masked = (
        (gemini_key[:6] + "..." + gemini_key[-4:])
        if len(gemini_key) > 10
        else ("*" * len(gemini_key) if gemini_key else "")
    )
    return {"gemini_api_key_masked": gemini_masked}


@router.post("/api/generate-image/config")
def save_generate_image_config(body: GenerateImageConfig):
    """API key is now managed via .env file — this endpoint is a no-op."""
    return {"ok": True, "message": "API key được cấu hình qua file .env (GEMINI_API_KEY)"}


# ── Routes: AI Analysis ────────────────────────────────────────────────────────

@router.post("/api/generate-image/attributes")
async def get_image_attributes_endpoint(body: dict):
    """Analyze uploaded images and return an attribute table using vision LLM."""
    images = body.get("images")
    image_names = body.get("image_names", [])
    description = body.get("description", "")
    if not images or not isinstance(images, list):
        raise HTTPException(status_code=400, detail="Missing images list")
    if not image_names or len(image_names) != len(images):
        raise HTTPException(
            status_code=400,
            detail="Missing or invalid image_names (must match images count)",
        )
    print(f"[attributes] nhận {len(images)} ảnh, kích thước: {[len(i) for i in images]}")
    from create_image_by_ai.image_generator import get_image_attributes
    try:
        result = await get_image_attributes(images, image_names, description=description)
        print(f"[attributes] kết quả: {result[:100]}")
        return {"caption": result}
    except Exception as e:
        import traceback
        print(f"[attributes] LỖI: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/generate-image/idea")
async def generate_idea_endpoint(body: dict):
    """Generate a redesign idea from an attribute table using text LLM."""
    attribute_table = body.get("attribute_table", "")
    description = body.get("description", "")
    if not attribute_table:
        raise HTTPException(status_code=400, detail="Missing attribute_table")
    from create_image_by_ai.image_generator import generate_idea
    try:
        result = await generate_idea(attribute_table, description=description)
        return {"idea": result}
    except Exception as e:
        import traceback
        print(f"[idea] LỖI: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/generate-image/suggest-attribute")
async def suggest_attribute_endpoint(body: dict):
    """Suggest 3 creative values for one attribute."""
    attribute_name = body.get("attribute_name", "")
    current_values = body.get("current_values", [])
    full_table = body.get("full_table", "")
    if not attribute_name:
        raise HTTPException(status_code=400, detail="Missing attribute_name")
    from create_image_by_ai.image_generator import suggest_attribute
    try:
        suggestions = await suggest_attribute(attribute_name, current_values, full_table)
        return {"suggestions": suggestions}
    except Exception as e:
        import traceback
        print(f"[suggest-attribute] LỖI: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/generate-image/suggest-concepts")
async def suggest_concepts_endpoint(body: dict):
    """Generate 3 overall design concepts from an attribute table."""
    attribute_table = body.get("attribute_table", "")
    if not attribute_table:
        raise HTTPException(status_code=400, detail="Missing attribute_table")
    from create_image_by_ai.image_generator import suggest_concepts
    try:
        concepts = await suggest_concepts(attribute_table)
        return {"concepts": concepts}
    except Exception as e:
        import traceback
        print(f"[suggest-concepts] LỖI: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/generate-image/build-prompt")
async def build_image_prompt_endpoint(body: dict):
    """Build image generation prompts from a finalized attribute table."""
    attribute_table = body.get("attribute_table", "")
    if not attribute_table:
        raise HTTPException(status_code=400, detail="Missing attribute_table")
    from create_image_by_ai.image_generator import build_image_prompt
    try:
        prompts = await build_image_prompt(attribute_table)
        return {"prompts": prompts}
    except Exception as e:
        import traceback
        print(f"[build-prompt] LỖI: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ── Routes: Image Similarity Search ───────────────────────────────────────────

@router.post("/api/search_by_image", response_model=SearchByImageResponse)
async def search_by_image_endpoint(
    history_id: str = Form(..., description="ID lịch sử crawl để so sánh"),
    file: UploadFile = File(..., description="Ảnh cần tìm kiếm"),
):
    """
    Upload an image and find visually similar pins in a crawl history.
    Returns pins sorted by CLIP similarity score (0–1).
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Vui lòng gửi file ảnh (image/*).")

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File ảnh rỗng.")

    from history_utils import load_history_data
    try:
        meta = load_history_data(history_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Không tìm thấy lịch sử crawl này.")

    def _run():
        try:
            from clip_service import ClipNotAvailableError, search_by_image
        except ImportError as e:
            raise HTTPException(
                status_code=503,
                detail="Chức năng tìm theo ảnh không có trong bản exe. Chạy từ source (Python + torch) để dùng.",
            ) from e
        try:
            pairs = search_by_image(history_id, image_bytes, top_k=100)
        except ClipNotAvailableError as e:
            raise HTTPException(status_code=503, detail=e.message)
        keyword = meta.get("keyword", "")
        pins_with_score = [
            {**pin, "similarity_score": score}
            for pin, score in pairs
        ]
        return SearchByImageResponse(keyword=keyword, total=len(pins_with_score), pins=pins_with_score)

    try:
        return await asyncio.to_thread(_run)
    except HTTPException:
        raise
    except Exception as e:
        if "ClipNotAvailableError" in type(e).__name__ or "OSError" in str(type(e)):
            raise HTTPException(
                status_code=503,
                detail=(
                    "Không load được PyTorch/CLIP. Hãy chạy uvicorn bằng Python env "
                    "đã cài torch (vd: conda/base), không dùng venv social_crawl; "
                    "hoặc cài Visual C++ Redistributable. Chi tiết: " + str(e)
                ),
            )
        raise


@router.post("/api/search_by_prompt", response_model=SearchByPromptResponse)
async def search_by_prompt_endpoint(
    history_id: str = Form(..., description="ID lịch sử crawl để tìm kiếm"),
    prompt: str = Form(..., description="Mô tả ảnh cần tìm (VD: con mèo đen có đốm trắng)"),
):
    """
    Find images in a crawl history based on a text description.
    Uses OpenCLIP + opus-mt Vietnamese→English translation.
    """
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập mô tả ảnh cần tìm.")

    from history_utils import load_history_data
    try:
        meta = load_history_data(history_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Không tìm thấy lịch sử crawl này.")

    def _run():
        try:
            from translate_service import translate_prompt_for_clip
            from open_clip_service import OpenClipNotAvailableError, search_by_prompt_open_clip
        except ImportError as e:
            raise HTTPException(
                status_code=503,
                detail="Chức năng tìm theo mô tả không có trong bản exe. Chạy từ source (Python + open_clip/transformers) để dùng.",
            ) from e
        try:
            search_prompt, prompt_translated = translate_prompt_for_clip(prompt.strip())
            results = search_by_prompt_open_clip(history_id, search_prompt, top_k=50)
        except OpenClipNotAvailableError as e:
            raise HTTPException(status_code=503, detail=e.message)
        keyword = meta.get("keyword", "")
        pins_with_score = [
            {**pin, "confidence_score": score, "explanation": explanation}
            for pin, score, explanation in results
        ]
        return SearchByPromptResponse(
            keyword=keyword,
            prompt=prompt.strip(),
            prompt_translated=prompt_translated,
            total=len(pins_with_score),
            pins=pins_with_score,
        )

    try:
        return await asyncio.to_thread(_run)
    except HTTPException:
        raise
    except Exception as e:
        err_name = type(e).__name__
        if "NotAvailableError" in err_name:
            raise HTTPException(
                status_code=503,
                detail=f"Không load được OpenCLIP. pip install open-clip-torch. Chi tiết: {e}",
            )
        raise
