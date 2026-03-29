"""
Dịch vụ OpenCLIP: Tìm kiếm ảnh theo text prompt (embedding-based).
Sử dụng ViT-B-32 / laion2b_s34b_b79k - nhanh hơn Qwen2-VL (không cần generate từng ảnh).
"""
from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
from typing import List, Tuple

from PIL import Image

from history_utils import HISTORY_DIR, load_history_data

BASE_DIR = Path(__file__).resolve().parent

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_open_clip_model = None
_open_clip_preprocess = None
_open_clip_tokenizer = None
_open_clip_error: str | None = None


class OpenClipNotAvailableError(Exception):
    """Raise khi không load được OpenCLIP."""
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def get_open_clip_model():
    """Load OpenCLIP ViT-B-32 / laion2b_s34b_b79k."""
    global _open_clip_model, _open_clip_preprocess, _open_clip_tokenizer, _open_clip_error

    if _open_clip_model is not None:
        return _open_clip_model, _open_clip_preprocess, _open_clip_tokenizer

    if _open_clip_error is not None:
        raise OpenClipNotAvailableError(_open_clip_error)

    try:
        import torch
        import open_clip

        device = "cuda" if torch.cuda.is_available() else "cpu"
        print("Đang load OpenCLIP ViT-B-32 / laion2b_s34b_b79k...")

        model, _, preprocess = open_clip.create_model_and_transforms(
            model_name="ViT-B-32",
            pretrained="laion2b_s34b_b79k"
        )
        tokenizer = open_clip.get_tokenizer("ViT-B-32")

        model = model.to(device)
        model.eval()

        _open_clip_model = model
        _open_clip_preprocess = preprocess
        _open_clip_tokenizer = tokenizer

        print("✓ OpenCLIP đã load xong!")
        return _open_clip_model, _open_clip_preprocess, _open_clip_tokenizer

    except Exception as e:
        _open_clip_error = (
            f"Không load được OpenCLIP. Hãy cài đặt: pip install open-clip-torch. "
            f"Chi tiết: {e!r}"
        )
        raise OpenClipNotAvailableError(_open_clip_error)


def _download_image(url: str) -> bytes | None:
    try:
        req = Request(url, headers={"User-Agent": _USER_AGENT})
        with urlopen(req, timeout=15) as resp:
            return resp.read()
    except Exception:
        return None


def _get_open_clip_embeddings_path(history_id: str) -> Path:
    """OpenCLIP dùng file embeddings riêng (khác clip_service)."""
    return HISTORY_DIR / history_id / "open_clip_embeddings.json"


def _cosine_similarity(a, b) -> float:
    """Cosine similarity (vectors đã normalize). Chuyển về numpy để tương thích."""
    import numpy as np
    a = np.array(a, dtype=np.float32)
    b = np.array(b, dtype=np.float32)
    return float(np.dot(a, b))


def compute_and_save_open_clip_embeddings(
    history_id: str,
) -> Tuple[List[str], List]:
    """Tính và lưu image embeddings bằng OpenCLIP."""
    import torch

    info = load_history_data(history_id)
    pins = info.get("pins") or []

    model, preprocess, _ = get_open_clip_model()
    device = next(model.parameters()).device

    pin_urls = []
    embeddings = []

    for pin in pins:
        pin_url = pin.get("pin_url", "")
        image_url = (pin.get("image_url") or "").strip()
        pin_urls.append(pin_url)

        if not image_url:
            embeddings.append(None)
            continue

        raw = _download_image(image_url)
        if not raw:
            embeddings.append(None)
            continue

        try:
            img = Image.open(BytesIO(raw)).convert("RGB")
            img_tensor = preprocess(img).unsqueeze(0).to(device)
            with torch.no_grad():
                emb = model.encode_image(img_tensor)
                emb = emb / emb.norm(dim=-1, keepdim=True)
            embeddings.append(emb.cpu().numpy()[0].tolist())
        except Exception:
            embeddings.append(None)

    out_path = _get_open_clip_embeddings_path(history_id)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"pin_urls": pin_urls, "embeddings": [e for e in embeddings]}, f, ensure_ascii=False)

    return pin_urls, embeddings


def load_open_clip_embeddings(history_id: str) -> Tuple[List[str], List] | None:
    """Đọc embeddings OpenCLIP đã lưu."""
    path = _get_open_clip_embeddings_path(history_id)
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data["pin_urls"], data["embeddings"]


def search_by_prompt_open_clip(
    history_id: str,
    prompt: str,
    top_k: int = 50,
) -> List[Tuple[dict, float, str]]:
    """
    Tìm kiếm ảnh theo text prompt bằng OpenCLIP (embedding similarity).
    Trả về list (pin_dict, score, explanation) - explanation cho OpenCLIP chỉ là placeholder.
    """
    import torch

    info = load_history_data(history_id)
    pins = info.get("pins") or []

    model, preprocess, tokenizer = get_open_clip_model()
    device = next(model.parameters()).device

    # Load hoặc compute image embeddings
    loaded = load_open_clip_embeddings(history_id)
    if loaded is None or len(loaded[0]) != len(pins):
        pin_urls, embeddings = compute_and_save_open_clip_embeddings(history_id)
    else:
        pin_urls, embeddings = loaded

    # Encode text prompt
    text_tokens = tokenizer([prompt]).to(device)
    with torch.no_grad():
        text_emb = model.encode_text(text_tokens)
        text_emb = text_emb / text_emb.norm(dim=-1, keepdim=True)
    text_emb = text_emb.cpu().numpy()[0]

    # So sánh với từng ảnh
    scored: List[Tuple[int, float]] = []
    for i, emb in enumerate(embeddings):
        if emb is None:
            continue
        score = _cosine_similarity(text_emb, emb)
        # CLIP similarity thường trong [-1, 1], chuyển sang [0, 1] để hiển thị % dễ hiểu
        score_01 = (score + 1) / 2
        scored.append((i, score_01))

    scored.sort(key=lambda x: x[1], reverse=True)

    results = []
    for i, score in scored[:top_k]:
        # OpenCLIP không có explanation, dùng placeholder
        explanation = f"Độ tương đồng embedding với prompt: {score:.2f}"
        results.append((pins[i], round(float(score), 4), explanation))

    return results
