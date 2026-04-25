"""
Utils load/save history. Lưu pins chia thành 3 file: pinterest.json, instagram.json, tiktok.json.
Mỗi nền tảng dùng schema riêng; khi load để hiển thị/API thì normalize sang format chung.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import List
import shutil

BASE_DIR = Path(__file__).resolve().parent
# Khi chạy từ exe: lưu history cùng thư mục với exe (exe_dir/history)
HISTORY_DIR = (Path(sys.executable).parent / "history") if getattr(sys, "frozen", False) else (BASE_DIR / "history")
CRAWL_DIR = HISTORY_DIR / "crawl"
IMAGE_DIR = HISTORY_DIR / "pinterest_image"

def read_json(path: Path) -> dict:
  """Read a JSON file and return its contents."""
  with path.open("r", encoding="utf-8") as f:
    return json.load(f)


def write_json(path: Path, data) -> None:
  """Write data as JSON to a file."""
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)


def list_json_dir(directory: Path, transform=None) -> list:
  """List all .json files in a directory, sorted newest-first.
  Optionally transform each loaded dict with transform(data, path).
  """
  if not directory.exists():
    return []
  files = sorted(directory.glob("*.json"), reverse=True)
  result = []
  for path in files:
    try:
      data = read_json(path)
      result.append(transform(data, path) if transform else data)
    except Exception:
      pass
  return result


def get_history_bases(project_id: str | None = None) -> List[Path]:
    if project_id:
        return [HISTORY_DIR / "projects" / project_id / "redesign-phase" / "social_crawl"]
    return [CRAWL_DIR, IMAGE_DIR, HISTORY_DIR]



def normalize_to_display(item: dict, source: str) -> dict:
  """Chuyển item native format sang format hiển thị (pin_url, image_url, like_count, ...)."""
  if source == "pinterest":
    out = dict(item)
    out.setdefault("view_count", 0)
    # Đảm bảo có content_type: photo | video
    ct = out.get("content_type")
    if not ct:
      is_video = bool(out.get("is_video")) or bool(out.get("videos"))
      out["content_type"] = "video" if is_video else "photo"
    return out
  if source == "tiktok":
    desc = item.get("desc", "")
    return {
      "pin_url": item.get("url", ""),
      "canonical_pin_id": item.get("video_id", ""),
      "title": (desc[:100] + "...") if len(desc) > 100 else desc,
      "description": desc,
      "image_url": item.get("thumbnail_url", ""),
      "created_at": item.get("createTime", ""),
      "like_count": item.get("diggCount", 0),
      "comment_count": item.get("commentCount", 0),
      "save_count": item.get("collectCount", 0),
      "share_count": item.get("shareCount", 0),
      "view_count": int(item.get("playCount", 0) or 0),
      "reaction_count": 0,
      "repin_count": 0,
      "tracked_link": "",
      "pinner_username": item.get("author_unique_id") or item.get("author_id", ""),
      "pinner_full_name": item.get("author_nickname", ""),
      "board_name": "TikTok",
      "board_url": "",
      "link": item.get("url", ""),
      "hashtags": "",
      "source": "tiktok",
    }
  if source in ("instagram", "instagram_photo", "instagram_reels"):
    caption = item.get("caption", "")
    content_type = item.get("content_type", "photo")
    is_reel = content_type == "reel" or source == "instagram_reels"
    return {
      "pin_url": item.get("url", ""),
      "image_url": item.get("image_url", ""),
      "title": (caption[:100] + "...") if len(caption) > 100 else caption,
      "description": caption,
      "like_count": item.get("like_count", 0),
      "comment_count": item.get("comment_count", 0),
      "view_count": 0,
      "pinner_username": item.get("username", ""),
      "created_at": str(item.get("created_at", "")),
      "source": "instagram",
      "content_type": "reel" if is_reel else "photo",
      "save_count": 0,
      "share_count": 0,
      "reaction_count": 0,
      "repin_count": 0,
      "canonical_pin_id": item.get("code", ""),
      "tracked_link": "",
      "pinner_full_name": "",
      "board_name": "Instagram",
      "board_url": "",
      "link": item.get("url", ""),
      "hashtags": "",
    }
  if source == "reddit":
    title = item.get("title", "")
    desc = item.get("selftext", "") or title
    return {
      "pin_url": item.get("url", ""),
      "canonical_pin_id": item.get("id", ""),
      "title": (title[:100] + "...") if len(title) > 100 else title,
      "description": desc,
      "image_url": item.get("image_url", ""),
      "created_at": str(item.get("created_utc", "")),
      "like_count": item.get("score", 0),
      "comment_count": item.get("num_comments", 0),
      "view_count": 0,
      "save_count": 0,
      "share_count": 0,
      "reaction_count": 0,
      "repin_count": 0,
      "tracked_link": "",
      "pinner_username": item.get("author", ""),
      "pinner_full_name": "",
      "board_name": item.get("subreddit_name_prefixed") or item.get("subreddit", "Reddit"),
      "board_url": "",
      "link": item.get("url", ""),
      "hashtags": "",
      "source": "reddit",
    }
  if source == "youtube":
    title = item.get("title", "")
    desc = item.get("description", "") or title
    return {
      "pin_url": item.get("url", ""),
      "canonical_pin_id": item.get("video_id", ""),
      "title": (title[:100] + "...") if len(title) > 100 else title,
      "description": desc,
      "image_url": item.get("thumbnail_url", ""),
      "created_at": str(item.get("published_at", "")),
      "like_count": int(item.get("like_count", 0) or 0),
      "comment_count": int(item.get("comment_count", 0) or 0),
      "view_count": int(item.get("view_count", 0) or 0),
      "save_count": 0,
      "share_count": 0,
      "reaction_count": 0,
      "repin_count": 0,
      "tracked_link": "",
      "pinner_username": item.get("channel_title", ""),
      "pinner_full_name": "",
      "board_name": "YouTube",
      "board_url": "",
      "link": item.get("url", ""),
      "hashtags": "",
      "content_type": item.get("content_type", "video"),
      "source": "youtube",
    }
  return item


def _safe_keyword_for_path(keyword: str) -> str:
  cleaned = "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in keyword.strip())
  return cleaned[:60] or "keyword"


def save_history(keyword: str, pins_by_source: dict[str, List[dict]], source: str = "crawl", project_id: str | None = None) -> str:
  """
  Lưu history: info.json (meta) + pinterest.json, instagram.json, tiktok.json.
  pins_by_source: { "pinterest": [...], "instagram": [...], "tiktok": [...] }
  source: "crawl" | "pinterest_image" — quyết định subdir trong history/
  project_id: nếu có, lưu vào history/projects/{id}/redesign-phase/social_crawl/
  """
  if project_id:
    base = get_history_bases(project_id)[0]
  else:
    base = IMAGE_DIR if source == "pinterest_image" else CRAWL_DIR
  
  base.mkdir(parents=True, exist_ok=True)
  ts = datetime.now().strftime("%Y%m%d_%H%M%S")
  safe_kw = _safe_keyword_for_path(keyword)
  history_id = f"{ts}_{safe_kw}"
  folder = base / history_id
  folder.mkdir(parents=True, exist_ok=True)

  total = sum(len(arr) for arr in (pins_by_source or {}).values())

  by_src = pins_by_source or {
    "pinterest": [],
    "instagram": [],
    "tiktok": [],
    "reddit": [],
    "youtube": [],
  }
  meta = {
    "keyword": keyword,
    "created_at": datetime.now().isoformat(),
    "total": total,
    "pinterest_count": len(by_src.get("pinterest", [])),
    "instagram_count": len(by_src.get("instagram", [])),
    "tiktok_count": len(by_src.get("tiktok", [])),
    "reddit_count": len(by_src.get("reddit", [])),
    "youtube_count": len(by_src.get("youtube", [])),
  }
  with (folder / "info.json").open("w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)

  # Các file riêng theo nền tảng - lưu schema native
  for src, arr in by_src.items():
    path = folder / f"{src}.json"
    to_save = []
    for item in arr:
      copy = {k: v for k, v in item.items() if k != "source"}
      to_save.append(copy)
    with path.open("w", encoding="utf-8") as f:
      json.dump(to_save, f, ensure_ascii=False, indent=2)

  return history_id


def load_history_data(history_id: str) -> dict:
  """
  Load history. Hỗ trợ 2 format:
  - Mới: info.json (meta) + pinterest.json, instagram.json, tiktok.json (mỗi file schema riêng)
  - Cũ: info.json (meta + pins)
  Trả về pins đã normalize sang format hiển thị (pin_url, image_url, ...) cho API/clip.
  """
  # Tìm folder trong các subdir theo thứ tự ưu tiên, rồi fallback vào root (dữ liệu cũ)
  folder = None
  for _base in [CRAWL_DIR, IMAGE_DIR, HISTORY_DIR]:
    _cand = _base / history_id
    if _cand.is_dir() and (_cand / "info.json").exists():
      folder = _cand
      break
  
  # Fallback for project isolates (Redesign phase social crawls)
  if folder is None:
    for p_cand in HISTORY_DIR.glob("projects/*/redesign-phase/social_crawl/*"):
      if p_cand.name == history_id and (p_cand / "info.json").exists():
        folder = p_cand
        break

  if folder is None:
    raise FileNotFoundError(f"History not found: {history_id}")
  info_path = folder / "info.json"

  with info_path.open("r", encoding="utf-8") as f:
    data = json.load(f)

  all_sources = (
    "pinterest", "instagram",
    "instagram_photo", "instagram_reels",
    "tiktok", "reddit", "youtube",
  )
  has_source_files = any((folder / f"{s}.json").exists() for s in all_sources)

  if has_source_files:
    pins_by_source = {}
    pins = []
    for src in all_sources:
      path = folder / f"{src}.json"
      arr = []
      if path.exists():
        with path.open("r", encoding="utf-8") as f:
          arr = json.load(f)
      if arr:
        merged_key = "instagram" if src in ("instagram_photo", "instagram_reels") else src
        if merged_key not in pins_by_source:
          pins_by_source[merged_key] = []
        pins_by_source[merged_key].extend(arr)
        for item in arr:
          pins.append(normalize_to_display(item, src))
    data["pins"] = pins
    data["pins_by_source"] = pins_by_source
  else:
    pins = data.get("pins") or []
    pins_by_source = data.get("pins_by_source")
    if not pins_by_source and pins:
      pins_by_source = {}
      for p in pins:
        s = (p.get("source") or "pinterest").lower()
        if s in ("instagram_photo", "instagram_reels"):
          s = "instagram"
        if s not in pins_by_source:
          pins_by_source[s] = []
        pins_by_source[s].append(p)
    elif pins_by_source:
      merged = {}
      for k, v in pins_by_source.items():
        mk = "instagram" if k in ("instagram_photo", "instagram_reels") else k
        if mk not in merged:
          merged[mk] = []
        merged[mk].extend(v)
      pins_by_source = merged
    pins_by_source = pins_by_source or {}
    data["pins_by_source"] = pins_by_source

  return data


def delete_history(history_id: str) -> None:
  """
  Xóa hoàn toàn một history (thư mục con trong HISTORY_DIR hoặc các subdir).
  """
  folder = None
  for _base in [CRAWL_DIR, IMAGE_DIR, HISTORY_DIR]:
    _cand = _base / history_id
    if _cand.is_dir():
      folder = _cand
      break
      
  # Fallback for project isolates
  if folder is None:
    for p_cand in HISTORY_DIR.glob("projects/*/redesign-phase/social_crawl/*"):
      if p_cand.name == history_id:
        folder = p_cand
        break

  if folder is None:
    raise FileNotFoundError(f"History not found: {history_id}")
  
  # Chỉ cho phép xóa thư mục nằm hoặc trong global, hoặc trong projects/.../redesign-phase
  valid = False
  if folder.parent in (CRAWL_DIR, IMAGE_DIR, HISTORY_DIR):
      valid = True
  elif "projects" in folder.parts and "social_crawl" in folder.parts:
      valid = True
      
  if not valid:
    raise FileNotFoundError(f"History invalid path: {history_id}")
  shutil.rmtree(folder)