import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException


HISTORY_DIR = Path("history/hunt/keyword")
PROMPTS_PATH = Path("etsy_listing/prompts.json")
AI_HISTORY_DIR = Path("history/hunt/keyword_ai_processed")
LISTING_HISTORY_DIR = Path("history/etsy-listing/listing")
LISTING_ASSET_DIR = Path("history/etsy-listing/listing_assets")

SOURCE_FILENAME_RE = re.compile(r"^etsy_keywords_(.+?)_(\d{8}_\d{6})\.csv$")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _read_json(path: Path, context: str) -> dict | list:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi đọc {context}: {e}") from e


def load_prompts_config() -> list[dict]:
    if not PROMPTS_PATH.exists():
        raise HTTPException(status_code=500, detail="Thiếu cấu hình prompts.json")
    data = _read_json(PROMPTS_PATH, "prompts.json")
    if not isinstance(data, list):
        raise HTTPException(status_code=500, detail="prompts.json không đúng định dạng.")
    return data


def get_prompt_config(prompt_id: str) -> dict:
    prompts_cfg = load_prompts_config()
    prompt_config = next((p for p in prompts_cfg if p.get("id") == prompt_id), None)
    if not prompt_config:
        raise HTTPException(status_code=500, detail=f"Thiếu prompt {prompt_id}.")
    return prompt_config.get("prompt", {})


def strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        return cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    if cleaned.startswith("```"):
        return cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return cleaned


def raise_for_ai_error(e: Exception, context: str = "AI") -> None:
    """Re-raise Gemini errors with the right HTTP status code."""
    err_str = str(e)
    if "503" in err_str or "UNAVAILABLE" in err_str or "high demand" in err_str.lower():
        raise HTTPException(
            status_code=503,
            detail="Gemini is currently overloaded. Please wait a moment and try again.",
        ) from e
    raise HTTPException(status_code=502, detail=f"{context}: {err_str}") from e


def slugify_listing_name(name: str) -> str:
    """Convert a listing name to a URL/filename-safe slug."""
    name = re.sub(r"[^\w\s-]", "", (name or "").strip())
    name = re.sub(r"[\s_]+", "-", name)
    name = re.sub(r"-{2,}", "-", name)
    return name.strip("-").lower() or "listing"


def ensure_listing_name(listing_name: str) -> str:
    listing_name = (listing_name or "").strip()
    if not listing_name or "/" in listing_name or "\\" in listing_name:
        raise HTTPException(status_code=400, detail="listing_name không hợp lệ.")
    return listing_name


def ensure_source_filename(source_filename: str) -> str:
    source_filename = (source_filename or "").strip()
    if not source_filename or "/" in source_filename or "\\" in source_filename or not source_filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="source_filename không hợp lệ.")
    return source_filename


def seed_keyword_from_source_filename(source_filename: str) -> str:
    try:
        source_filename = ensure_source_filename(source_filename)
    except HTTPException:
        return ""
    match = SOURCE_FILENAME_RE.match(source_filename)
    if match:
        return match.group(1)
    return Path(source_filename).stem


def get_listing_history_path(listing_name: str) -> Path:
    slug = slugify_listing_name(listing_name)
    return LISTING_HISTORY_DIR / f"{slug}.json"


def build_empty_listing_history(listing_name: str, source_filename: str = "", seed_keyword: str = "") -> dict:
    listing_name = ensure_listing_name(listing_name)
    timestamp = now_iso()
    return {
        "listing_name": listing_name,
        "source_filename": source_filename,
        "seed_keyword": seed_keyword,
        "created_at": timestamp,
        "updated_at": timestamp,
        "req1": None,
        "req2": None,
        "req3": None,
        "req4": None,
        "req5": None,
    }


def _normalize_listing_history(
    history: dict,
    listing_name: str = "",
    source_filename: str = "",
    seed_keyword: str = "",
) -> dict:
    resolved_name = listing_name or history.get("listing_name", "")
    if not resolved_name:
        resolved_name = "listing"
    base = build_empty_listing_history(
        resolved_name,
        source_filename or history.get("source_filename", ""),
        seed_keyword or history.get("seed_keyword", ""),
    )
    base.update(history or {})
    base["listing_name"] = ensure_listing_name(base.get("listing_name") or resolved_name)
    base["source_filename"] = base.get("source_filename", "")
    base["seed_keyword"] = base.get("seed_keyword", "")
    base["created_at"] = base.get("created_at") or now_iso()
    base["updated_at"] = base.get("updated_at") or base["created_at"]
    for key in ("req1", "req2", "req3", "req4", "req5"):
        base.setdefault(key, None)
    return base


