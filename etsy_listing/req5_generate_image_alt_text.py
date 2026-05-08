import asyncio
import io
import json
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image as PILImage, UnidentifiedImageError

from create_image_by_ai.image_generator import GEMINI_VISION_MODEL, _get_gemini_client
from etsy_listing.shared import (
    build_listing_asset_url,
    build_listing_history_response,
    ensure_listing_name,
    get_listing_asset_dir,
    get_prompt_config,
    load_listing_history,
    now_iso,
    save_listing_history,
    slugify_listing_name,
    strip_code_fence,
)


router = APIRouter()

ALT_SCOPE = "req5"
KEYWORD_CONTEXT_LIMIT = 25
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _score_value(item: dict) -> float:
    try:
        return float(item.get("score") or 0)
    except (TypeError, ValueError):
        return 0.0


def _clean_text(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"[\r\n\t]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -_")


def _slugify(text: str) -> str:
    cleaned = _clean_text(text).lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", cleaned)
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    return cleaned.strip("-")


def _safe_stem(filename: str) -> str:
    stem = _clean_text(Path(filename or "image").stem)
    stem = re.sub(r"[^a-zA-Z0-9_-]+", "_", stem)
    return stem.strip("_") or "image"


def _keyword_pool(items: list[dict]) -> list[str]:
    keywords: list[str] = []
    seen: set[str] = set()
    for item in sorted(items, key=_score_value, reverse=True):
        keyword = _clean_text(str(item.get("keyword") or ""))
        slug = _slugify(keyword)
        if not keyword or not slug or slug in seen:
            continue
        seen.add(slug)
        keywords.append(keyword)
    return keywords


def _match_keyword(candidate: str, keyword_pool: list[str], used_keywords: list[str]) -> str:
    if not keyword_pool:
        raise ValueError("REQ5 keyword pool is empty.")

    candidate_slug = _slugify(candidate)
    if candidate_slug:
        exact_unused = [kw for kw in keyword_pool if _slugify(kw) == candidate_slug and kw not in used_keywords]
        if exact_unused:
            return exact_unused[0]

        exact_any = [kw for kw in keyword_pool if _slugify(kw) == candidate_slug]
        if exact_any:
            return exact_any[0]

        candidate_tokens = set(candidate_slug.split("-"))
        ranked = []
        for index, keyword in enumerate(keyword_pool):
            tokens = set(_slugify(keyword).split("-"))
            overlap = len(candidate_tokens & tokens)
            if overlap <= 0:
                continue
            ranked.append((keyword in used_keywords, -overlap, index, keyword))
        if ranked:
            ranked.sort()
            return ranked[0][3]

    unused = [kw for kw in keyword_pool if kw not in used_keywords]
    return unused[0] if unused else keyword_pool[0]


def _strip_forbidden_prefixes(slug: str) -> str:
    return re.sub(r"^(image|picture|photo)(-of)?-", "", slug)


def _normalize_file_name(raw: str, fallback_keyword: str) -> str:
    slug = _slugify(raw or "")
    # Strip leading 'kniri-' to avoid duplication before re-adding
    slug = re.sub(r"^kniri-+", "", slug)
    slug = slug.strip("-") or _slugify(fallback_keyword)
    return f"Kniri-{slug}"


def _finalize_alt_text(raw_alt_text: str, keyword_used: str) -> str:
    keyword_slug = _slugify(keyword_used)
    raw_slug = _strip_forbidden_prefixes(_slugify(raw_alt_text))
    keyword_parts = keyword_slug.split("-")

    if not raw_slug:
        return keyword_slug

    extra_parts: list[str] = []
    seen = set(keyword_parts)
    for part in raw_slug.split("-"):
        if not part or part in {"image", "picture", "photo", "of"}:
            continue
        if part in seen:
            continue
        seen.add(part)
        extra_parts.append(part)

    if extra_parts:
        return f"{keyword_slug}-{'-'.join(extra_parts[:6])}"
    return keyword_slug


