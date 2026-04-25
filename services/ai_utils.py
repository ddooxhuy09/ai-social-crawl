"""
Shared AI utilities — used across etsy_listing, etsy_hunt, product_requirements,
create_image_by_ai, and projects.
"""
import asyncio
import json
import random
import re
import threading
import time
from datetime import datetime

from fastapi import HTTPException


# ── Timestamp ─────────────────────────────────────────────────────────────────

def now_iso() -> str:
    """Return the current datetime as an ISO-8601 string (seconds precision)."""
    return datetime.now().isoformat(timespec="seconds")


# ── Slug ──────────────────────────────────────────────────────────────────────

def slugify(name: str, fallback: str = "item") -> str:
    """Convert *name* to a URL / filename-safe slug."""
    name = re.sub(r"[^\w\s-]", "", (name or "").strip())
    name = re.sub(r"[\s_]+", "-", name)
    name = re.sub(r"-{2,}", "-", name)
    return name.strip("-").lower() or fallback


# ── Code fence stripping ──────────────────────────────────────────────────────

def strip_code_fence(text: str) -> str:
    """Remove leading ```json or ``` fences (and trailing ```) from LLM output."""
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        return cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    if cleaned.startswith("```"):
        return cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return cleaned


# ── JSON parsing ──────────────────────────────────────────────────────────────

def parse_llm_json(raw: str):
    """Strip markdown fences and extract the first JSON object or array."""
    raw = re.sub(r"```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"```\s*$", "", raw).strip()
    m = re.search(r"(\{.*\}|\[.*\])", raw, re.DOTALL)
    if not m:
        raise ValueError(f"No JSON found in LLM response: {raw[:200]}")
    return json.loads(m.group(1))


# ── HTTP error mapper ─────────────────────────────────────────────────────────

def raise_for_ai_error(e: Exception, context: str = "AI") -> None:
    """Re-raise Gemini errors with the right HTTP status code."""
    err_str = str(e)
    if "503" in err_str or "UNAVAILABLE" in err_str or "high demand" in err_str.lower():
        raise HTTPException(
            status_code=503,
            detail="Gemini is currently overloaded. Please wait a moment and try again.",
        ) from e
    raise HTTPException(status_code=502, detail=f"{context}: {err_str}") from e


# ── Gemini retry helpers ──────────────────────────────────────────────────────

_SYNC_SEM = threading.Semaphore(2)

_async_sem: asyncio.Semaphore | None = None
_async_sem_lock = threading.Lock()


def _get_async_sem() -> asyncio.Semaphore:
    global _async_sem
    with _async_sem_lock:
        if _async_sem is None:
            _async_sem = asyncio.Semaphore(2)
    return _async_sem


def _backoff_delay(attempt: int, suggested_s: float | None) -> float:
    if suggested_s is not None:
        return suggested_s + random.uniform(0, 2)
    base = min(2.0 * (2 ** attempt), 120.0)
    return base + random.uniform(0, base * 0.2)


def _is_retryable(msg: str) -> bool:
    return any(k in msg for k in ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"))


def _parse_suggested_delay(msg: str) -> float | None:
    m = re.search(r"retry in (\d+(?:\.\d+)?)\s*s", msg, re.IGNORECASE)
    return float(m.group(1)) if m else None


def gemini_call_with_retry(fn, *args, max_retries: int = 5, **kwargs):
    """Synchronous Gemini call with exponential backoff. Uses a Semaphore(2) concurrency guard."""
    with _SYNC_SEM:
        for attempt in range(max_retries):
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                msg = str(e)
                if attempt < max_retries - 1 and _is_retryable(msg):
                    delay = _backoff_delay(attempt, _parse_suggested_delay(msg))
                    print(f"[gemini retry] attempt {attempt+1}/{max_retries}, sleeping {delay:.1f}s — {msg[:80]}")
                    time.sleep(delay)
                else:
                    raise


async def gemini_call_with_retry_async(fn, *args, max_retries: int = 5, **kwargs):
    """Async Gemini call with exponential backoff. Uses an async Semaphore(2) concurrency guard."""
    sem = _get_async_sem()
    async with sem:
        for attempt in range(max_retries):
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                msg = str(e)
                if attempt < max_retries - 1 and _is_retryable(msg):
                    delay = _backoff_delay(attempt, _parse_suggested_delay(msg))
                    print(f"[gemini retry async] attempt {attempt+1}/{max_retries}, sleeping {delay:.1f}s")
                    await asyncio.sleep(delay)
                else:
                    raise
