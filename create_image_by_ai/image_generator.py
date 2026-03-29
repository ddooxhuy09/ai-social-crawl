"""
AI Image Generator & Analyzer using Google Gemini API.

Features:
  - Image generation via Gemini Imagen
  - Image attribute extraction via Gemini Vision
  - Idea generation via Gemini Text
"""
import asyncio
import base64
import io
import json
import os
from pathlib import Path


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


async def get_image_attributes(images_b64: list[str], image_names: list[str] = None, description: str = "") -> str:
    """
    Gọi Gemini vision LLM với attribute analysis prompt + danh sách ảnh.
    images_b64: list các data URL (data:image/...;base64,...) hoặc raw base64.
    image_names: list tên file ảnh (optional). Nếu có, dùng làm header cột.
    """
    from create_image_by_ai.prompt_store import get_attribute_prompt

    client = _get_gemini_client()

    system_prompt = get_attribute_prompt()
    if not system_prompt:
        raise RuntimeError("Chưa có attribute analysis prompt trong prompts.json.")

    # Convert to string if it's a dict (since prompts.json now contains JSON objects)
    if isinstance(system_prompt, dict):
        system_prompt = json.dumps(system_prompt, ensure_ascii=False)

    # image_names phải là tên file thực tế, nếu thiếu thì báo lỗi
    if not image_names or len(image_names) != len(images_b64):
        raise ValueError("Thiếu tên file ảnh hoặc số lượng không khớp với số ảnh upload.")

    print(f"[get_image_attributes] model={GEMINI_VISION_MODEL}, số ảnh={len(images_b64)}")
    print(f"[get_image_attributes] image names: {image_names}")

    # Replace placeholder trong prompt bằng tên file thực tế
    if image_names and len(image_names) > 0:
        # Thay "main image" = image_names[0]
        system_prompt = system_prompt.replace("main image", image_names[0])
        # Thay "crawl image 1", "crawl image 2", ...
        for i in range(1, len(image_names)):
            placeholder = f"crawl image {i}"
            system_prompt = system_prompt.replace(placeholder, image_names[i])
        # Thay "..." cuối cùng nếu có nhiều hơn 3 ảnh
        if len(image_names) > 3:
            remaining = ", ".join(image_names[3:])
            system_prompt = system_prompt.replace("...", remaining)

    # Chuyển tất cả ảnh sang PIL Image
    pil_images = [_b64_to_pil(url) for url in images_b64]

    # Gemini hỗ trợ nhiều ảnh trực tiếp, gửi từng ảnh kèm nhãn (tên file)
    contents = []
    for i, img in enumerate(pil_images):
        label = image_names[i] if i < len(image_names) else f"image {i+1}"
        contents.append(f"[{label}]")
        contents.append(img)
    if description:
        contents.append(f"[User description]: {description}")
    contents.append(system_prompt)

    print(f"[get_image_attributes] Calling Gemini model={GEMINI_VISION_MODEL}")
    response = await asyncio.to_thread(
        client.models.generate_content,
        model=GEMINI_VISION_MODEL,
        contents=contents,
    )
    print(f"[get_image_attributes] Gemini response OK")
    result = response.text
    # Post-process: replace generic placeholders the AI may have kept
    result = result.replace("main image", image_names[0])
    for i in range(1, len(image_names)):
        result = result.replace(f"crawl image {i}", image_names[i])
    return result


# ── Generate Idea (Gemini Text) ───────────────────────────────────────────────

GEMINI_TEXT_MODEL = "gemini-2.5-flash"


async def generate_idea(attribute_table: str, description: str = "") -> str:
    """
    Gọi Gemini text LLM với generate idea prompt + attribute table đã điền.
    attribute_table: markdown table string từ frontend.
    """
    from create_image_by_ai.prompt_store import get_generate_idea_prompt

    client = _get_gemini_client()

    template = get_generate_idea_prompt()
    if not template:
        raise RuntimeError("Chưa có generate idea prompt trong prompts.json.")

    # Convert to string if it's a dict
    if isinstance(template, dict):
        template = json.dumps(template, ensure_ascii=False)

    # Thay {attribute_table} và {description} bằng nội dung thực tế
    final_prompt = template.replace("{attribute_table}", attribute_table)
    final_prompt = final_prompt.replace("{description}", description or "N/A")
    print(f"[generate_idea] model={GEMINI_TEXT_MODEL}, prompt length={len(final_prompt)}")

    response = await asyncio.to_thread(
        client.models.generate_content,
        model=GEMINI_TEXT_MODEL,
        contents=final_prompt,
    )
    print(f"[generate_idea] Gemini response OK")
    return response.text


