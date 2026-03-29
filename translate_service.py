"""
Dịch vụ dịch tiếng Việt sang tiếng Anh (opus-mt).
Dùng cho OpenCLIP - prompt tiếng Việt được dịch sang tiếng Anh để tăng độ chính xác.
"""
from __future__ import annotations

_opus_model = None
_opus_tokenizer = None
_opus_error: str | None = None


class TranslateNotAvailableError(Exception):
    """Raise khi không load được model dịch."""
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _is_vietnamese(text: str) -> bool:
    """
    Kiểm tra nhanh xem text có phải tiếng Việt không.
    Dựa trên ký tự đặc trưng: ư, ơ, ă, â, ê, ô, đ.
    """
    if not text or len(text.strip()) < 2:
        return False
    vi_chars = "ưứừửữựơờởỡợăằẳẵặâầẩẫậêềểễệôồổỗộđ"
    text_lower = text.lower()
    return any(c in text_lower for c in vi_chars)


def get_opus_model():
    """Load opus-mt vi-en model."""
    global _opus_model, _opus_tokenizer, _opus_error

    if _opus_model is not None:
        return _opus_model, _opus_tokenizer

    if _opus_error is not None:
        raise TranslateNotAvailableError(_opus_error)

    try:
        from transformers import MarianMTModel, MarianTokenizer

        print("Đang load opus-mt vi-en...")
        _opus_tokenizer = MarianTokenizer.from_pretrained("Helsinki-NLP/opus-mt-vi-en")
        _opus_model = MarianMTModel.from_pretrained("Helsinki-NLP/opus-mt-vi-en")
        print("✓ opus-mt vi-en đã load xong!")
        return _opus_model, _opus_tokenizer

    except Exception as e:
        _opus_error = (
            f"Không load được opus-mt. Hãy cài đặt: pip install transformers. "
            f"Chi tiết: {e!r}"
        )
        raise TranslateNotAvailableError(_opus_error)


def translate_vi_to_en(text: str) -> str:
    """
    Dịch tiếng Việt sang tiếng Anh.

    Args:
        text: Chuỗi tiếng Việt

    Returns:
        Chuỗi tiếng Anh đã dịch
    """
    if not text or not text.strip():
        return text

    model, tokenizer = get_opus_model()

    # MarianMT cần format đặc biệt cho batch
    inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=512)
    outputs = model.generate(**inputs, max_length=512)
    translated = tokenizer.decode(outputs[0], skip_special_tokens=True)

    return translated.strip()


def translate_prompt_for_clip(prompt: str) -> tuple[str, str | None]:
    """
    Dịch prompt nếu là tiếng Việt, để dùng với OpenCLIP.

    Args:
        prompt: Prompt người dùng nhập

    Returns:
        (prompt_to_use, translated_or_none)
        - Nếu là tiếng Việt: (bản dịch tiếng Anh, bản dịch)
        - Nếu không phải: (prompt gốc, None)
    """
    if not prompt or not prompt.strip():
        return prompt, None

    if not _is_vietnamese(prompt):
        return prompt, None

    try:
        translated = translate_vi_to_en(prompt)
        return translated, translated
    except TranslateNotAvailableError:
        # Fallback: dùng prompt gốc nếu không load được model
        return prompt, None
    except Exception:
        return prompt, None
