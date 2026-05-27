"""
translate_chart/translate.py — prompt-based translation with terminology enforcement.

Pipeline per translate_one() call:
  1. Convert terminology dict -> term table
  2. Parse ABBREVIATIONS section -> matched terms + raw abbr map
  3. Scan body text -> additional matched terms
  4. Build prompt with filtered term table + rules
  5. Call gemini-2.5-pro (temperature 0.1)
  6. Validate: check every expected target term appears in output
  7. If violations -> one fix pass (max 1 retry)
  8. Return translated text
"""

import logging
import re

from google.genai import types as genai_types

from history_utils import read_json
from translate_chart.paths import TERMINOLOGY_PATH
from create_image_by_ai.image_generator import _get_gemini_client
from services.ai_utils import gemini_call_with_retry

log = logging.getLogger(__name__)

TRANSLATION_MODEL = "gemini-2.5-flash"

SUPPORTED_LANGS: dict[str, str] = {
    "en_uk": "English (UK)",
    "fr": "French",
    "de": "German",
    "es": "Spanish (European)",
}


# ── Terminology loading ───────────────────────────────────────────────────────

def load_terminology() -> dict:
    return read_json(TERMINOLOGY_PATH) if TERMINOLOGY_PATH.exists() else {}


# ── Convert terminology.json → term table ─────────────────────────────────────

def _terminology_to_term_table(terminology: dict) -> list[dict]:
    """
    Convert the terminology.json structure into a flat list of term entries.

    Each entry: { "search": [str, ...], "en_uk": str, "fr": str, "de": str, "es": str }
      - search  : en_us full name + all en_us abbr values (longest first)
      - per lang: abbr[0] if the abbr list is non-empty, else full name
    """
    table = []
    for _, langs in terminology.items():
        en = langs.get("en_us", {})
        search: list[str] = []
        if en.get("full"):
            search.append(en["full"])
        search.extend(en.get("abbr", []))
        search.extend(en.get("abbr_plural", []))
        search = [s for s in search if s]
        if not search:
            continue

        entry: dict = {"search": search}
        for lang in SUPPORTED_LANGS:
            lang_data = langs.get(lang, {})
            abbrevs = [a for a in lang_data.get("abbr", []) if a]
            entry[lang] = abbrevs[0] if abbrevs else (lang_data.get("full") or "")

        # Skip entries where all target lang values are empty
        if any(entry.get(lang) for lang in SUPPORTED_LANGS):
            table.append(entry)

    # Longest search term first — prevents partial-match shadowing
    table.sort(key=lambda e: max(len(s) for s in e["search"]), reverse=True)
    return table


# ── Step 1: Parse ABBREVIATIONS section ──────────────────────────────────────

def _parse_abbreviations(
    source: str,
    term_table: list[dict],
) -> tuple[list[dict], dict[str, str]]:
    """
    Extract the **ABBREVIATIONS** block and match each declared entry against
    the term table.

    Returns:
        matched_terms  — term table entries whose en_us form appears in ABBREVIATIONS
        raw_abbr_map   — {abbr_code: description}  e.g. {"ch": "chain stitch"}
    """
    block_match = re.search(
        r"\*\*ABBREVIATIONS\*\*\s*(.*?)(?=\n---|\Z)",
        source,
        re.DOTALL | re.IGNORECASE,
    )
    if not block_match:
        return [], {}

    raw_abbr_map: dict[str, str] = {}
    for line in block_match.group(1).splitlines():
        m = re.match(r"[-*]\s*([^:]+):\s*(.+)", line.strip())
        if m:
            raw_abbr_map[m.group(1).strip()] = m.group(2).strip().lower()

    matched: list[dict] = []
    seen: set[int] = set()
    for entry in term_table:
        if id(entry) in seen:
            continue
        for search_term in entry["search"]:
            pattern = r"(?<![A-Za-z])" + re.escape(search_term.lower()) + r"(?![A-Za-z])"
            for desc in raw_abbr_map.values():
                if re.search(pattern, desc):
                    matched.append(entry)
                    seen.add(id(entry))
                    break
            if id(entry) in seen:
                break

    return matched, raw_abbr_map