def _ensure_unique_alt_text(
    alt_text: str,
    keyword_used: str,
    keyword_pool: list[str],
    used_keywords: list[str],
    used_alt_texts: set[str],
) -> tuple[str, str]:
    if alt_text not in used_alt_texts:
        return alt_text, keyword_used

    for keyword in keyword_pool:
        if keyword == keyword_used or keyword in used_keywords:
            continue
        candidate = _finalize_alt_text(alt_text, keyword)
        if candidate not in used_alt_texts:
            return candidate, keyword

    counter = 2
    candidate = alt_text
    while candidate in used_alt_texts:
        candidate = f"{alt_text}-{counter}"
        counter += 1
    return candidate, keyword_used


def _build_generation_prompt(
    source_filename: str,
    seed_keyword: str,
    keyword_pool: list[str],
    used_keywords: list[str],
) -> str:
    prompt_obj = get_prompt_config("req5_alt_text_generator")
    keyword_context = "\n".join(f"- {keyword}" for keyword in keyword_pool[:KEYWORD_CONTEXT_LIMIT]) or "- none"
    used_context = "\n".join(f"- {keyword}" for keyword in used_keywords) or "- none"

    task = prompt_obj.get("task", "")
    task = task.replace("{filename}", source_filename)
    task = task.replace("{seed_keyword}", seed_keyword)
    task = task.replace("{ai_keywords}", keyword_context)
    task = task.replace("{used_keywords}", used_context)

    rules = "\n".join(f"- {rule}" for rule in prompt_obj.get("rules", []))
    return f"Role: {prompt_obj.get('role', '')}\n\nTask: {task}\n\nRules:\n{rules}"


async def _generate_alt_candidate(image_bytes: bytes, prompt: str) -> dict:
    try:
        image = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")
    except (UnidentifiedImageError, OSError) as e:
        raise ValueError("Uploaded file is not a valid image.") from e

    client = _get_gemini_client()
    response = await asyncio.to_thread(
        client.models.generate_content,
        model=GEMINI_VISION_MODEL,
        contents=[prompt, image],
        config={"temperature": 0.4},
    )
    text = strip_code_fence(response.text or "")
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("REQ5 AI response was not a valid object.")
    return parsed


def _clear_asset_dir(asset_dir: Path) -> None:
    if not asset_dir.exists():
        return
    for child in asset_dir.iterdir():
        if child.is_file():
            child.unlink()


def _extension_from_name(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in ALLOWED_EXTENSIONS:
        return suffix
    return ".png"


async def _save_uploaded_assets(files: list[UploadFile], asset_dir: Path) -> list[dict]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    assets: list[dict] = []

    for index, upload in enumerate(files, start=1):
        if not upload.content_type or not upload.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="REQ5 chi ho tro file anh (image/*).")

        image_bytes = await upload.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Co file anh rong trong REQ5.")

        try:
            PILImage.open(io.BytesIO(image_bytes)).verify()
        except (UnidentifiedImageError, OSError) as e:
            raise HTTPException(status_code=400, detail=f"File '{upload.filename}' khong phai anh hop le.") from e

        extension = _extension_from_name(upload.filename or "")
        stored_filename = f"{timestamp}_{index:02d}_{_safe_stem(upload.filename or f'image_{index}')}{extension}"
        stored_path = asset_dir / stored_filename
        stored_path.write_bytes(image_bytes)

        assets.append(
            {
                "original_filename": upload.filename or stored_filename,
                "stored_filename": stored_filename,
                "bytes": image_bytes,
            }
        )

    return assets


def _load_saved_assets(listing_name: str, history_req5: dict | None) -> list[dict]:
    req5_images = (history_req5 or {}).get("images") or []
    if not req5_images:
        raise HTTPException(status_code=400, detail="Vui lòng upload ít nhất 1 ảnh cho REQ5.")

    asset_dir = get_listing_asset_dir(listing_name, ALT_SCOPE)
    assets: list[dict] = []
    for item in req5_images:
        stored_filename = Path(str(item.get("stored_filename") or "")).name
        if not stored_filename:
            continue

        stored_path = asset_dir / stored_filename
        if not stored_path.exists():
            continue

        assets.append(
            {
                "original_filename": item.get("original_filename") or stored_filename,
                "stored_filename": stored_filename,
                "bytes": stored_path.read_bytes(),
            }
        )

    if not assets:
        raise HTTPException(status_code=404, detail="Khong tim thay file anh da luu cho REQ5.")
    return assets


