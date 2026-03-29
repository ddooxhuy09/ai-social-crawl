import asyncio
import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from create_image_by_ai.image_generator import GEMINI_TEXT_MODEL, _get_gemini_client
from etsy_listing.shared import (
    build_listing_history_response,
    get_prompt_config,
    load_listing_history,
    now_iso,
    save_listing_history,
    strip_code_fence,
)


router = APIRouter()

TARGET_TAG_COUNT = 13
BASE_TAG_TARGET = 9
MAX_TOKEN_REPEAT = 3
STOPWORDS = {
    "a",
    "an",
    "and",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "the",
    "to",
    "with",
}


class GenerateTagsRequest(BaseModel):
    listing_name: str
    listing_title: str
    custom_attributes: str = ""
    seed_keyword: str = ""


def _score_value(item: dict) -> float:
    try:
        return float(item.get("score") or 0)
    except (TypeError, ValueError):
        return 0.0


def _clean_phrase(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"[\r\n\t]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" ,|;-")
    return text


def _singularize(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("es"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _normalized_tokens(text: str) -> list[str]:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    tokens = []
    for raw in cleaned.split():
        if raw in STOPWORDS:
            continue
        tokens.append(_singularize(raw))
    return tokens


def _normalized_key(text: str) -> str:
    return " ".join(_normalized_tokens(text))


def _countable_tokens(text: str) -> list[str]:
    return [token for token in _normalized_tokens(text) if len(token) >= 4 and not token.isdigit()]


def _word_count(text: str) -> int:
    return len([part for part in _clean_phrase(text).split(" ") if part])


def _is_tag_length_ok(text: str) -> bool:
    return 2 <= _word_count(text) <= 3 and len(text) <= 20


def _shares_too_much(candidate: str, selected: list[str]) -> bool:
    candidate_tokens = set(_normalized_tokens(candidate))
    if not candidate_tokens:
        return True

    for existing in selected:
        existing_tokens = set(_normalized_tokens(existing))
        if not existing_tokens:
            continue
        if candidate_tokens == existing_tokens:
            return True
        if candidate_tokens.issubset(existing_tokens) or existing_tokens.issubset(candidate_tokens):
            return True

        overlap = len(candidate_tokens & existing_tokens)
        shortest = min(len(candidate_tokens), len(existing_tokens))
        if shortest >= 2 and overlap / shortest >= 0.8:
            return True
    return False


def _would_exceed_token_repeat_limit(candidate: str, selected: list[str]) -> bool:
    candidate_tokens = set(_countable_tokens(candidate))
    if not candidate_tokens:
        return False

    token_counts: dict[str, int] = {}
    for existing in selected:
        for token in set(_countable_tokens(existing)):
            token_counts[token] = token_counts.get(token, 0) + 1

    for token in candidate_tokens:
        if token_counts.get(token, 0) >= MAX_TOKEN_REPEAT:
            return True
    return False


def _append_distinct_tag(
    target: list[dict],
    seen_keys: set[str],
    tag: str,
    source: str,
    score: float | None = None,
) -> bool:
    cleaned = _clean_phrase(tag)
    normalized = _normalized_key(cleaned)
    selected_tags = [item["tag"] for item in target]

    if not cleaned or not normalized:
        return False
    if normalized in seen_keys:
        return False
    if not _is_tag_length_ok(cleaned):
        return False
    if _shares_too_much(cleaned, selected_tags):
        return False
    if _would_exceed_token_repeat_limit(cleaned, selected_tags):
        return False

    seen_keys.add(normalized)
    target.append(
        {
            "tag": cleaned,
            "source": source,
            "score": score,
        }
    )
    return True


def _extract_title_candidates(listing_title: str) -> list[str]:
    candidates = []
    for part in re.split(r"[|,/]+", listing_title):
        cleaned = _clean_phrase(part)
        if _is_tag_length_ok(cleaned):
            candidates.append(cleaned)
    return candidates


def _extract_attribute_candidates(custom_attributes: str) -> list[str]:
    candidates = []
    for part in re.split(r"[,|/]+", custom_attributes):
        cleaned = _clean_phrase(part)
        if _is_tag_length_ok(cleaned):
            candidates.append(cleaned)
    return candidates


def _build_generation_prompt(
    req: GenerateTagsRequest,
    base_tags: list[dict],
    items: list[dict],
    missing_count: int,
) -> str:
    prompt_obj = get_prompt_config("req3_tag_generator")
    base_tags_text = "\n".join(f"- {item['tag']}" for item in base_tags) or "- none"
    keyword_context = "\n".join(
        f"- {item.get('keyword', '')} (score: {_score_value(item):.2f})" for item in items[:40]
    )

    task = prompt_obj.get("task", "")
    task = task.replace("{seed_keyword}", req.seed_keyword)
    task = task.replace("{listing_title}", req.listing_title)
    task = task.replace("{custom_attributes}", req.custom_attributes or "None")
    task = task.replace("{base_tags}", base_tags_text)
    task = task.replace("{ai_keywords}", keyword_context)
    task = task.replace("{tag_count}", str(missing_count))

    rules = "\n".join(
        f"- {rule.replace('{tag_count}', str(missing_count))}"
        for rule in prompt_obj.get("rules", [])
    )
    return f"Role: {prompt_obj.get('role', '')}\n\nTask: {task}\n\nRules:\n{rules}"


async def _generate_ai_tags(
    req: GenerateTagsRequest,
    base_tags: list[dict],
    items: list[dict],
    missing_count: int,
) -> list[str]:
    if missing_count <= 0:
        return []

    prompt = _build_generation_prompt(req, base_tags, items, missing_count)
    client = _get_gemini_client()
    response = await asyncio.to_thread(
        client.models.generate_content,
        model=GEMINI_TEXT_MODEL,
        contents=prompt,
        config={"temperature": 0.6},
    )
    text = strip_code_fence(response.text)
    parsed = json.loads(text)
    if not isinstance(parsed, list):
        raise ValueError("REQ3 AI response was not a valid list.")
    return [str(item) for item in parsed]


@router.post("/api/listing/generate_tags")
async def generate_listing_tags(req: GenerateTagsRequest):
    """
    REQ 3: Generate 13 Etsy tags from REQ1 keywords and save them into the same listing history.
    """
    history = load_listing_history(req.listing_name)
    if not history or not history.get("req1"):
        raise HTTPException(status_code=404, detail="Không tìm thấy dữ liệu REQ1 cho listing này.")
    if not req.listing_title.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập title để tạo tags.")

    items = history["req1"].get("data") or []
    if not items:
        raise HTTPException(status_code=400, detail="History REQ1 không có keyword để tạo tags.")

    effective_custom_attributes = req.custom_attributes or (history.get("req2") or {}).get("custom_attributes", "")
    seed_keyword = req.seed_keyword or history.get("seed_keyword") or ""
    work_req = GenerateTagsRequest(
        listing_name=req.listing_name,
        listing_title=req.listing_title.strip(),
        custom_attributes=effective_custom_attributes,
        seed_keyword=seed_keyword,
    )

    sorted_items = sorted(items, key=_score_value, reverse=True)
    final_details: list[dict] = []
    seen_keys: set[str] = set()

    for item in sorted_items:
        keyword = _clean_phrase(str(item.get("keyword") or ""))
        if _append_distinct_tag(
            final_details,
            seen_keys,
            keyword,
            source="req1",
            score=_score_value(item),
        ) and len(final_details) >= BASE_TAG_TARGET:
            break

    ai_error = None
    missing_count = TARGET_TAG_COUNT - len(final_details)
    if missing_count > 0:
        try:
            ai_tags = await _generate_ai_tags(work_req, final_details, sorted_items, missing_count)
            for tag in ai_tags:
                if len(final_details) >= TARGET_TAG_COUNT:
                    break
                _append_distinct_tag(final_details, seen_keys, tag, source="ai_generated", score=None)
        except Exception as e:
            ai_error = str(e)
            print(f"[REQ3] AI tag generation fallback: {ai_error}")

    for item in sorted_items:
        if len(final_details) >= TARGET_TAG_COUNT:
            break
        keyword = _clean_phrase(str(item.get("keyword") or ""))
        _append_distinct_tag(final_details, seen_keys, keyword, source="req1_fallback", score=_score_value(item))

    for candidate in _extract_title_candidates(work_req.listing_title):
        if len(final_details) >= TARGET_TAG_COUNT:
            break
        _append_distinct_tag(final_details, seen_keys, candidate, source="title_fallback", score=None)

    for candidate in _extract_attribute_candidates(work_req.custom_attributes):
        if len(final_details) >= TARGET_TAG_COUNT:
            break
        _append_distinct_tag(final_details, seen_keys, candidate, source="attribute_fallback", score=None)

    final_details = final_details[:TARGET_TAG_COUNT]
    final_tags = [item["tag"] for item in final_details]

    history["seed_keyword"] = seed_keyword
    history["req3"] = {
        "listing_title": work_req.listing_title,
        "custom_attributes": work_req.custom_attributes,
        "tags": final_tags,
        "details": final_details,
        "copy_text": ", ".join(final_tags),
        "updated_at": now_iso(),
    }
    history["req4"] = None
    history = save_listing_history(history)
    return build_listing_history_response(history)