# ── Step 2: Scan body text for remaining terms ────────────────────────────────

def _scan_body_terms(
    source: str,
    term_table: list[dict],
    already_matched: list[dict],
) -> list[dict]:
    """
    Find term table entries that appear in the source text but were NOT already
    declared in the ABBREVIATIONS section.
    """
    already_ids = {id(e) for e in already_matched}
    extra: list[dict] = []
    for entry in term_table:
        if id(entry) in already_ids:
            continue
        for search_term in entry["search"]:
            pattern = r"(?<![A-Za-z])" + re.escape(search_term) + r"(?![A-Za-z])"
            if re.search(pattern, source, re.IGNORECASE):
                extra.append(entry)
                break
    return extra


# ── Step 3: Build prompt ──────────────────────────────────────────────────────

def _build_prompt(
    source: str,
    lang: str,
    all_terms: list[dict],
    raw_abbr_map: dict[str, str],
) -> str:
    lang_name = SUPPORTED_LANGS[lang]

    term_rows = "\n".join(
        f"  - {', '.join(e['search'][:2])}: {e[lang]}"
        for e in all_terms
        if e.get(lang)
    )

    abbr_codes = ", ".join(raw_abbr_map.keys()) if raw_abbr_map else "none"

    return (
        f"You are a professional translator specializing in crochet patterns.\n"
        f"Translate the Markdown document below into {lang_name}.\n\n"
        f"## MANDATORY TERMINOLOGY\n"
        f"You MUST use these exact translations — no alternatives, no paraphrasing:\n"
        f"{term_rows}\n\n"
        f"## RULES\n"
        f"1. Preserve ALL Markdown formatting exactly: headings, bold (**), italics, lists, tables, HTML tags, code blocks.\n"
        f"2. Do NOT translate or alter: URLs, image links (![...](...))), brand names (Kniri, Etsy, Instagram), measurements (numbers + units).\n"
        f"3. ABBREVIATIONS section rule: the short codes on the LEFT of each colon "
        f"({abbr_codes}) must remain EXACTLY as written. Translate only the description on the right.\n"
        f"4. Translate naturally — the output should read as a native {lang_name} crochet pattern.\n"
        f"5. Before returning, silently check every term in MANDATORY TERMINOLOGY and fix any violations.\n"
        f"6. Return ONLY the translated document. No commentary, no preamble, no code fences.\n\n"
        f"## DOCUMENT TO TRANSLATE\n"
        f"{source}"
    )


def _build_review_prompt(original: str, translated: str, lang: str) -> str:
    lang_name = SUPPORTED_LANGS[lang]
    return (
        f"You are a professional proofreader for {lang_name} crochet patterns.\n"
        f"Compare the ORIGINAL (English US) document with the TRANSLATION ({lang_name}).\n\n"
        f"## TASK\n"
        f"Identify any errors in the translation: wrong terminology, mistranslations, missing content, "
        f"broken Markdown formatting, or incorrect abbreviation handling.\n\n"
        f"## OUTPUT FORMAT\n"
        f"Return the FULL translated text EXACTLY as given, with ONE change only:\n"
        f"For each problematic line, apply this exact two-part HTML markup:\n"
        f'<mark style="background-color:#fca5a5;">problematic line</mark>'
        f'<mark style="background-color:#fef08a;"> (reason in English)</mark>\n'
        f"Rules: the red mark wraps the original line unchanged; the yellow mark contains ONLY the parenthesised English explanation; no other text is altered.\n"
        f"Do NOT modify any other text. Do NOT add commentary outside the document. Do NOT use code fences.\n\n"
        f"## ORIGINAL\n{original}\n\n"
        f"## TRANSLATION TO REVIEW\n{translated}"
    )


# ── Bilingual merge (Python-side, deterministic) ──────────────────────────────

