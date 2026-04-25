"""
AI Image Generator & Analyzer using Google Gemini API.

Features:
  - Image generation via Gemini Imagen
  - Image attribute extraction via Gemini Vision
  - Idea generation via Gemini Text
"""
import asyncio
from json_repair import repair_json
import base64
import io
import json
import os

from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential
from google.genai.errors import ServerError as _GeminiServerError

from services.ai_utils import strip_code_fence


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=2, min=5, max=30),
    retry=retry_if_exception_type(_GeminiServerError),
    reraise=True,
)
def _gemini_vision_call(client, model: str, contents: list):
    """Synchronous Gemini vision call with exponential backoff retry (5 attempts, 5–30s waits)."""
    return client.models.generate_content(model=model, contents=contents)


def _get_gemini_client():
    """Tạo Gemini client từ biến môi trường GEMINI_API_KEY."""
    from google import genai
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY chưa được cấu hình trong file .env")
    return genai.Client(api_key=api_key)


# ── Core Image Generator (Gemini Imagen) ──────────────────────────────────────

GEMINI_IMAGE_MODEL = "imagen-3.0-generate-002"


async def generate_images(
    prompt: str,
    model: str = "imagen-3.0-generate-002",
    num_images: int = 1,
) -> list[str]:
    """
    Tạo num_images ảnh bằng Gemini Imagen, trả về list base64 data URLs.
    """
    from google.genai import types

    client = _get_gemini_client()
    num_images = max(1, min(num_images, 4))  # giới hạn 1-4

    print(f"[generate_images] model={model}, num={num_images}, prompt={prompt[:80]}")

    response = await asyncio.to_thread(
        client.models.generate_images,
        model=model,
        prompt=prompt,
        config=types.GenerateImagesConfig(
            number_of_images=num_images,
        ),
    )

    images: list[str] = []
    if response.generated_images:
        for img in response.generated_images:
            b64 = base64.b64encode(img.image.image_bytes).decode()
            images.append(f"data:image/png;base64,{b64}")

    if not images:
        raise RuntimeError("Gemini Imagen không tạo được ảnh nào. Thử thay đổi prompt.")

    print(f"[generate_images] Tạo thành công {len(images)} ảnh")
    return images


# ── Image Attribute Extraction (Gemini Vision) ───────────────────────────────

GEMINI_VISION_MODEL = "gemini-2.5-flash"


def _b64_to_pil(data_url: str):
    """Chuyển base64 data URL hoặc raw base64 sang PIL Image."""
    from PIL import Image as PILImage
    if "," in data_url:
        _, raw = data_url.split(",", 1)
    else:
        raw = data_url
    img_bytes = base64.b64decode(raw)
    return PILImage.open(io.BytesIO(img_bytes)).convert("RGB")


