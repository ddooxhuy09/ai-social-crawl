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

def translate_one(text: str, lang: str, terminology: dict) -> str:
    """
    Translate *text* into *lang* using the terminology table for enforcement.
    Raises on Gemini errors. Returns the translated Markdown string.
    """
    term_table = _terminology_to_term_table(terminology)

    # Collect relevant terms
    abbr_terms, raw_abbr_map = _parse_abbreviations(text, term_table)
    body_terms  = _scan_body_terms(text, term_table, abbr_terms)
    all_terms   = abbr_terms + body_terms

    log.info(
        "[translate:%s] %d terms from ABBREVIATIONS, %d from body (%d total)",
        lang, len(abbr_terms), len(body_terms), len(all_terms),
    )

    # First translation pass
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
    translated = _call_gemini(review_prompt)

    return translated
