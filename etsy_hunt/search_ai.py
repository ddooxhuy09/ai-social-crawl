"""
etsy_hunt — AI search & classify module.

Pipeline (_run_group_search):
  1. Deduplicate keywords
  2. Embed with mxbai-embed-large (20 threads) + cosine filter (threshold=0.55)
  3. AgglomerativeClustering (cosine, average, distance_threshold=0.2)
  4. Ollama qwen2.5:3b names each cluster (parent + sub category)
  5. Map to L2/L3 structure for frontend

LLM: Ollama primary, Gemini fallback (Semaphore(2) + exp backoff)
"""

import os
import time
import threading
import requests
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics.pairwise import cosine_similarity

from services.ai_utils import (
    gemini_call_with_retry as _gemini_call_with_retry,
    gemini_call_with_retry_async as _gemini_call_with_retry_async,
    parse_llm_json as _parse_llm_json,
)

# ── Constants ─────────────────────────────────────────────────────────────────

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")



# ── LLM helpers ───────────────────────────────────────────────────────────────

def _ollama_generate(prompt: str, model: str) -> str:
    import requests as _req
    resp = _req.post(
        f"{OLLAMA_URL}/api/generate",
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json().get("response", "")


def _llm_call(prompt: str, client, model: str) -> str:
    """Ollama first, Gemini fallback."""
    try:
        return _ollama_generate(prompt, model)
    except Exception as e:
        print(f"[llm_call] Ollama failed ({e}), falling back to Gemini")
    resp = _gemini_call_with_retry(client.models.generate_content, model=model, contents=prompt)
    return resp.text or ""



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

    # ── Config ───────────────────────────────────────────────────────────────
    _EMBED_MODEL       = "mxbai-embed-large"
    _LLM_MODEL         = "qwen2.5:3b"
    _SIM_THRESHOLD     = 0.55
    _DIST_THRESHOLD    = 0.2

    # ── Giai đoạn 2: Embed seed + toàn bộ keyword (20 threads song song) ─────
    if progress_cb:
        progress_cb("embed", 0, len(keywords))

    def _get_embedding(text: str) -> np.ndarray:
        resp = requests.post(
            f"{OLLAMA_URL}/api/embeddings",
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