# display:block forces each span onto its own line (span is inline by default)
_TRANS_STYLE = "font-size:1.05em;display:block;"
_ORIG_STYLE  = "color:#16a34a;font-size:0.875em;display:block;"
_MD_PREFIX   = re.compile(r"^(#{1,6} |- |\* |\d+\. |> |\| )")
# Code fences (``` / ~~~) are DROPPED in bilingual mode — wrapping their content
# in <span> tags causes Markdown to render the spans as raw text inside a code block.
# Dropping the fence lets the content render as normal bilingual HTML.
_FENCE  = re.compile(r"^(`{3,}|~{3,})\s*(\S.*)?$")
# Horizontal rules pass through unchanged (structural separators, safe to keep).
_HLINE  = re.compile(r"^(-{3,}|\*{3,}|_{3,})\s*$")


def _wrap(line: str, style: str) -> str:
    """Wrap a line's content in a block-display span, keeping Markdown prefix outside."""
    m = _MD_PREFIX.match(line)
    if m:
        prefix, content = m.group(0), line[m.end():]
        return f'{prefix}<span style="{style}">{content}</span>'
    return f'<span style="{style}">{line}</span>'


def _merge_bilingual(source: str, translated: str) -> str:
    """
    Deterministically interleave translated and source lines with HTML spans.
    - Splits both texts into paragraphs (blank-line separated).
    - Within each paragraph, pairs translation lines with source lines.
    - Translated line on top (larger font), source line below (green).
    - Code fences (```) are DROPPED so their content renders as bilingual HTML,
      not as raw text inside a code block.
    - Horizontal rules (---) pass through unchanged.
    - All HTML generated here — Gemini never touches spans.
    """
    def split_blocks(text: str) -> list[str]:
        return re.split(r"\n{2,}", text.strip())

    src_blocks = split_blocks(source)
    tr_blocks  = split_blocks(translated)

    n = max(len(src_blocks), len(tr_blocks))
    src_blocks += [""] * (n - len(src_blocks))
    tr_blocks  += [""] * (n - len(tr_blocks))

    result: list[str] = []
    for tr_block, src_block in zip(tr_blocks, src_blocks):
        if not tr_block.strip():
            result.append("")
            continue

        tr_lines  = tr_block.splitlines()
        src_lines = src_block.splitlines() if src_block else []
        src_i     = 0  # track source index independently

        merged: list[str] = []
        for tr_line in tr_lines:
            stripped = tr_line.strip()

            # Blank line — preserve, advance source past its blank lines too
            if not stripped:
                merged.append("")
                while src_i < len(src_lines) and not src_lines[src_i].strip():
                    src_i += 1
                continue

            # Code fence — drop it; content will render as bilingual HTML, not raw code
            if _FENCE.match(stripped):
                if src_i < len(src_lines) and _FENCE.match(src_lines[src_i].strip()):
                    src_i += 1  # skip matching source fence
                continue

            # Horizontal rule — pass through unchanged
            if _HLINE.match(stripped):
                merged.append(tr_line)
                if src_i < len(src_lines) and _HLINE.match(src_lines[src_i].strip()):
                    src_i += 1
                continue

            # Regular content — wrap translation, then paired source line
            merged.append(_wrap(tr_line, _TRANS_STYLE))
            if src_i < len(src_lines):
                src_line = src_lines[src_i]
                if src_line.strip() and not _FENCE.match(src_line.strip()):
                    merged.append(_wrap(src_line, _ORIG_STYLE))
                src_i += 1

        # Any leftover source lines (translation merged multiple src lines into one)
        remaining = [
            src_lines[j] for j in range(src_i, len(src_lines))
            if src_lines[j].strip() and not _FENCE.match(src_lines[j].strip())
        ]
        if remaining:
            merged.append(_wrap(" ".join(remaining), _ORIG_STYLE))

        result.append("\n".join(merged))

    return "\n\n".join(result)


