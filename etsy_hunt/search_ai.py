"""
etsy_hunt — AI search & classify module.

Cung cấp:
  - NER keyword classification (_classify_keywords_gemini)
  - LLM incremental keyword clustering (_run_group_search)

LLM backend:
  - Primary:  Ollama gemma3:4b (local, free, no rate limit)
  - Fallback: Gemini if Ollama is unreachable

Group search approach:
  - LLM reads all keywords in batches of 20
  - Each batch: assign to existing group OR create new group OR mark "Not Relevant"
  - Groups accumulate and stabilize naturally (no pre-defined taxonomy)
  - L3 subgroups formed by running same logic within each L2 group

Reliability:
  - Semaphore(2)        → max 2 concurrent Gemini text-gen calls
  - Exp backoff+jitter  → retry on 429/503 without thundering herd
  - Async retry         → asyncio.sleep variant for event-loop callers
"""

import asyncio
import json
import os
import random
import re
import sys
import time
import threading
import requests
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics.pairwise import cosine_similarity
from pathlib import Path

# ── Path ──────────────────────────────────────────────────────────────────────

def _base() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "etsy_hunt"
    return Path(__file__).resolve().parent

PROMPTS_FILE = _base() / "prompts.json"

# ── Constants ─────────────────────────────────────────────────────────────────

OLLAMA_URL         = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_TEXT_MODEL  = os.getenv("OLLAMA_TEXT_MODEL", "gemma3:4b")
OLLAMA_EMBED_MODEL = "nomic-embed-text:latest"
GEMINI_EMBED_MODEL = "gemini-embedding-001"
EMBED_BATCH        = 100

SIM_THRESHOLD      = 0.45  # cosine sim threshold for relevance filter
CLUSTER_BATCH_SIZE = 50    # keywords per LLM call
FILTER_BATCH_SIZE  = 80    # batch size for lenient filtering
MAX_L2_GROUPS      = 15    # soft cap — prompt warns LLM when approaching this

# ── Concurrency guard ─────────────────────────────────────────────────────────

_SYNC_SEM = threading.Semaphore(2)

_async_sem: asyncio.Semaphore | None = None
_async_sem_lock = threading.Lock()

def _get_async_sem() -> asyncio.Semaphore:
    global _async_sem
    with _async_sem_lock:
        if _async_sem is None:
            _async_sem = asyncio.Semaphore(2)
    return _async_sem


# ── Retry helpers ─────────────────────────────────────────────────────────────

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


def _gemini_call_with_retry(fn, *args, max_retries: int = 5, **kwargs):
    import time
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


async def _gemini_call_with_retry_async(fn, *args, max_retries: int = 5, **kwargs):
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


# ── Classify (NER) ────────────────────────────────────────────────────────────

def _load_prompt(key: str) -> str:
    """Load a prompt_template from prompts.json by top-level key."""
    try:
        data = json.loads(PROMPTS_FILE.read_text(encoding="utf-8"))
        return data[key]["prompt_template"]
    except Exception:
        return ""


# ── Embedding helpers ─────────────────────────────────────────────────────────

def _embed_ollama(keywords: list[str], progress_cb=None) -> list[list[float]]:
    import requests as _req
    url = f"{OLLAMA_URL}/api/embed"
    vectors = []
    batches = [keywords[i: i + EMBED_BATCH] for i in range(0, len(keywords), EMBED_BATCH)]
    for idx, batch in enumerate(batches):
        resp = _req.post(url, json={"model": OLLAMA_EMBED_MODEL, "input": batch}, timeout=300)
        resp.raise_for_status()
        vectors.extend(resp.json()["embeddings"])
        if progress_cb:
            progress_cb(min((idx + 1) * EMBED_BATCH, len(keywords)), len(keywords))
    return vectors