async def get_image_attributes(images_b64: list[str], image_names: list[str] = None, description: str = "") -> list[dict]:
    """
    Gọi Gemini vision LLM với attribute analysis prompt + danh sách ảnh.
    images_b64: list các data URL (data:image/...;base64,...) hoặc raw base64.
    image_names: list tên file ảnh (optional). Nếu có, dùng làm header cột.
    Trả về list[dict] với các key: attribute, vi, values (dict image_name -> value).
    """
    from create_image_by_ai.prompt_store import get_attribute_prompt

    client = _get_gemini_client()

    system_prompt = get_attribute_prompt()
    if not system_prompt:
        raise RuntimeError("Chưa có attribute analysis prompt trong prompts/attribute_analysis.md.")

    # image_names phải là tên file thực tế, nếu thiếu thì báo lỗi
    if not image_names or len(image_names) != len(images_b64):
        raise ValueError("Thiếu tên file ảnh hoặc số lượng không khớp với số ảnh upload.")

    print(f"[get_image_attributes] model={GEMINI_VISION_MODEL}, số ảnh={len(images_b64)}")
    print(f"[get_image_attributes] image names: {image_names}")

    # Dùng tên ngắn khi gửi Gemini để tránh lỗi JSON key với tên dài/đặc biệt
    # Sau đó remap kết quả về tên thật
    gemini_names = ["main image"] + [f"crawl image {i}" for i in range(1, len(image_names))]
    name_map = {g: r for g, r in zip(gemini_names, image_names)}  # gemini_name -> real_name

    # Chuyển tất cả ảnh sang PIL Image
    pil_images = [_b64_to_pil(url) for url in images_b64]

    # Gemini hỗ trợ nhiều ảnh trực tiếp, gửi từng ảnh kèm nhãn ngắn
    contents = []
    for i, img in enumerate(pil_images):
        contents.append(f"[{gemini_names[i]}]")
        contents.append(img)
    if description:
        contents.append(f"[User description]: {description}")
    contents.append(system_prompt)

    print(f"[get_image_attributes] Calling Gemini model={GEMINI_VISION_MODEL} (with retry)")
    response = await asyncio.to_thread(_gemini_vision_call, client, GEMINI_VISION_MODEL, contents)
    print(f"[get_image_attributes] Gemini response OK")
    raw = response.text.strip()

    raw = strip_code_fence(raw)

    # Extract the JSON array portion (from first '[' to last ']')
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        raw = raw[start:end + 1]

    try:
        rows: list[dict] = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[get_image_attributes] JSON parse error: {e}")
        print(f"[get_image_attributes] Raw response (first 500 chars):\n{raw[:500]}")
        # Thử auto-repair JSON bị lỗi (ví dụ: Gemini thiếu dấu } đóng object)
        print(f"[get_image_attributes] Attempting json_repair...")
        try:
            repaired = repair_json(raw)
            rows: list[dict] = json.loads(repaired)
            print(f"[get_image_attributes] json_repair thành công, parse được {len(rows)} rows")
        except Exception as repair_err:
            raise RuntimeError(f"Gemini trả về JSON không hợp lệ: {e}. Thử lại để Gemini format lại.")

    # Remap gemini short names → real display names
    def _remap_keys(d: dict) -> dict:
        result = {}
        for k, v in d.items():
            real_key = name_map.get(k, k)  # fallback to original if not found
            result[real_key] = v
        return result

    for row in rows:
        if not isinstance(row.get("values"), dict):
            row["values"] = {}
        row["values"] = _remap_keys(row["values"])
        if not isinstance(row.get("vi_values"), dict):
            row["vi_values"] = {}
        row["vi_values"] = _remap_keys(row["vi_values"])

    return rows


# ── Build Image Prompt from Table ───────────────────────────────────────────────

GEMINI_TEXT_MODEL = "gemini-2.5-flash"


async def build_image_prompt(rows: list, image_names: list = None) -> list[str]:
    """
    Sinh danh sách prompt từ bảng thuộc tính JSON.
    rows: list[dict] — attribute rows từ frontend.
    image_names: list[str] — tên các cột ảnh nguồn.
    """
    from create_image_by_ai.prompt_store import get_build_image_prompt

    client = _get_gemini_client()

    template = get_build_image_prompt()
    if not template:
        raise RuntimeError("Chưa có build_image_prompt trong prompts/build_image_prompt.md.")

    # Inject the serialised attribute table into the {final_attribute_table} placeholder
    table_str = json.dumps(rows, ensure_ascii=False, indent=2)
    final_prompt = template.replace("{final_attribute_table}", table_str)

    # Replace generic image-name placeholders with the actual uploaded file names
    source_headers = image_names or []
    if source_headers:
        first_img  = source_headers[0]
        second_img = source_headers[1] if len(source_headers) > 1 else "crawl image"
        third_img  = source_headers[2] if len(source_headers) > 2 else "crawl image"

        print(f"[build_image_prompt] image_names: {source_headers}")

        final_prompt = (final_prompt
            .replace("(Main)",          f"({first_img})")
            .replace("Main Image",      first_img)
            .replace("(crawl image 1)", f"({second_img})")
            .replace("crawl image 1",   second_img)
            .replace("(crawl image 2)", f"({third_img})")
            .replace("crawl image 2",   third_img)
        )

        print(f"[build_image_prompt] Replaced placeholders: {first_img}, {second_img}, {third_img}")

    print(f"[build_image_prompt] Gọi Gemini Text, prompt length={len(final_prompt)}")

    response = await asyncio.to_thread(
        client.models.generate_content,
        model=GEMINI_TEXT_MODEL,
        contents=final_prompt,
    )

    text = response.text.strip()
    
    text = strip_code_fence(text)
    
    prompts = []
    try:
        parsed_data = json.loads(text)
        if isinstance(parsed_data, list):
            prompts = [str(p) for p in parsed_data]
        elif isinstance(parsed_data, str):
            prompts = [parsed_data]
    except json.JSONDecodeError:
        print("[build_image_prompt] Không parse được JSON, fallback về dạng string đơn.")
        prompts = [text]

    print(f"[build_image_prompt] Đã tạo thành công {len(prompts)} prompt nhánh.")
    return prompts