def _build_fix_prompt(translated: str, violations: list[dict], lang: str) -> str:
    lang_name = SUPPORTED_LANGS[lang]
    lines = "\n".join(
        f'  - "{v["search"]}" must use "{v["expected"]}"'
        for v in violations
    )
    return (
        f"The following {lang_name} translation has terminology errors.\n"
        f"Fix ONLY the specific terms listed below. Do not change anything else.\n"
        f"Return the full corrected translation — no commentary, no code fences.\n\n"
        f"## TERMS TO FIX\n{lines}\n\n"
        f"## TRANSLATION TO FIX\n{translated}"
    )


# ── Step 4: Call Gemini ───────────────────────────────────────────────────────

def _call_gemini(prompt: str) -> str:
    client = _get_gemini_client()
    response = gemini_call_with_retry(
        client.models.generate_content,
        model=TRANSLATION_MODEL,
        contents=prompt,
        config=genai_types.GenerateContentConfig(temperature=0.1),
    )
    text = response.text.strip()
    text = re.sub(r"^```(?:markdown)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text).strip()
    # Fix Gemini occasionally writing font-size= instead of font-size:
    text = text.replace("font-size=", "font-size:")
    if not text:
        raise ValueError("Gemini returned an empty response")
    return text


# ── Step 5: Validate output ───────────────────────────────────────────────────

def _validate(translated: str, all_terms: list[dict], lang: str) -> list[dict]:
    """
    Return a list of violation dicts {search, expected} for any term whose
    target translation does not appear in the output.
    """
    violations = []
    for entry in all_terms:
        expected = entry.get(lang, "")
        if not expected:
            continue
        if not re.search(re.escape(expected), translated, re.IGNORECASE):
            violations.append({"search": entry["search"][0], "expected": expected})
    return violations


# ── Public API ────────────────────────────────────────────────────────────────

def translate_one(text: str, lang: str, terminology: dict, bilingual: bool = False) -> str:
    """
    Translate *text* into *lang* using the terminology table for enforcement.
    If bilingual=True, each original line is followed by its italic translation.
    Raises on Gemini errors. Returns the translated Markdown string.
    """
    term_table = _terminology_to_term_table(terminology)

    # Collect relevant terms
    abbr_terms, raw_abbr_map = _parse_abbreviations(text, term_table)
    body_terms  = _scan_body_terms(text, term_table, abbr_terms)
    all_terms   = abbr_terms + body_terms

    log.info(
        "[translate:%s] %d terms from ABBREVIATIONS, %d from body (%d total) bilingual=%s",
        lang, len(abbr_terms), len(body_terms), len(all_terms), bilingual,
    )

    # First translation pass (always clean — no HTML, no bilingual formatting)
    prompt = _build_prompt(text, lang, all_terms, raw_abbr_map)
    translated = _call_gemini(prompt)

    # Validate
    violations = _validate(translated, all_terms, lang)
    if violations:
        names = [v["search"] for v in violations]
        log.warning("[translate:%s] %d violation(s): %s — retrying fix pass", lang, len(violations), names)
        fix_prompt = _build_fix_prompt(translated, violations, lang)
        translated = _call_gemini(fix_prompt)

        remaining = _validate(translated, all_terms, lang)
        if remaining:
            log.warning(
                "[translate:%s] fix pass still has %d violation(s): %s — saving anyway",
                lang, len(remaining), [v["search"] for v in remaining],
            )
        else:
            log.info("[translate:%s] fix pass resolved all violations", lang)
    else:
        log.info("[translate:%s] validation passed (0 violations)", lang)

    log.info("[translate:%s] running final review pass", lang)
    review_prompt = _build_review_prompt(text, translated, lang)
    reviewed = _call_gemini(review_prompt)

    # Bilingual merge done in Python — 100% consistent, no Gemini HTML quirks
    if bilingual:
        log.info("[translate:%s] merging bilingual output (python-side)", lang)
        return _merge_bilingual(text, reviewed)

    return reviewed