# ── AI Micro-suggestion (per attribute) ───────────────────────────────────────


async def suggest_attribute(attribute_name: str, current_values: list[str], full_table: str) -> list[str]:
    """
    Gợi ý 4 giá trị sáng tạo cho một thuộc tính cụ thể.
    Sử dụng prompt template từ prompts.json.
    """
    from create_image_by_ai.prompt_store import get_suggest_attribute_prompt

    client = _get_gemini_client()

    template = get_suggest_attribute_prompt()
    if not template:
        raise RuntimeError("Chưa có suggest_attribute prompt trong prompts.json.")

    # Convert to string if it's a dict
    if isinstance(template, dict):
        template = json.dumps(template, ensure_ascii=False)

    # Fill placeholders
    current_value_str = ', '.join(current_values) if current_values else 'Chưa có'
    prompt = template.replace("{target_attribute}", attribute_name)
    prompt = prompt.replace("{current_value}", current_value_str)
    prompt = prompt.replace("{main_product_description}", full_table)

    print(f"[suggest_attribute] attr={attribute_name}, model={GEMINI_TEXT_MODEL}")

    response = await asyncio.to_thread(
        client.models.generate_content,
        model=GEMINI_TEXT_MODEL,
        contents=prompt,
    )

    text = response.text.strip()
    # Parse JSON from response
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        suggestions = json.loads(text)
        if isinstance(suggestions, list):
            return [str(s) for s in suggestions[:4]]
    except json.JSONDecodeError:
        pass
    # Fallback: split by newlines
    lines = [l.strip().strip("-").strip("•").strip() for l in text.split("\n") if l.strip()]
    return lines[:4] if lines else ["Gợi ý 1", "Gợi ý 2", "Gợi ý 3", "Gợi ý 4"]


# ── AI Macro-suggestion (Concepts) ────────────────────────────────────────────


async def suggest_concepts(attribute_table: str) -> list[dict]:
    """
    Sinh 3 concept thiết kế tổng thể dựa trên bảng thuộc tính.
    Sử dụng prompt template từ prompts.json.
    Trả về list of dicts: [{ name, description, changes: {key: value} }]
    """
    from create_image_by_ai.prompt_store import get_suggest_concepts_prompt

    client = _get_gemini_client()

    template = get_suggest_concepts_prompt()
    if not template:
        raise RuntimeError("Chưa có suggest_concepts prompt trong prompts.json.")

    # Convert to string if it's a dict
    if isinstance(template, dict):
        template = json.dumps(template, ensure_ascii=False)

    # Fill placeholders
    prompt = template.replace("{current_attributes_table}", attribute_table)
    prompt = prompt.replace("{main_product_description}", attribute_table)
    prompt = prompt.replace("{target_concept}", "")

    # Wrap with instruction to generate 3 diverse concepts
    final_prompt = f"""{prompt}

ADDITIONAL INSTRUCTION: Based on the attribute table above, generate exactly 3 diverse design concepts. Each concept should have:
- "name": a catchy theme name
- "description": one sentence description
- "changes": a dict of attribute key-value pairs to modify

Return ONLY a valid JSON array. Example:
[
  {{"name": "Theme Name", "description": "Short description", "changes": {{"Attribute1": "New Value", "Attribute2": "New Value"}} }}
]"""

    print(f"[suggest_concepts] model={GEMINI_TEXT_MODEL}")

    response = await asyncio.to_thread(
        client.models.generate_content,
        model=GEMINI_TEXT_MODEL,
        contents=final_prompt,
    )

    text = response.text.strip()
    # Parse JSON from response
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        concepts = json.loads(text)
        if isinstance(concepts, list):
            # Normalize: convert attribute/value format to name/description/changes format if needed
            if concepts and "attribute" in concepts[0] and "name" not in concepts[0]:
                # Response is in attribute/value format, wrap into a single concept
                changes = {c["attribute"]: c["value"] for c in concepts}
                return [{"name": "Concept AI", "description": "AI gợi ý thay đổi", "changes": changes}]
            return concepts[:3]
    except json.JSONDecodeError:
        pass
    # Fallback
    return [{"name": "Concept 1", "description": "AI không trả về đúng format", "changes": {}}]


