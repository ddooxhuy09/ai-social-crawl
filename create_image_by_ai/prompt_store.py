"""
Lưu và quản lý lịch sử prompt tạo ảnh AI.
"""
import json
from datetime import datetime
from pathlib import Path

PROMPTS_PATH = Path(__file__).parent / "prompts.json"


def _load() -> list[dict]:
    try:
        return json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(data: list[dict]) -> None:
    PROMPTS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def save_prompt(prompt: str, style: str = "", model: str = "imagen-3.0-generate-002") -> dict:
    """Lưu một prompt mới vào đầu danh sách."""
    prompts = _load()
    # Không lưu trùng prompt gần nhất
    if prompts and prompts[0].get("prompt") == prompt:
        return prompts[0]
    entry = {
        "id": int(datetime.now().timestamp() * 1000),
        "prompt": prompt,
        "style": style,
        "model": model,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    prompts.insert(0, entry)
    _save(prompts)
    return entry


def list_prompts(limit: int = 50) -> list[dict]:
    return _load()[:limit]


def delete_prompt(prompt_id: int) -> bool:
    prompts = _load()
    new_list = [p for p in prompts if p.get("id") != prompt_id]
    if len(new_list) == len(prompts):
        return False
    _save(new_list)
    return True


def clear_prompts() -> None:
    _save([])


ATTRIBUTE_PROMPT_ID = "attribute_analysis"
GENERATE_IDEA_PROMPT_ID = "generate_idea"


def get_generate_idea_prompt() -> str:
    """Lấy nội dung generate idea prompt từ prompts.json."""
    for p in _load():
        if p.get("id") == GENERATE_IDEA_PROMPT_ID:
            return p["prompt"]
    return ""


def save_generate_idea_prompt(prompt_text: str) -> None:
    """Cập nhật generate idea prompt trong prompts.json."""
    prompts = _load()
    for p in prompts:
        if p.get("id") == GENERATE_IDEA_PROMPT_ID:
            p["prompt"] = prompt_text
            _save(prompts)
            return
    prompts.insert(0, {"id": GENERATE_IDEA_PROMPT_ID, "prompt": prompt_text})
    _save(prompts)


def get_attribute_prompt() -> str:
    """Lấy nội dung attribute analysis prompt từ prompts.json."""
    for p in _load():
        if p.get("id") == ATTRIBUTE_PROMPT_ID:
            return p["prompt"]
    return ""


def save_attribute_prompt(prompt_text: str) -> None:
    """Cập nhật attribute analysis prompt trong prompts.json."""
    prompts = _load()
    for p in prompts:
        if p.get("id") == ATTRIBUTE_PROMPT_ID:
            p["prompt"] = prompt_text
            _save(prompts)
            return
    # Nếu chưa có thì thêm mới
    from datetime import datetime
    prompts.insert(0, {
        "id": ATTRIBUTE_PROMPT_ID,
        "type": "pinned",
        "prompt": prompt_text,
        "style": "",
        "model": "vision",
        "created_at": datetime.now().isoformat(timespec="seconds"),
    })
    _save(prompts)


SUGGEST_ATTRIBUTE_PROMPT_ID = "suggest_attribute"
SUGGEST_CONCEPTS_PROMPT_ID = "suggest_concepts"
BUILD_IMAGE_PROMPT_ID = "build_image_prompt"


def get_suggest_attribute_prompt() -> str:
    """Lấy nội dung suggest attribute prompt từ prompts.json."""
    for p in _load():
        if p.get("id") == SUGGEST_ATTRIBUTE_PROMPT_ID:
            return p["prompt"]
    return ""


def get_suggest_concepts_prompt() -> str:
    """Lấy nội dung suggest concepts prompt từ prompts.json."""
    for p in _load():
        if p.get("id") == SUGGEST_CONCEPTS_PROMPT_ID:
            return p["prompt"]
    return ""


def get_build_image_prompt() -> str:
    """Lấy nội dung build image prompt từ prompts.json."""
    for p in _load():
        if p.get("id") == BUILD_IMAGE_PROMPT_ID:
            return p["prompt"]
    return ""

