"""
Lưu và quản lý lịch sử prompt tạo ảnh AI.
System prompts (attribute_analysis, build_image_prompt, generate_idea) are stored
as Markdown files in prompts/. User prompt history is stored in prompts.json.
"""
import json
from datetime import datetime
from pathlib import Path

PROMPTS_PATH = Path(__file__).parent / "prompts.json"
PROMPTS_DIR  = Path(__file__).parent / "prompts"


# ── User prompt history (prompts.json) ────────────────────────────────────────

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


# ── System prompts (Markdown files) ───────────────────────────────────────────

def _read_md(name: str) -> str:
    """Read a system prompt from prompts/{name}.md. Returns empty string if missing."""
    path = PROMPTS_DIR / f"{name}.md"
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _write_md(name: str, text: str) -> None:
    """Overwrite prompts/{name}.md with *text*."""
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    (PROMPTS_DIR / f"{name}.md").write_text(text, encoding="utf-8")


def get_attribute_prompt() -> str:
    """Return the attribute analysis system prompt from prompts/attribute_analysis.md."""
    return _read_md("attribute_analysis")


def save_attribute_prompt(prompt_text: str) -> None:
    """Overwrite prompts/attribute_analysis.md with *prompt_text*."""
    _write_md("attribute_analysis", prompt_text)


def get_build_image_prompt() -> str:
    """Return the build-image system prompt from prompts/build_image_prompt.md."""
    return _read_md("build_image_prompt")


def get_generate_idea_prompt() -> str:
    """Return the generate-idea system prompt from prompts/generate_idea.md."""
    return _read_md("generate_idea")