# ── Build Image Prompt from Table ───────────────────────────────────────────────


async def build_image_prompt(attribute_table: str) -> list[str]:
    """
    Sinh danh sách prompt từ bảng thuộc tính.
    Nếu có mâu thuẫn, LLM sẽ trả về 2 prompts khác nhau (A/B testing).
    Trả về list of strings.
    """
    from create_image_by_ai.prompt_store import get_build_image_prompt

    client = _get_gemini_client()

    template = get_build_image_prompt()
    if not template:
        raise RuntimeError("Chưa có build_image_prompt trong prompts.json.")

    # Parse template dict và fill placeholder
    if isinstance(template, dict):
        role = template.get("role", "")
        task = template.get("task", "")
        instructions = template.get("instructions", [])
        input_data = template.get("input_data", {})
        
        # Fill placeholder trong input_data
        for key, value in input_data.items():
            if isinstance(value, str):
                input_data[key] = value.replace("{final_attribute_table}", attribute_table)
        
        # Extract image names from table headers and replace placeholders
        lines = attribute_table.strip().split("\n")
        if lines:
            header_line = lines[0]
            # Parse headers - support both | and tab separated
            if "|" in header_line:
                parts = [p.strip() for p in header_line.split("|")[1:-1]]
            else:
                parts = [p.strip() for p in header_line.split("\t") if p.strip()]
            
            # Filter out non-image columns
            source_headers = []
            for p in parts:
                if p and "THIẾT KẾ MỚI" not in p and "Attribute" not in p and "Thuộc tính" not in p:
                    source_headers.append(p)
            
            print(f"[build_image_prompt] Source headers extracted: {source_headers}")
            
            if source_headers and len(source_headers) > 0:
                first_img = source_headers[0]
                second_img = source_headers[1] if len(source_headers) > 1 else "crawl image"
                third_img = source_headers[2] if len(source_headers) > 2 else "crawl image"
                
                # Replace all variations in instructions
                for idx, inst in enumerate(instructions):
                    inst = inst.replace("(Main)", f"({first_img})")
                    inst = inst.replace("Main Image", first_img)
                    inst = inst.replace("(crawl image 1)", f"({second_img})")
                    inst = inst.replace("crawl image 1", second_img)
                    inst = inst.replace("(crawl image 2)", f"({third_img})")
                    inst = inst.replace("crawl image 2", third_img)
                    instructions[idx] = inst
                
                print(f"[build_image_prompt] Replaced placeholders: {first_img}, {second_img}, {third_img}")
        
        # Build prompt với yêu cầu trả về JSON array
        prompt_parts = [
            f"You are {role}.",
            f"{task}",
            "",
            "Input Data:",
            json.dumps(input_data, ensure_ascii=False),
            "",
            "Instructions:"
        ]
        prompt_parts.extend([f"{i+1}. {inst}" for i, inst in enumerate(instructions)])
        
        prompt_parts.extend([
            "",
            "IMPORTANT: Return ONLY a valid JSON array of strings. Example:",
            '["Prompt A description", "Prompt B description"]',
            "Do NOT add any other text, comments, or markdown formatting outside the array."
        ])
        
        final_prompt = "\n".join(prompt_parts)
    else:
        final_prompt = template.replace("{final_attribute_table}", attribute_table)

    print(f"[build_image_prompt] Gọi Gemini Text, prompt length={len(final_prompt)}")

    response = await asyncio.to_thread(
        client.models.generate_content,
        model=GEMINI_TEXT_MODEL,
        contents=final_prompt,
    )

    text = response.text.strip()
    
    # Bóc tách JSON an toàn
    if text.startswith("```json"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    elif text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    
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

