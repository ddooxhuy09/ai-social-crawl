"""
Pinterest crawler: tìm kiếm pin theo keyword, lấy chi tiết pin, lấy related pins.
"""
import asyncio
import json
import random

from undetected_playwright.async_api import async_playwright

from crawlers.pinterest.utils import (
    _BASE_DIR,
    _DEFAULT_HEADLESS,
    _DEFAULT_MAX_PINS,
    build_pin_info,
    collect_pin_ids_from_page,
    get_pws_context,
)


async def fetch_pin_detail_via_page(page, pin_id: str, pws_ctx: dict) -> dict | None:
    """
    Gọi API nội bộ /resource/PinResource/get giống extension, chạy bên trong context của trang.
    """
    return await page.evaluate(
        """
        async ({ origin, path, appVersion, experimentHash, handlerId, pinId }) => {
            const payload = {
                options: {
                    id: pinId,
                    field_set_key: "detailed",
                    fetch_visual_search_objects: true
                },
                context: {}
            };

            const params = new URLSearchParams();
            params.set("source_url", path);
            params.set("data", JSON.stringify(payload));
            params.set("_", String(Math.floor(Date.now())));

            const base = origin.replace(/\\/$/, "");
            const url = base + "/resource/PinResource/get/?" + params.toString();

            const res = await fetch(url, {
                headers: {
                    "x-app-version": appVersion || "",
                    "x-pinterest-appstate": "active",
                    "x-pinterest-experimenthash": experimentHash || "",
                    "x-pinterest-source-url": path || "/",
                    "x-pinterest-pws-handler": handlerId || ""
                },
                credentials: "same-origin"
            });

            const json = await res.json();
            return json && json.resource_response ? json.resource_response.data : null;
        }
        """,
        {
            "origin": pws_ctx.get("origin", "https://www.pinterest.com"),
            "path": pws_ctx.get("path", "/"),
            "appVersion": pws_ctx.get("app_version", ""),
            "experimentHash": pws_ctx.get("experiment_hash", ""),
            "handlerId": pws_ctx.get("handler_id", ""),
            "pinId": pin_id,
        },
    )


async def fetch_related_pins_via_page(
    page,
    pin_id: str,
    pws_ctx: dict,
    max_related: int = 100,
    search_query: str | None = None,
    *,
    return_debug: bool = False,
) -> list[str] | tuple[list[str], dict]:
    """
    Gọi API /resource/RelatedModulesResource/get để lấy các pin liên quan tới một pin.
    Trả về list id pin (string). Nếu return_debug=True thì trả về (ids, debug_dict).
    """
    if not pin_id:
        return [] if not return_debug else ([], {})

    result = await page.evaluate(
        """
        async ({ origin, appVersion, experimentHash, handlerId, pinId, maxRelated, searchQuery }) => {
            const payload = {
                options: {
                    additional_fields: ["pin.gen_ai_topics"],
                    pin_id: pinId,
                    context_pin_ids: [],
                    context_near_dup_image_sigs: [],
                    page_size: maxRelated,
                    search_query: searchQuery || "",
                    source: "search",
                    top_level_source: "search",
                    top_level_source_depth: 1,
                    is_pdp: false,
                },
                context: {},
            };

            const params = new URLSearchParams();
            params.set("source_url", `/pin/${pinId}/`);
            params.set("data", JSON.stringify(payload));
            params.set("_", String(Math.floor(Date.now())));

            const base = (origin || "https://www.pinterest.com").replace(/\\/$/, "");
            const url = base + "/resource/RelatedModulesResource/get/?" + params.toString();

            const res = await fetch(url, {
                headers: {
                    "x-app-version": appVersion || "",
                    "x-pinterest-appstate": "active",
                    "x-pinterest-experimenthash": experimentHash || "",
                    "x-pinterest-source-url": `/pin/${pinId}/`,
                    "x-pinterest-pws-handler": handlerId || "",
                },
                credentials: "same-origin",
            });

            const json = await res.json().catch(() => ({}));
            const rr = json && json.resource_response;
            const data = rr && Array.isArray(rr.data) ? rr.data : [];
            const pins = data.filter((item) => item && item.type === "pin");
            const ids = pins
              .slice(0, maxRelated)
              .map((it) => (it && it.id) ? String(it.id) : null)
              .filter((v) => !!v);

            const debug = {
                status: res.status,
                dataIsArray: Array.isArray(rr && rr.data),
                dataLength: data.length,
                error: (rr && rr.message) || (rr && rr.error) || null,
                hasHandlerId: !!(handlerId && handlerId.length > 0),
            };
            return { ids, debug };
        }
        """,
        {
            "origin": pws_ctx.get("origin", "https://www.pinterest.com"),
            "appVersion": pws_ctx.get("app_version", ""),
            "experimentHash": pws_ctx.get("experiment_hash", ""),
            "handlerId": pws_ctx.get("handler_id", ""),
            "pinId": pin_id,
            "maxRelated": int(max_related),
            "searchQuery": (search_query or "").strip(),
        },
    )
    ids = result.get("ids") or []
    if return_debug:
        return (ids, result.get("debug") or {})
    return ids


