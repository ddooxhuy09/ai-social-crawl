import asyncio
import csv
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from create_image_by_ai.image_generator import GEMINI_TEXT_MODEL, _get_gemini_client
from etsy_listing.shared import (
    AI_HISTORY_DIR,
    HISTORY_DIR,
    build_listing_history_response,
    build_empty_listing_history,
    ensure_listing_name,
    get_or_create_listing_history,
    get_prompt_config,
    list_all_listing_histories,
    load_listing_history,
    now_iso,
    raise_for_ai_error,
    save_listing_history,
    seed_keyword_from_source_filename,
    strip_code_fence,
)


router = APIRouter()


class CreateListingRequest(BaseModel):
    listing_name: str


class KeywordProcessRequest(BaseModel):
    listing_name: str
    filename: str
    seed_keyword: str
    project_id: str | None = None


@router.get("/api/listing/all")
async def list_all_listings():
    return list_all_listing_histories()


@router.post("/api/listing/create")
async def create_listing(req: CreateListingRequest):
    listing_name = ensure_listing_name(req.listing_name)
    existing = load_listing_history(listing_name)
    if existing:
        return {"listing_name": listing_name, "created": False}
    history = build_empty_listing_history(listing_name)
    history = save_listing_history(history)
    return {"listing_name": listing_name, "created": True}


@router.get("/api/listing/history/{listing_name}")
async def get_listing_history(listing_name: str):
    history = load_listing_history(listing_name)
    if not history or not history.get("req1"):
        return {"exists": False, "listing_name": listing_name}
    return build_listing_history_response(history)


@router.post("/api/listing/keywords")
async def process_keywords_with_ai(req: KeywordProcessRequest):
    """
    REQ 1: Reads an EtsyHunt CSV, sorts by score, takes top candidates,
    and asks Google GenAI to strictly extract highly relevant long-tail terms.
    The result is saved into the unified listing history keyed by listing_name.
    """
    if req.project_id:
        from etsy_hunt.etsy_hunt_keyword import _keyword_history_dir
        csv_path = _keyword_history_dir(req.project_id) / req.filename
        if not csv_path.exists():
            csv_path = HISTORY_DIR / req.filename  # fallback to global dir
    else:
        csv_path = HISTORY_DIR / req.filename
    if not csv_path.exists() or csv_path.suffix != ".csv":
        raise HTTPException(status_code=404, detail="File CSV không tồn tại.")

    seed_keyword = req.seed_keyword or seed_keyword_from_source_filename(req.filename)

    items = []
    with csv_path.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                score = float(row.get("score") or 0)
            except ValueError:
                score = 0.0
            try:
                long_tail = int(row.get("is_long_tail") or 0)
            except ValueError:
                long_tail = 0

            row["_float_score"] = score
            row["_is_long_tail"] = long_tail
            items.append(row)

    if not items:
        raise HTTPException(status_code=400, detail="File CSV rỗng.")

    items.sort(key=lambda x: (x["_is_long_tail"], x["_float_score"]), reverse=True)
    top_items = items[:300]
    keyword_list_str = "\n".join(f"- {item['keyword']}" for item in top_items)

    prompt_obj = get_prompt_config("req1_keyword_filter")
    role = prompt_obj.get("role", "")
    task = prompt_obj.get("task", "").replace("{seed_keyword}", seed_keyword)
    rules = "\n".join(f"- {rule}" for rule in prompt_obj.get("rules", []))
    final_prompt = f"Role: {role}\nTask: {task}\nRules:\n{rules}"
    final_prompt += f"\n\nHere are the high-scoring keywords:\n{keyword_list_str}"

    try:
        client = _get_gemini_client()
        print(f"[REQ1] Calling Gemini on {len(top_items)} keywords for: {seed_keyword}")
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=GEMINI_TEXT_MODEL,
            contents=final_prompt,
        )
        text = strip_code_fence(response.text)
        filtered_keywords = json.loads(text)
        if not isinstance(filtered_keywords, list):
            raise ValueError("GenAI response was not a valid list.")
    except Exception as e:
        print(f"[REQ1] Error from AI: {e}\nRaw output:\n{text if 'text' in locals() else 'None'}")
        raise_for_ai_error(e, "REQ1 keyword filter")

    ai_approved_lower = [str(keyword).lower().strip() for keyword in filtered_keywords]
    final_items = []
    for item in top_items:
        if item["keyword"].lower().strip() in ai_approved_lower:
            item.pop("_float_score", None)
            item.pop("_is_long_tail", None)
            final_items.append(item)

    if not final_items:
        final_items = [item.copy() for item in top_items[:15]]
        for item in final_items:
            item.pop("_float_score", None)
            item.pop("_is_long_tail", None)

    AI_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_filename = f"etsy_keywords_{seed_keyword.replace(' ', '_')}_AI_{timestamp}.json"
    out_path = AI_HISTORY_DIR / out_filename
    out_path.write_text(json.dumps(final_items, ensure_ascii=False, indent=2), encoding="utf-8")

    history = get_or_create_listing_history(req.listing_name, req.filename, seed_keyword)
    history["source_filename"] = req.filename
    history["seed_keyword"] = seed_keyword
    history["req1"] = {
        "out_filename": out_filename,
        "total_filtered": len(final_items),
        "data": final_items,
        "updated_at": now_iso(),
    }
    history["req2"] = None
    history["req3"] = None
    history["req4"] = None
    history["req5"] = None
    history = save_listing_history(history)

    print(f"[REQ1] Successfully saved {len(final_items)} AI-filtered keywords to {out_path}")
    return build_listing_history_response(history)