def _embed_gemini_fallback(gemini_client, keywords: list[str], progress_cb=None) -> list[list[float]]:
    import time
    vectors = []
    batches = [keywords[i: i + EMBED_BATCH] for i in range(0, len(keywords), EMBED_BATCH)]
    for idx, batch in enumerate(batches):
        resp = _gemini_call_with_retry(
            gemini_client.models.embed_content,
            model=GEMINI_EMBED_MODEL,
            contents=batch,
            config={"task_type": "CLUSTERING"},
        )
        for emb in resp.embeddings:
            vectors.append(emb.values)
        if progress_cb:
            progress_cb(min((idx + 1) * EMBED_BATCH, len(keywords)), len(keywords))
        if idx < len(batches) - 1:
            time.sleep(1.5)
    return vectors


def _embed_keywords_sync(gemini_client, keywords: list[str], progress_cb=None) -> list[list[float]]:
    try:
        return _embed_ollama(keywords, progress_cb=progress_cb)
    except Exception as e:
        print(f"[embed] Ollama failed ({e}), falling back to Gemini")
    return _embed_gemini_fallback(gemini_client, keywords, progress_cb=progress_cb)


def _cosine_sim(a, b) -> float:
    import numpy as np
    a, b = np.array(a, dtype=float), np.array(b, dtype=float)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))


# ── LLM helpers ───────────────────────────────────────────────────────────────