@router.get("/api/listing/assets/{listing_slug}/{scope}/{filename}")
async def get_listing_asset(listing_slug: str, scope: str, filename: str):
    safe_slug = re.sub(r"[^a-z0-9_-]", "-", (listing_slug or "").strip().lower()).strip("-") or "listing"
    safe_scope = re.sub(r"[^a-z0-9_-]", "_", (scope or "").strip().lower()) or "assets"
    safe_filename = Path(filename).name

    from etsy_listing.shared import LISTING_ASSET_DIR
    asset_path = LISTING_ASSET_DIR / safe_slug / safe_scope / safe_filename
    if not asset_path.exists() or not asset_path.is_file():
        raise HTTPException(status_code=404, detail="Listing asset not found.")
    return FileResponse(asset_path)


@router.post("/api/listing/generate_alt_texts")
async def generate_image_alt_texts(
    listing_name: str = Form(...),
    seed_keyword: str = Form(""),
    files: list[UploadFile] | None = File(None),
):
    """
    REQ 5: Generate SEO alt text for uploaded listing images using REQ1 keywords.
    """
    listing_name = ensure_listing_name(listing_name)
    history = load_listing_history(listing_name)
    if not history or not history.get("req1"):
        raise HTTPException(status_code=404, detail="Không tìm thấy dữ liệu REQ1 cho listing này.")

    items = history["req1"].get("data") or []
    if not items:
        raise HTTPException(status_code=400, detail="History REQ1 không có keyword để tạo alt text.")

    keyword_pool = _keyword_pool(items)
    if not keyword_pool:
        raise HTTPException(status_code=400, detail="REQ1 history không có keyword hợp lệ cho REQ5.")

    seed_keyword = seed_keyword or history.get("seed_keyword") or ""
    asset_dir = get_listing_asset_dir(listing_name, ALT_SCOPE)

    if files:
        asset_dir.mkdir(parents=True, exist_ok=True)
        _clear_asset_dir(asset_dir)
        assets = await _save_uploaded_assets(files, asset_dir)
    else:
        assets = _load_saved_assets(listing_name, history.get("req5"))

    generated_images: list[dict] = []
    used_keywords: list[str] = []

    for asset in assets:
        prompt = _build_generation_prompt(
            source_filename=asset["original_filename"],
            seed_keyword=seed_keyword,
            keyword_pool=keyword_pool,
            used_keywords=used_keywords,
        )

        ai_payload: dict = {}
        try:
            ai_payload = await _generate_alt_candidate(asset["bytes"], prompt)
        except Exception as e:
            print(f"[REQ5] AI alt generation fallback for {asset['original_filename']}: {e}")

        keyword_used = _match_keyword(str(ai_payload.get("keyword_used") or ""), keyword_pool, used_keywords)
        alt_text = str(ai_payload.get("alt_text") or keyword_used).strip()
        file_name = _normalize_file_name(str(ai_payload.get("file_name") or ""), keyword_used)

        used_keywords.append(keyword_used)
        generated_images.append(
            {
                "original_filename": asset["original_filename"],
                "stored_filename": asset["stored_filename"],
                "asset_url": build_listing_asset_url(listing_name, ALT_SCOPE, asset["stored_filename"]),
                "alt_text": alt_text,
                "file_name": file_name,
                "keyword_used": keyword_used,
            }
        )

    history["seed_keyword"] = seed_keyword
    history["req5"] = {
        "images": generated_images,
        "copy_text": "\n\n".join(
            f"Image {i+1} ({item['original_filename']}):\nFile Name: {item['file_name']}\nAlt Text: {item['alt_text']}" 
            for i, item in enumerate(generated_images)
        ),
        "updated_at": now_iso(),
    }
    history = save_listing_history(history)
    return build_listing_history_response(history)