def get_listing_asset_dir(listing_name: str, scope: str) -> Path:
    slug = slugify_listing_name(listing_name)
    safe_scope = re.sub(r"[^a-z0-9_-]", "_", (scope or "").strip().lower()) or "assets"
    return LISTING_ASSET_DIR / slug / safe_scope


def build_listing_asset_url(listing_name: str, scope: str, filename: str) -> str:
    slug = slugify_listing_name(listing_name)
    filename = Path(filename).name
    safe_scope = re.sub(r"[^a-z0-9_-]", "_", (scope or "").strip().lower()) or "assets"
    return (
        f"/api/listing/assets/{quote(slug, safe='')}/"
        f"{quote(safe_scope, safe='')}/{quote(filename, safe='')}"
    )


def save_listing_history(history: dict) -> dict:
    if not history or not history.get("listing_name"):
        raise HTTPException(status_code=500, detail="Dữ liệu listing history không hợp lệ.")

    normalized = _normalize_listing_history(
        history,
        history.get("listing_name", ""),
        history.get("source_filename", ""),
        history.get("seed_keyword", ""),
    )
    normalized["updated_at"] = now_iso()

    LISTING_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    history_path = get_listing_history_path(normalized["listing_name"])
    history_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalized


def load_listing_history(listing_name: str, source_filename: str = "", seed_keyword: str = "") -> dict | None:
    listing_name = ensure_listing_name(listing_name)
    history_path = get_listing_history_path(listing_name)
    if not history_path.exists():
        return None
    data = _read_json(history_path, f"listing history {history_path.name}")
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail=f"listing history {history_path.name} không đúng định dạng.")
    return _normalize_listing_history(data, listing_name, source_filename, seed_keyword)


def get_or_create_listing_history(listing_name: str, source_filename: str = "", seed_keyword: str = "") -> dict:
    history = load_listing_history(listing_name, source_filename, seed_keyword)
    if history:
        return history
    return build_empty_listing_history(listing_name, source_filename, seed_keyword)


def build_listing_history_response(history: dict) -> dict:
    normalized = _normalize_listing_history(
        history,
        history.get("listing_name", ""),
        history.get("source_filename", ""),
        history.get("seed_keyword", ""),
    )
    response = {
        "exists": True,
        "history_filename": get_listing_history_path(normalized["listing_name"]).name,
        **normalized,
    }
    req1 = normalized.get("req1")
    if isinstance(req1, dict):
        response["out_filename"] = req1.get("out_filename")
        response["total_filtered"] = req1.get("total_filtered", 0)
        response["data"] = req1.get("data", [])
    return response


def list_all_listing_histories() -> list[dict]:
    """Return a summary of all listing histories, sorted by updated_at desc."""
    if not LISTING_HISTORY_DIR.exists():
        return []
    results = []
    for path in LISTING_HISTORY_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                continue
            results.append({
                "listing_name": data.get("listing_name", path.stem),
                "source_filename": data.get("source_filename", ""),
                "seed_keyword": data.get("seed_keyword", ""),
                "updated_at": data.get("updated_at", ""),
                "has_req1": bool(data.get("req1")),
                "has_req2": bool(data.get("req2")),
                "has_req3": bool(data.get("req3")),
                "has_req4": bool(data.get("req4")),
                "has_req5": bool(data.get("req5")),
            })
        except Exception:
            continue
    results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return results


def load_legacy_ai_processed(seed_keyword: str) -> dict | None:
    if not AI_HISTORY_DIR.exists():
        return None
    prefix = f"etsy_keywords_{seed_keyword.replace(' ', '_')}_AI_"
    files = list(AI_HISTORY_DIR.glob(f"{prefix}*.json"))
    if not files:
        return None
    files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    latest_file = files[0]
    data = _read_json(latest_file, f"file AI processed {latest_file.name}")
    items = data if isinstance(data, list) else data.get("data", []) if isinstance(data, dict) else []
    updated_at = datetime.fromtimestamp(latest_file.stat().st_mtime).isoformat(timespec="seconds")
    return {
        "out_filename": latest_file.name,
        "total_filtered": len(items),
        "data": items,
        "updated_at": updated_at,
    }