def _ollama_generate(prompt: str, model: str = None) -> str:
    import requests as _req
    _model = model or OLLAMA_TEXT_MODEL
    resp = _req.post(
        f"{OLLAMA_URL}/api/generate",
        json={"model": _model, "prompt": prompt, "stream": False},
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json().get("response", "")


def _parse_llm_json(raw: str):
    """Strip markdown fences and extract first JSON object or array."""
    raw = re.sub(r"```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"```\s*$", "", raw).strip()
    m = re.search(r"(\{.*\}|\[.*\])", raw, re.DOTALL)
    if not m:
        raise ValueError(f"No JSON found in LLM response: {raw[:200]}")
    return json.loads(m.group(1))


def _llm_call(prompt: str, client, model: str) -> str:
    """Ollama first, Gemini fallback."""
    try:
        return _ollama_generate(prompt)
    except Exception as e:
        print(f"[llm_call] Ollama failed ({e}), falling back to Gemini")
    resp = _gemini_call_with_retry(client.models.generate_content, model=model, contents=prompt)
    return resp.text or ""


def _filter_relevant(
    query_vec: list[float],
    kw_vecs: list[list[float]],
    keywords: list[str],
) -> list[str]:
    """Keep keywords with cosine_sim > SIM_THRESHOLD."""
    relevant = []
    for i, vec in enumerate(kw_vecs):
        if _cosine_sim(query_vec, vec) > SIM_THRESHOLD:
            relevant.append(keywords[i])
    print(f"[filter] {len(keywords)} → {len(relevant)} relevant keywords")
    return relevant


def _run_lenient_filter(
    keywords: list[str],
    query: str,
    client,
    model: str,
    progress_cb=None
) -> list[str]:
    """Run an LLM pass to aggressively drop truly irrelevant/spam keywords."""
    prompt_tpl = _load_prompt("lenient_filter")
    if not prompt_tpl:
        prompt_tpl = (
            "You are a lenient keyword filter for an Etsy analyst tool. "
            "Keep as many relevant keywords as possible for the query \"{query}\". "
            "ONLY discard a keyword if you are ABSOLUTELY 100% sure it is spam or utterly useless. "
            "Keywords (batch {batch_num}/{total_batches}):\n{numbered}\n"
            "Return JSON: {\"kept\": [], \"discarded\": []}"
        )
    
    total_batches = (len(keywords) + FILTER_BATCH_SIZE - 1) // FILTER_BATCH_SIZE
    kept_list = []
    
    for i in range(0, len(keywords), FILTER_BATCH_SIZE):
        batch = keywords[i : i + FILTER_BATCH_SIZE]
        batch_num = i // FILTER_BATCH_SIZE + 1
        numbered = "\n".join(f"{j+1}. {kw}" for j, kw in enumerate(batch))
        
        prompt = prompt_tpl.replace("{query}", query)\
                           .replace("{numbered}", numbered)\
                           .replace("{batch_num}", str(batch_num))\
                           .replace("{total_batches}", str(total_batches))
        
        try:
            raw = _llm_call(prompt, client, model)
            parsed = _parse_llm_json(raw)
            kept_ids = parsed.get("kept", [])
            
            if isinstance(kept_ids, list):
                if not kept_ids:
                    # AI discarded all in this batch
                    pass
                elif all(isinstance(x, (int, float)) or (isinstance(x, str) and str(x).isdigit()) for x in kept_ids):
                    # AI trả về số ID (chuẩn) → map về keyword gốc
                    for item in kept_ids:
                        try:
                            idx = int(item) - 1  # 1-based → 0-based
                            if 0 <= idx < len(batch):
                                kept_list.append(batch[idx])
                        except (ValueError, TypeError):
                            pass
                else:
                    # Fallback: AI vẫn trả text → giữ nguyên toàn bộ batch
                    print(f"[lenient_filter] batch {batch_num}: AI returned text instead of IDs, keeping full batch")
                    kept_list.extend(batch)
            else:
                print(f"[lenient_filter] batch {batch_num}: Unknown format, keeping full batch")
                kept_list.extend(batch)
        except Exception as e:
            print(f"[lenient_filter] batch {batch_num} failed: {e}. Keeping all by default.")
            kept_list.extend(batch)
            
        if progress_cb:
            progress_cb("filter_llm", min(i + FILTER_BATCH_SIZE, len(keywords)), len(keywords))

    print(f"[lenient_filter] Kept {len(kept_list)} out of {len(keywords)}")
    return kept_list


# ── Group search (LLM incremental clustering) ─────────────────────────────────

_GROUP_SEARCH_FALLBACK_TEMPLATE = (
    "You are an Etsy keyword analyst.\n\n"
    "{task_line}\n\n"
    "{existing_section}"
    "Keywords to classify (batch {batch_num}/{total_batches}):\n{numbered}\n\n"
    "Instructions:\n"
    "- You MUST assign EVERY keyword to the most fitting group.\n"
    "- {new_group_instruction}\n"
    "- If a keyword seems unrelated or weird, assign it to a group named \"Other\" or \"Khác\". Do NOT discard any keyword.\n"
    "- Group names must be broad category labels (e.g. Pattern, Color, Style, Material, Target Audience, Season/Event) + one emoji. Do NOT use specific keyword descriptions as group names — detailed attributes are handled separately.\n\n"
    "Return ONLY valid JSON (no markdown, no explanation):\n{json_format}"
)


def _get_group_search_template() -> str:
    """Always read fresh from prompts.json — edits take effect without server restart."""
    tpl = _load_prompt("group_search")
    return tpl if tpl else _GROUP_SEARCH_FALLBACK_TEMPLATE


def _build_cluster_prompt(
    query: str,
    batch_kws: list[str],
    existing_groups: dict,
    context_hint: str,
    batch_num: int,
    total_batches: int,
) -> str:
    is_l3 = ">" in context_hint
    numbered = "\n".join(f"{i+1}. {kw}" for i, kw in enumerate(batch_kws))

    if existing_groups:
        groups_list = "\n".join(f"- {name} {meta['icon']}" for name, meta in existing_groups.items())
        existing_section = f"Existing groups (prefer assigning to these):\n{groups_list}\n\n"
    else:
        existing_section = ""

    if is_l3:
        parent = context_hint.split(">")[-1].strip()
        task_line = f'Create specific subgroups within the "{parent}" category for Etsy query "{query}".'
    else:
        task_line = f'The user is researching Etsy keywords related to "{query}".'

    # Hard cap: khi đủ groups rồi, cấm tạo mới hoàn toàn
    if len(existing_groups) >= MAX_L2_GROUPS:
        new_group_instruction = "You MUST assign each keyword to one of the existing groups above. Do NOT create any new groups."
        json_format = '{"new_groups":[], "assignments":[{"id":1,"group":"Name"},...] }'
    else:
        new_group_instruction = "If no existing group fits well, create a new one (short English name 2-4 words + single emoji)"
        json_format = '{"new_groups":[{"group":"Name","icon":"emoji"},...], "assignments":[{"id":1,"group":"Name"},...] }'

    return (
        _get_group_search_template()
        .replace("{task_line}", task_line)
        .replace("{existing_section}", existing_section)
        .replace("{batch_num}", str(batch_num))
        .replace("{total_batches}", str(total_batches))
        .replace("{numbered}", numbered)
        .replace("{new_group_instruction}", new_group_instruction)
        .replace("{json_format}", json_format)
    )


def _incremental_cluster_batch(
    batch_kws: list[str],
    existing_groups: dict,
    query: str,
    context_hint: str,
    client,
    model: str,
    batch_num: int,
    total_batches: int,
) -> dict:
    """
    Call LLM for one batch. Returns {"new_groups": [...], "assignments": [...]}.
    Retries once with half the batch on parse failure.
    Falls back to Uncategorized on second failure.
    """
    current_batch = batch_kws

    for attempt in range(2):
        prompt = _build_cluster_prompt(
            query, current_batch, existing_groups, context_hint, batch_num, total_batches
        )
        try:
            raw = _llm_call(prompt, client, model)
            parsed = _parse_llm_json(raw)
            if isinstance(parsed, list):
                parsed = {"new_groups": [], "assignments": parsed}

            # Không tự ý fill keywords bị thiếu, mặc định coi như LLM đã quyết định discard.
            return parsed

        except Exception as e:
            if attempt == 0:
                print(f"[cluster] batch {batch_num} parse error ({e}), retrying with half batch")
                current_batch = batch_kws[:max(1, len(batch_kws) // 2)]
            else:
                print(f"[cluster] batch {batch_num} failed twice, discarding batch")
                return {
                    "new_groups": [],
                    "assignments": [],
                }


def _run_incremental_clustering(
    keywords: list[str],
    query: str,
    context_hint: str,
    client,
    model: str,
    progress_cb=None,
    stage: str = "cluster_l2",
) -> dict[str, dict]:
    """
    Core incremental clustering loop.
    Returns {group_name: {"icon": str, "keywords": list[str]}}
    """
    def _clean_group_name(name: str) -> str:
        """Strip emojis and weird characters so groups don't duplicate."""
        if not name: return "Other"
        cleaned = re.sub(r'[^\w\s\&\-\.\/]+', '', name, flags=re.UNICODE)
        cleaned = " ".join(cleaned.split()).title()
        return cleaned if cleaned else "Other"

    existing_groups: dict[str, dict] = {}
    all_assignments: dict[str, str] = {}
    total_batches = (len(keywords) + CLUSTER_BATCH_SIZE - 1) // CLUSTER_BATCH_SIZE

    for i in range(0, len(keywords), CLUSTER_BATCH_SIZE):
        batch = keywords[i: i + CLUSTER_BATCH_SIZE]
        batch_num = i // CLUSTER_BATCH_SIZE + 1

        result = _incremental_cluster_batch(
            batch, existing_groups, query, context_hint,
            client, model, batch_num, total_batches,
        )

        for g in result.get("new_groups", []):
            if not isinstance(g, dict): continue
            raw_name = g.get("group")
            if not raw_name: continue
            name = _clean_group_name(raw_name)
            if name not in existing_groups:
                existing_groups[name] = {"icon": g.get("icon", "📌")}

        for a in result.get("assignments", []):
            if not isinstance(a, dict): continue
            # AI trả về {"id": 3, "group": "..."} — map bằng index, không dùng chữ keyword
            raw_id = a.get("id")
            raw_name = a.get("group")
            if not raw_name: continue
            grp = _clean_group_name(raw_name)
            if raw_id is not None:
                try:
                    idx = int(raw_id) - 1  # 1-based → 0-based
                    if 0 <= idx < len(batch):
                        all_assignments[batch[idx]] = grp
                except (ValueError, TypeError):
                    pass
            else:
                # Fallback nếu AI vẫn trả keyword text
                kw = a.get("keyword")
                if kw:
                    all_assignments[kw] = grp

        print(f"[{stage}] batch {batch_num}/{total_batches} — {len(existing_groups)} groups so far")
        if progress_cb:
            progress_cb(stage, min(i + CLUSTER_BATCH_SIZE, len(keywords)), len(keywords))

    out: dict[str, dict] = {}
    for kw, grp in all_assignments.items():
        if grp not in out:
            icon = existing_groups.get(grp, {}).get("icon", "📌")
            out[grp] = {"icon": icon, "keywords": []}
        out[grp]["keywords"].append(kw)

    return out


def _run_group_search(
    client,
    query: str,
    keywords: list[str],
    model: str,
    progress_cb=None,   # optional callable(stage: str, done: int, total: int)
) -> tuple[list[dict], int]:
    """
    AI Pipeline (y chang test_ai_group.py):
      Giai đoạn 1: Chuẩn bị
      Giai đoạn 2: ThreadPool Embedding (mxbai-embed-large) + Cosine Filter (threshold=0.55)
      Giai đoạn 3: AgglomerativeClustering (cosine, average, distance_threshold=0.2)
      Giai đoạn 4: Ollama qwen2.5:3b đặt tên parent/sub cho từng cụm
      Giai đoạn 5: Map sang L2/L3 structure cho Frontend
    Returns (groups, n_relevant).
    """
    if not keywords:
        return [], 0

    # Giai đoạn 1: Deduplicate (giữ nguyên thứ tự, bỏ trùng lặp)
    seen = set()
    keywords = [kw for kw in keywords if kw and not (kw.lower() in seen or seen.add(kw.lower()))]

    print(f"[group_search] {len(keywords)} keywords (sau dedup), query='{query}'")

    # ── Config (y chang test_ai_group.py) ────────────────────────────────────
    _OLLAMA_URL        = os.getenv("OLLAMA_URL", "http://localhost:11434")
    _EMBED_MODEL       = "mxbai-embed-large"
    _LLM_MODEL         = "qwen2.5:3b"
    _SIM_THRESHOLD     = 0.55
    _DIST_THRESHOLD    = 0.2

    # ── Giai đoạn 2: Embed seed + toàn bộ keyword (20 threads song song) ─────
    if progress_cb:
        progress_cb("embed", 0, len(keywords))

    def _get_embedding(text: str) -> np.ndarray:
        resp = requests.post(
            f"{_OLLAMA_URL}/api/embeddings",
            json={"model": _EMBED_MODEL, "prompt": text},
            timeout=60,
        )
        resp.raise_for_status()
        return np.array(resp.json().get("embedding", []))

    try:
        seed_vec = _get_embedding(query).reshape(1, -1)
    except Exception as e:
        print(f"[group_search] Failed to embed query: {e}")
        return [], 0

    completed_embed = 0
    embed_lock = threading.Lock()

    def _embed_task(idx_kw):
        idx, kw = idx_kw
        try:
            vec = _get_embedding(kw)
        except Exception:
            vec = np.zeros(1024)  # mxbai-embed-large fallback dimension
        with embed_lock:
            nonlocal completed_embed
            completed_embed += 1
            if completed_embed % 200 == 0 or completed_embed == len(keywords):
                print(f"   ...embedded {completed_embed}/{len(keywords)}")
            if progress_cb and (completed_embed % 100 == 0 or completed_embed == len(keywords)):
                progress_cb("embed", completed_embed, len(keywords))
        return idx, vec

    with ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(_embed_task, enumerate(keywords)))

    results.sort(key=lambda x: x[0])
    kw_matrix = np.vstack([x[1] for x in results])

    # Tính Cosine Similarity & lọc Relevant
    similarities = cosine_similarity(seed_vec, kw_matrix).flatten()
    is_relevant = similarities > _SIM_THRESHOLD
    relevant_indices = np.where(is_relevant)[0]
    n_relevant = len(relevant_indices)

    print(f"\n -> Xong! Có {n_relevant} / {len(keywords)} keywords [Relevant] (ngưỡng > {_SIM_THRESHOLD}).\n")

    if n_relevant == 0:
        return [], 0

    # ── Giai đoạn 3: Agglomerative Clustering (100% CPU) ─────────────────────
    if progress_cb:
        progress_cb("cluster", 0, n_relevant)

    relevant_matrix = kw_matrix[relevant_indices]
    relevant_kws    = np.array(keywords)[relevant_indices]
    relevant_sims   = similarities[relevant_indices]

    clusterer = AgglomerativeClustering(
        n_clusters=None,
        metric="cosine",
        linkage="average",
        distance_threshold=_DIST_THRESHOLD,
    )
    labels = clusterer.fit_predict(relevant_matrix)

    clusters: dict[int, list[tuple[str, float]]] = {}
    for i, label in enumerate(labels):
        clusters.setdefault(int(label), []).append((relevant_kws[i], float(relevant_sims[i])))

    print(f" -> Thuật toán gom được thành {len(clusters)} cụm riêng biệt.\n")

    # ── Giai đoạn 4: LLM đặt tên parent/sub cho từng cụm ────────────────────
    print(f"[group_search] Gọi LLM {_LLM_MODEL} để đặt tên danh mục...")

    prompt_template = (
        "You are an Etsy SEO expert.\n"
        "I will give you a group of highly related crochet keywords.\n"
        "Please analyze these keywords and invent a perfect 'Parent Category' and 'Sub Category' for them.\n\n"
        "Keywords in this cluster:\n"
        "{kw_list}\n\n"
        "Return ONLY a valid JSON object in this exact format, with no other text or explanation:\n"
        "{{\n"
        '  "parent_category": "Short broad name (e.g. Cat Designs)",\n'
        '  "sub_category": "Specific niche (e.g. Kitty Plushies)"\n'
        "}}"
    )

    groups_dict: dict[str, dict] = {}
    completed_clusters = 0

    for cluster_id, items in clusters.items():
        # Sắp xếp theo similarity giảm dần (giống test: cung cấp context tốt nhất cho LLM)
        items.sort(key=lambda x: x[1], reverse=True)
        kws_only = [kw for kw, _ in items]

        display_items = kws_only[:15]
        kw_str = "\n".join(f"[KW_{str(j+1).zfill(4)}] - {k}" for j, k in enumerate(display_items))
        prompt = prompt_template.format(kw_list=kw_str)

        print(f" -> Đang gọi AI cho Cụm số {cluster_id} ({len(items)} từ)...")
        try:
            raw = _llm_call(prompt, client, _LLM_MODEL)
            json_data = _parse_llm_json(raw)
        except Exception as e:
            print(f"[group_search] LLM error on cluster {cluster_id}: {e}")
            json_data = {}

        parent = json_data.get("parent_category", "Uncategorized")
        sub    = json_data.get("sub_category", f"Cluster {cluster_id}")
        group_name = f"{parent} > {sub}"

        groups_dict.setdefault(group_name, {"parent": parent, "sub": sub, "keywords": []})
        groups_dict[group_name]["keywords"].extend(kws_only)

        completed_clusters += 1
        if progress_cb:
            progress_cb("cluster", completed_clusters, len(clusters))

        time.sleep(0.1)  # nhịp nghỉ tránh OOM khi gọi LLM liên tục

    # ── Giai đoạn 5: Map sang L2/L3 structure cho Frontend ───────────────────
    frontend_groups: dict[str, dict] = {}

    for grp_data in groups_dict.values():
        parent = grp_data["parent"]
        sub    = grp_data["sub"]
        frontend_groups.setdefault(parent, {"group": parent, "icon": "📌", "count": 0, "subgroups": []})
        frontend_groups[parent]["subgroups"].append({
            "group": sub,
            "icon": "📌",
            "keywords": grp_data["keywords"],
            "count": len(grp_data["keywords"]),
        })
        frontend_groups[parent]["count"] += len(grp_data["keywords"])

    result = sorted(frontend_groups.values(), key=lambda x: x["count"], reverse=True)
    for r in result:
        r["subgroups"].sort(key=lambda x: x["count"], reverse=True)

    print(f"\n -> HOÀN THÀNH! {len(result)} parent groups, {n_relevant} relevant keywords.")
    return result, n_relevant
