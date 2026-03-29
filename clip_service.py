"""
Dịch vụ CLIP: embed ảnh, tính embedding cho history, tìm kiếm theo ảnh upload.
Chạy trong thread (sync) để tránh block event loop.
"""
from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image

from history_utils import HISTORY_DIR, load_history_data

BASE_DIR = Path(__file__).resolve().parent

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_model = None
_clip_error: str | None = None  # Lỗi khi load torch/CLIP (DLL, v.v.)


class ClipNotAvailableError(Exception):
    """Raise khi không load được PyTorch/CLIP (vd: lỗi DLL trên Windows)."""
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def get_model():
    global _model, _clip_error
    if _model is not None:
        return _model
    if _clip_error is not None:
        raise ClipNotAvailableError(_clip_error)
    try:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("clip-ViT-B-32")
        return _model
    except (OSError, ImportError) as e:
        _clip_error = (
            "Không load được PyTorch/CLIP (thường do lỗi DLL trên Windows). "
            "Cách xử lý: (1) Chạy backend bằng Python env đã cài torch đúng "
            "(vd: conda/base env thay vì social_crawl), hoặc (2) Cài Visual C++ Redistributable. "
            f"Chi tiết: {e!r}"
        )
        raise ClipNotAvailableError(_clip_error)


def encode_image_from_bytes(data: bytes) -> list[float]:
    """Embed ảnh từ bytes (JPEG/PNG)."""
    img = Image.open(BytesIO(data)).convert("RGB")
    model = get_model()
    emb = model.encode(img, convert_to_tensor=False, normalize_embeddings=True)
    return emb.tolist()


def _download_image(url: str) -> bytes | None:
    try:
        req = Request(url, headers={"User-Agent": _USER_AGENT})
        with urlopen(req, timeout=10) as resp:
            return resp.read()
    except Exception:
        return None


def _get_embeddings_path(history_id: str) -> Path:
    return HISTORY_DIR / history_id / "embeddings.json"


def load_embeddings(history_id: str) -> tuple[list[str], list[list[float]]] | None:
    """Đọc embeddings đã lưu. Trả về (pin_urls, embeddings) hoặc None."""
    path = _get_embeddings_path(history_id)
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data["pin_urls"], data["embeddings"]


def compute_and_save_embeddings(history_id: str) -> tuple[list[str], list[list[float]]]:
    """
    Tải ảnh từ image_url của từng pin, embed bằng CLIP, lưu vào embeddings.json.
    Trả về (pin_urls, embeddings). Pin lỗi tải ảnh dùng vector 0.
    """
    info = load_history_data(history_id)
    pins = info.get("pins") or []

    model = get_model()
    dim = getattr(model, "get_sentence_embedding_dimension", lambda: None)()
    if dim is None:
        # CLIP wrapper có thể không có get_sentence_embedding_dimension; lấy dim từ encode mẫu
        dummy = Image.new("RGB", (224, 224), (0, 0, 0))
        dim = len(model.encode(dummy, convert_to_tensor=False, normalize_embeddings=True))
    pin_urls = []
    embeddings = []

    for pin in pins:
        pin_url = pin.get("pin_url", "")
        image_url = (pin.get("image_url") or "").strip()
        pin_urls.append(pin_url)

        if not image_url:
            embeddings.append([0.0] * dim)
            continue

        raw = _download_image(image_url)
        if not raw:
            embeddings.append([0.0] * dim)
            continue

        try:
            img = Image.open(BytesIO(raw)).convert("RGB")
            emb = model.encode(img, convert_to_tensor=False, normalize_embeddings=True)
            embeddings.append(emb.tolist())
        except Exception:
            embeddings.append([0.0] * dim)

    out_path = _get_embeddings_path(history_id)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"pin_urls": pin_urls, "embeddings": embeddings}, f, ensure_ascii=False)

    return pin_urls, embeddings


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Vector đã normalize thì cos = dot(a,b)."""
    return sum(x * y for x, y in zip(a, b))


def search_by_image(
    history_id: str,
    image_bytes: bytes,
    top_k: int = 100,
) -> list[tuple[dict, float]]:
    """
    So sánh ảnh upload với các pin trong history_id.
    Trả về list (pin_dict, similarity_score) xếp theo score giảm dần, tối đa top_k.
    """
    info = load_history_data(history_id)
    pins = info.get("pins") or []

    loaded = load_embeddings(history_id)
    if loaded is None or len(loaded[0]) != len(pins):
        pin_urls, embeddings = compute_and_save_embeddings(history_id)
    else:
        pin_urls, embeddings = loaded

    query_emb = encode_image_from_bytes(image_bytes)
    scored: list[tuple[int, float]] = []
    for i, emb in enumerate(embeddings):
        score = _cosine_similarity(query_emb, emb)
        scored.append((i, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    result = []
    for i, score in scored[:top_k]:
        result.append((pins[i], round(float(score), 4)))
    return result
