import os
import threading

from translate_chart.paths import _BASE
from translate_chart.projects import project_dir, read_meta, write_meta
from services.ai_utils import now_iso

_ocr_lock = threading.Lock()

OCR_MARKDOWN_PROMPT = """Please convert the content of this document image into clean Markdown format.

Rules:
- Titles and headings: use appropriate Markdown heading levels (# ## ###)
- Body text: plain paragraphs
- Lists: use - or 1. syntax
- Tables: use Markdown table syntax
- Formulas: wrap in LaTeX ($...$ for inline, $$...$$ for block)
- Images/diagrams: insert a placeholder ![image](image) with a brief description
- Page headers/footers: skip them
- Preserve original text exactly, no translation
- Output only the Markdown content, no extra explanation"""


def run_ocr(project_id: str, pdf_bytes: bytes) -> None:
    import tempfile

    import torch
    import pypdfium2 as pdfium
    from qwen_vl_utils import process_vision_info
    from transformers import AutoModelForCausalLM, AutoProcessor, BitsAndBytesConfig

    meta = read_meta(project_id) or {}
    try:
        model_env = os.environ.get("DOTS_MOCR_MODEL")
        model_path = _BASE / "dots_mocr" if not model_env else __import__("pathlib").Path(model_env)
        if not model_path.exists():
            raise FileNotFoundError(f"dots_mocr model not found at {model_path}")

        pdf_dpi       = int(os.environ.get("PDF_DPI", "150"))
        pdf_max_pages = int(os.environ.get("PDF_MAX_PAGES", "0"))
        max_new_tokens = int(os.environ.get("MAX_NEW_TOKENS", "2048"))
        image_max_pixels = int(os.environ.get("IMAGE_MAX_PIXELS", str(640 * 640)))

        with _ocr_lock:
            processor = AutoProcessor.from_pretrained(
                str(model_path), trust_remote_code=True, local_files_only=True
            )
            quant_cfg = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
            )
            model = AutoModelForCausalLM.from_pretrained(
                str(model_path),
                device_map="auto",
                quantization_config=quant_cfg,
                trust_remote_code=True,
                local_files_only=True,
            )

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(pdf_bytes)
            tmp_path = f.name

        try:
            pdf = pdfium.PdfDocument(tmp_path)
            page_count = min(len(pdf), pdf_max_pages) if pdf_max_pages > 0 else len(pdf)
            scale = pdf_dpi / 72
            images = [pdf[i].render(scale=scale).to_pil().convert("RGB") for i in range(page_count)]
            pdf.close()
        finally:
            os.unlink(tmp_path)

        full_result = ""
        for img in images:
            messages = [{
                "role": "user",
                "content": [
                    {"type": "image", "image": img, "max_pixels": image_max_pixels},
                    {"type": "text", "text": OCR_MARKDOWN_PROMPT},
                ],
            }]
            text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            img_inputs, vid_inputs = process_vision_info(messages)
            inputs = processor(
                text=[text], images=img_inputs, videos=vid_inputs,
                padding=True, return_tensors="pt",
            ).to(model.device, dtype=torch.float16)

            with torch.no_grad():
                generated_ids = model.generate(**inputs, max_new_tokens=max_new_tokens, use_cache=True)

            trimmed = [out[len(inp):] for inp, out in zip(inputs.input_ids, generated_ids)]
            page_text = processor.batch_decode(
                trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
            )[0]
            full_result += f"{page_text}\n\n---\n\n"

            del inputs, generated_ids
            torch.cuda.empty_cache()

        (project_dir(project_id) / "input.md").write_text(full_result, encoding="utf-8")
        meta.update({"ocr_status": "ready", "ocr_error": None, "updated_at": now_iso()})

    except Exception as e:
        meta.update({"ocr_status": "error", "ocr_error": str(e), "updated_at": now_iso()})

    write_meta(project_id, meta)
