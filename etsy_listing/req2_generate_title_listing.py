import asyncio
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from create_image_by_ai.image_generator import GEMINI_TEXT_MODEL, _get_gemini_client
from etsy_listing.shared import (
    build_listing_history_response,
    get_prompt_config,
    load_listing_history,
    now_iso,
    raise_for_ai_error,
    save_listing_history,
    strip_code_fence,
)


router = APIRouter()


class GenerateTitlesRequest(BaseModel):
    listing_name: str
    custom_attributes: str = ""
    seed_keyword: str = ""


class TitleManualRequest(BaseModel):
    listing_name: str
    title: str


@router.post("/api/listing/title_manual")
async def save_manual_title(req: TitleManualRequest):
    """
    REQ 2 (Manual): Add a manually entered title to the list of generated titles, or create new.
    """
    history = load_listing_history(req.listing_name)
    if not history or not history.get("req1"):
        raise HTTPException(status_code=404, detail="Không tìm thấy dữ liệu REQ1 cho listing này.")

    manual_title = req.title.strip()
    if not manual_title:
        raise HTTPException(status_code=400, detail="Vui lòng nhập title hợp lệ.")

    # Get existing titles if any
    existing_req2 = history.get("req2") or {}
    titles_list = existing_req2.get("titles") or []
    
    # Add new title at the beginning
    if manual_title not in titles_list:
        titles_list.insert(0, manual_title)

    history["req2"] = {
        "custom_attributes": existing_req2.get("custom_attributes", ""),
        "titles": titles_list,
        "updated_at": now_iso(),
    }
    history = save_listing_history(history)
    return build_listing_history_response(history)


@router.post("/api/listing/generate_titles")
async def generate_listing_titles(req: GenerateTitlesRequest):
    """
    REQ 2: Generate 5 optimized product titles and save them into the same listing history.
    """
    history = load_listing_history(req.listing_name)
    if not history or not history.get("req1"):
        raise HTTPException(status_code=404, detail="Không tìm thấy dữ liệu REQ1 cho listing này.")

    items = history["req1"].get("data") or []
    if not items:
        raise HTTPException(status_code=400, detail="History REQ1 không có keyword để tạo title.")

    seed_keyword = req.seed_keyword or history.get("seed_keyword") or ""
    keyword_list_str = "\n".join(f"- {item.get('keyword', '')}" for item in items[:50])

    prompt_obj = get_prompt_config("req2_title_generator")
    task_desc = prompt_obj.get("task", "").replace("{seed_keyword}", seed_keyword)
    task_desc = task_desc.replace("{ai_keywords}", keyword_list_str)
    task_desc = task_desc.replace("{custom_attributes}", req.custom_attributes)

    sys_instr = f"Role: {prompt_obj.get('role', '')}\n\nTask: {task_desc}\n\nRules:\n"
    for rule in prompt_obj.get("rules", []):
        sys_instr += f"- {rule}\n"

    try:
        client = _get_gemini_client()
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=GEMINI_TEXT_MODEL,
            contents=sys_instr,
            config={"temperature": 0.7},
        )
        text = strip_code_fence(response.text)
        titles_json = json.loads(text)
        if not isinstance(titles_json, list):
            raise ValueError("API did not return a valid list of titles.")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise_for_ai_error(e, "REQ2 generate titles")

    history["seed_keyword"] = seed_keyword
    history["req2"] = {
        "custom_attributes": req.custom_attributes,
        "titles": titles_json,
        "updated_at": now_iso(),
    }
    history["req3"] = None
    history["req4"] = None
    history = save_listing_history(history)
    return build_listing_history_response(history)