async def open_pinterest_with_keyword(
    keyword: str,
    max_pins: int = _DEFAULT_MAX_PINS,
    scroll_rounds: int = 5,
    headless: bool = _DEFAULT_HEADLESS,
    mode: str = "default",   # "default" | "saves" | "repins"
    saves_min: int = 0,
    repins_min: int = 0,
) -> list[dict]:
    """
    Crawl Pinterest theo keyword, gọi API lấy chi tiết từng pin.
    Chỉ trả về list pin_infos, không ghi file (backend sẽ lưu history).

    mode="default"  : quy trình gốc (RelatedModules → PinResource cho tất cả)
    mode="saves"    : lấy detail seed trước, chỉ lấy related cho pin có saves >= saves_min
    mode="repins"   : tương tự, lọc theo repin_count >= repins_min
    """
    url = f"https://www.pinterest.com/search/pins/?q={keyword}&rs=typed"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto(url, wait_until="domcontentloaded")
        try:
            await page.wait_for_selector('a[href*="/pin/"]', timeout=15000)
        except Exception:
            pass
        await page.wait_for_timeout(1500)
        pws_ctx = await get_pws_context(page)

        # Scroll để load thêm pin (infinite scroll)
        print(f"📜 Scrolling {scroll_rounds} lần để load thêm pins...")
        for i in range(scroll_rounds):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(1200)
            current_count = await page.eval_on_selector_all(
                'a[href*="/pin/"]', "els => els.length"
            )
            print(f"   Round {i+1}/{scroll_rounds}: {current_count} link pin trong DOM")
            if current_count >= max_pins * 2:  # đủ rồi thì dừng sớm
                break

        all_pin_ids = await collect_pin_ids_from_page(page)

        if not pws_ctx:
            print("⚠️ Không lấy được __PWS_DATA__; dừng.")
            await browser.close()
            return []

        print(f"✅ Phase 1: Lấy được {len(all_pin_ids)} pin id từ trang search.")
        if all_pin_ids:
            print("Ví dụ:", ", ".join(all_pin_ids[:10]))

        pin_infos: list[dict] = []
        related_debug: dict[str, list[str]] = {}

        import math
        # Tạo ngưỡng động (Dynamic Threshold) để cân bằng thời gian và kết quả
        phase1_limit = max(1, math.ceil(math.sqrt(max_pins)))
        phase2_limit = max(1, math.ceil(max_pins / phase1_limit))
        print(f"📊 Dynamic Threshold (Limit={max_pins}): Lấy tối đa {phase1_limit} seed pins, mỗi seed lấy {phase2_limit} related pins.")

        if all_pin_ids:
            if mode in ("saves", "repins"):
                # ── Filter mode ───────────────────────────────────────────────
                threshold_field = "save_count" if mode == "saves" else "repin_count"
                threshold_val = saves_min if mode == "saves" else repins_min
                print(f"🔍 Mode: {mode} | ngưỡng {threshold_field} >= {threshold_val}")

                total_seeds = len(all_pin_ids)
                print(f"📥 Phase 2a: Lấy details {total_seeds} seed pins để filter...")
                filtered_seed_infos: list[dict] = []
                filtered_seed_ids: list[str] = []
                fetched_seed = 0
                for idx, pid in enumerate(all_pin_ids, start=1):
                    await asyncio.sleep(random.uniform(0.4, 1.2))
                    try:
                        data = await fetch_pin_detail_via_page(page, pid, pws_ctx)
                    except Exception as exc:
                        print(f"⚠️ Lỗi PinResource seed {pid}: {exc}")
                        continue
                    if not data:
                        continue
                    info = build_pin_info(data)
                    fetched_seed += 1
                    print(f"   ✅ Seed details: {fetched_seed}/{total_seeds}")
                    if int(info.get(threshold_field) or 0) >= threshold_val:
                        filtered_seed_infos.append(info)
                        filtered_seed_ids.append(str(pid))
                        if len(filtered_seed_ids) >= phase1_limit:
                            print(f"   🛑 Đã đủ {phase1_limit} seed pins pass điều kiện.")
                            break
                print(f"✅ Phase 2a: {len(filtered_seed_ids)}/{len(all_pin_ids)} seeds pass (>= {threshold_val})")

                print("🔁 Phase 2b: RelatedModulesResource cho seeds đã pass...")
                all_related_ids: list[str] = []
                for pid in filtered_seed_ids:
                    await asyncio.sleep(random.uniform(0.6, 0.8))
                    try:
                        related_ids = await fetch_related_pins_via_page(
                            page, pid, pws_ctx, max_related=phase2_limit, search_query=keyword,
                        )
                    except Exception as exc:
                        print(f"⚠️ Lỗi RelatedModulesResource cho pin {pid}: {exc}")
                        continue
                    rel_ids: list[str] = [str(r or "") for r in (related_ids or []) if r]
                    if rel_ids:
                        related_debug[str(pid)] = rel_ids
                        all_related_ids.extend(rel_ids)

                fetched_ids = set(filtered_seed_ids)
                unique_related_ids = list(dict.fromkeys(r for r in all_related_ids if r not in fetched_ids))
                
                total_related = len(unique_related_ids)
                print(f"📋 Phase 3: {total_related} related pins cần fetch.")
                fetched_related = 0
                for pid in unique_related_ids:
                    await asyncio.sleep(random.uniform(0.4, 1.5))
                    try:
                        data = await fetch_pin_detail_via_page(page, pid, pws_ctx)
                    except Exception as exc:
                        print(f"⚠️ Lỗi PinResource related {pid}: {exc}")
                        continue
                    if data:
                        pin_infos.append(build_pin_info(data))
                        fetched_related += 1
                        print(f"   ✅ Related details: {fetched_related}/{total_related}")

                pin_infos = filtered_seed_infos + pin_infos

            else:
                # ── Default mode ──────────────────────────────────────────────
                seed_for_related = all_pin_ids[:phase1_limit]
                print(f"🔁 Phase 2: Gọi Related API cho {len(seed_for_related)} seed pins...")
                all_related_ids: list[str] = []
                for pid in seed_for_related:
                    await asyncio.sleep(random.uniform(0.6, 0.8))
                    try:
                        related_ids = await fetch_related_pins_via_page(
                            page, pid, pws_ctx, max_related=phase2_limit, search_query=keyword,
                        )
                    except Exception as exc:
                        print(f"⚠️ Lỗi RelatedModulesResource cho pin {pid}: {exc}")
                        continue
                    rel_ids: list[str] = [str(r or "") for r in (related_ids or []) if r]
                    if rel_ids:
                        related_debug[str(pid)] = rel_ids
                        all_related_ids.extend(rel_ids)

                # Gom Seed (đã lấy related) + Related
                target_ids = list(dict.fromkeys(seed_for_related + all_related_ids))
                # Bù danh sách nếu thiếu để cho đạt tối thiểu max_pins
                for pid in all_pin_ids:
                    if len(target_ids) >= max_pins:
                        break
                    if pid not in target_ids:
                        target_ids.append(pid)

                unique_pin_ids: list[str] = target_ids
                total_details = len(unique_pin_ids)
                print(f"📋 Phase 3: Tổng {total_details} pin id cần fetch details.")

                print("🔎 Phase 4: Gọi PinResource/get cho từng pin id...")
                fetched_details = 0
                for pid in unique_pin_ids:
                    await asyncio.sleep(random.uniform(0.4, 1.5))
                    try:
                        data = await fetch_pin_detail_via_page(page, pid, pws_ctx)
                    except Exception as exc:
                        print(f"⚠️ Lỗi PinResource cho pin {pid}: {exc}")
                        continue
                    if data:
                        pin_infos.append(build_pin_info(data))
                        fetched_details += 1
                        print(f"   ✅ Pin details: {fetched_details}/{total_details}")

            # Xóa trùng theo pin_url / canonical_pin_id
            if pin_infos:
                unique: dict[str, dict] = {}
                for info in pin_infos:
                    key = (
                        str(info.get("pin_url") or "")
                        or str(info.get("canonical_pin_id") or "")
                    )
                    if not key:
                        key = repr(info)
                    if key not in unique:
                        unique[key] = info
                pin_infos = list(unique.values())
        
        await browser.close()
        return pin_infos


def crawl_pins_sync(keyword: str, **kwargs) -> list[dict]:
    """Wrapper sync: asyncio.run(open_pinterest_with_keyword(keyword, **kwargs))."""
    return asyncio.run(open_pinterest_with_keyword(keyword, **kwargs))


if __name__ == "__main__":
    keyword = input("🔍 Nhập keyword để tìm kiếm trên Pinterest: ").strip()
    if keyword:
        print(f"🚀 Bắt đầu crawl với keyword: {keyword}")
        crawl_pins_sync(keyword)
    else:
        print("❌ Vui lòng nhập keyword!")
