import json
import os
import sys
from pathlib import Path
from fastapi import APIRouter, HTTPException

from projects.db import _get_project, _update_project
from create_image_by_ai.image_generator import GEMINI_TEXT_MODEL, _get_gemini_client

router = APIRouter()

def _launch_henull_script(script_name: str, project_id: str):
    import subprocess
    project_dir = Path(__file__).resolve().parent.parent
    script_path = project_dir / "etsy_hunt" / script_name
    if not script_path.exists():
        raise HTTPException(status_code=500, detail=f"Không tìm thấy {script_name}.")
    venv_python = project_dir / "social_crawl" / "Scripts" / "python.exe"
    python_exe = str(venv_python) if venv_python.exists() else sys.executable
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    try:
        subprocess.Popen([python_exe, str(script_path), "--project-id", project_id],
                         cwd=str(project_dir), env=env)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không mở được HEnull: {e}")


@router.post("/{project_id}/original/open-henull")
async def open_henull_product(project_id: str):
    """Mở HEnull Product crawl cho Original phase."""
    _launch_henull_script("etsy_hunt_product.py", project_id)
    return {"status": "started"}


@router.post("/{project_id}/final/open-henull")
async def open_henull_keyword(project_id: str):
    """Mở HEnull Keyword crawl cho Final phase."""
    _launch_henull_script("etsy_hunt_keyword.py", project_id)
    return {"status": "started"}


@router.post("/{project_id}/original/generate-keyword")
def generate_keyword(project_id: str, body: dict):
    """Use Gemini to shorten a long title into a 2-3 word search keyword."""
    title = body.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
        
    try:
        import json
        prompt_path = Path("projects/prompt.json")
        prompt_data = json.loads(prompt_path.read_text(encoding="utf-8"))
        
        prompt_text = prompt_data.get("system_instruction", "") + "\n\n"
        for ex in prompt_data.get("examples", []):
            prompt_text += f"Input: {ex['input']}\nOutput: {ex['output']}\n\n"
        prompt_text += f"Input: {title}\nOutput:"
        
        client = _get_gemini_client()
        response = client.models.generate_content(model=GEMINI_TEXT_MODEL, contents=prompt_text)
        kw = response.text.strip().lower()
        if len(kw) > 60 or not kw:
            kw = title[:50]
        return {"keyword": kw}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini error: {e}")



@router.put("/{project_id}/original/products")
def save_original_products(project_id: str, body: dict):
    """Save selected Product DB items into the project's original phase."""
    items = body.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="No items provided")
    
    project = _get_project(project_id)
    existing = project["original"].get("etsy_products", [])
    
    existing_ids = {p.get("id") or p.get("product_id") or p.get("title") for p in existing}
    
    new_items = []
    for item in items:
        uid = item.get("id") or item.get("product_id") or item.get("title")
        if uid and uid not in existing_ids:
            new_items.append(item)
            existing_ids.add(uid)
            
    project["original"]["etsy_products"] = existing + new_items
    _update_project(project_id, project)
    return {"added": len(new_items), "total": len(project["original"]["etsy_products"])}

@router.put("/{project_id}/original/set-original")
def set_original_item(project_id: str, body: dict):
    """Save chosen social result as the project's original item."""
    item = body.get("item")
    if not item:
        raise HTTPException(status_code=400, detail="item required")
    project = _get_project(project_id)
    project["original"]["original_item"] = item
    project["original"]["status"] = "done"
    _update_project(project_id, project)
    
    try:
        from projects.telegram_notify import notify_step1_done
        image_url = item.get("image_url") or item.get("thumbnail") or item.get("image")
        notify_step1_done(
            project.get("name", "Unknown Project"), 
            image_url
        )
    except Exception as e:
        print(f"[TELEGRAM] Lỗi báo cáo Step 1: {e}")
        
    return {"ok": True}

@router.put("/{project_id}/original/social-results")
def save_original_social_results(project_id: str, body: dict):
    """Save crawled social results into the original phase."""
    results = body.get("results", [])
    project = _get_project(project_id)
    project["original"]["social_results"] = results
    if project["original"]["status"] == "crawling":
        project["original"]["status"] = "selecting"
    _update_project(project_id, project)
    return {"ok": True}

@router.put("/{project_id}/original/hunt-keywords")
def save_hunt_keywords(project_id: str, body: dict):
    """Save 2000 HEnull keywords for the original product."""
    keywords = body.get("keywords", [])
    project = _get_project(project_id)
    project["original"]["hunt_keywords"] = keywords
    _update_project(project_id, project)
    return {"total": len(keywords)}
