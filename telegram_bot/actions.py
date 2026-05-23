import html as html_mod

from etsy_listing.shared import (
    build_listing_history_response,
    build_empty_listing_history,
    ensure_listing_name,
    get_listing_asset_dir,
    load_listing_history,
    list_all_listing_histories,
    save_listing_history,
    slugify_listing_name,
)


def get_all_listings():
    return list_all_listing_histories()


def get_listing(listing_name):
    h = load_listing_history(listing_name)
    if not h:
        return None
    return build_listing_history_response(h)


def create_listing(listing_name, project_name=""):
    listing_name = ensure_listing_name(listing_name)
    existing = load_listing_history(listing_name)
    if existing:
        return {"created": False, "listing_name": listing_name}
    h = build_empty_listing_history(listing_name, project_name=project_name)
    h = save_listing_history(h)
    return {"created": True, "listing_name": listing_name}


def update_field(listing_name, field, value):
    h = load_listing_history(listing_name)
    if not h:
        return None
    if field == "price":
        h["price"] = str(value).strip()
    elif field == "quantity":
        try:
            h["quantity"] = int(value)
        except ValueError:
            return None
    elif field == "when_made":
        h["when_made"] = str(value).strip()
    elif field == "title":
        req2 = h.get("req2") or {}
        titles = req2.get("titles") or []
        new_title = str(value).strip()
        suffix = "| Kniri crochet"
        if not new_title.endswith(suffix):
            new_title = f"{new_title} {suffix}"
        titles.insert(0, new_title)
        req2["titles"] = titles
        req2["updated_at"] = req2.get("updated_at") or h.get("updated_at", "")
        h["req2"] = req2
    elif field == "description":
        req4 = h.get("req4") or {}
        req4["description_text"] = str(value).strip()
        req4["updated_at"] = req4.get("updated_at") or h.get("updated_at", "")
        h["req4"] = req4
    elif field == "tags":
        tags = [t.strip() for t in str(value).split(",") if t.strip()][:13]
        req3 = h.get("req3") or {}
        req3["tags"] = tags
        req3["details"] = [{"tag": t, "source": "manual"} for t in tags]
        req3["copy_text"] = ", ".join(tags)
        req3["updated_at"] = req3.get("updated_at") or h.get("updated_at", "")
        h["req3"] = req3
    else:
        return None
    h = save_listing_history(h)
    return build_listing_history_response(h)


def save_digital_file(listing_name, file_path, original_filename, file_size):
    import shutil
    from datetime import datetime
    from pathlib import Path
    from etsy_listing.shared import build_listing_asset_url

    h = load_listing_history(listing_name)
    if not h:
        return None

    asset_dir = get_listing_asset_dir(listing_name, "digital")
    asset_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_stem = Path(original_filename).stem.replace(" ", "_")
    suffix = Path(original_filename).suffix
    stored_filename = f"{timestamp}_{safe_stem}{suffix}"
    dest = asset_dir / stored_filename

    shutil.copy2(file_path, dest)

    h["digital_file"] = {
        "original_filename": original_filename,
        "stored_filename": stored_filename,
        "asset_url": build_listing_asset_url(listing_name, "digital", stored_filename),
        "size": file_size,
    }
    h = save_listing_history(h)
    return build_listing_history_response(h)


def format_listing_summary(listing):
    name = listing.get("listing_name", "?")
    project = listing.get("project_name", "")
    price = listing.get("price", "")
    title = listing.get("listing_title", "")
    desc_preview = listing.get("description_preview", "")
    image_count = listing.get("image_count", 0)
    tag_count = listing.get("tag_count", 0)
    qty = listing.get("quantity", 500)
    when_made = listing.get("when_made", "")
    digital = listing.get("digital_file")
    done = sum(1 for k in ["has_req1", "has_req2", "has_req3", "has_req4", "has_req5"] if listing.get(k))

    req_dots = ""
    colors = ["🔴", "🟣", "🟢", "🟡", "🔴"]
    for i, k in enumerate(["has_req1", "has_req2", "has_req3", "has_req4", "has_req5"]):
        req_dots += "●" if listing.get(k) else "○"

    lines = [
        f"<b>{html_mod.escape(name)}</b>",
    ]
    if project:
        lines.append(f"📁 Project: {html_mod.escape(project)}")
    lines.append(f"📊 Progress: {req_dots} ({done}/5)")
    if price:
        lines.append(f"💰 Price: <b>{html_mod.escape(str(price))} VND</b>")
    if title:
        lines.append(f"📝 Title: {html_mod.escape(title[:80])}")
    if tag_count:
        lines.append(f"🏷 Tags: {tag_count}/13")
    if desc_preview:
        lines.append(f"📝 Desc: {html_mod.escape(desc_preview[:80])}")
    lines.append(f"📦 Quantity: {qty}")
    if when_made:
        lines.append(f"📅 When Made: {html_mod.escape(when_made)}")
    lines.append(f"🖼 Images: {image_count}")
    if digital:
        lines.append(f"📎 Digital: {html_mod.escape(digital.get('original_filename', ''))}")

    return "\n".join(lines)


def format_listing_detail(h):
    name = h.get("listing_name", "?")
    project = h.get("project_name", "")
    price = h.get("price", "")
    qty = h.get("quantity", 500)
    when_made = h.get("when_made", "")
    digital = h.get("digital_file")

    req2 = h.get("req2") or {}
    req3 = h.get("req3") or {}
    req4 = h.get("req4") or {}
    req5 = h.get("req5") or {}

    title = (req4.get("listing_title") or req3.get("listing_title")
             or (req2.get("titles") or [None])[0] or "")
    desc = (req4.get("description_text") or "")[:200]
    tags = req3.get("tags") or []
    images = req5.get("images") or []

    req_dots = ""
    for k in ["req1", "req2", "req3", "req4", "req5"]:
        req_dots += "●" if h.get(k) else "○"
    done = sum(1 for k in ["req1", "req2", "req3", "req4", "req5"] if h.get(k))

    lines = [f"<b>📷 {html_mod.escape(name)}</b>"]
    if project:
        lines.append(f"📁 Project: {html_mod.escape(project)}")
    lines.append(f"📊 {req_dots} ({done}/5)")
    lines.append("")
    if title:
        lines.append(f"📝 Title: {html_mod.escape(title)}")
    if price:
        lines.append(f"💰 Price: <b>{html_mod.escape(str(price))} VND</b>")
    if tags:
        lines.append(f"🏷 Tags ({len(tags)}/13): {html_mod.escape(', '.join(tags[:8]))}")
        if len(tags) > 8:
            lines.append(f"   ...+{len(tags) - 8} more")
    if desc:
        lines.append(f"📝 Desc: {html_mod.escape(desc)}")
        if len(req4.get("description_text") or "") > 200:
            lines.append("   ...")
    lines.append(f"📦 Quantity: {qty}")
    lines.append(f"📅 When Made: {html_mod.escape(when_made)}")
    lines.append(f"🖼 Images: {len(images)}")
    if digital:
        size_kb = digital.get("size", 0) / 1024
        lines.append(f"📎 Digital: {html_mod.escape(digital['original_filename'])} ({size_kb:.0f} KB)")
    else:
        lines.append("📎 Digital: —")

    return "\n".join(lines)


def format_help():
    return (
        "<b>🤖 Etsy Listing Bot — Help</b>\n\n"
        "<b>Commands:</b>\n"
        "/start — Main menu\n"
        "/listings — View all listings\n"
        "/new &lt;name&gt; — Create a listing\n"
        "/listing &lt;name&gt; — View listing detail\n"
        "/help — This help message\n\n"
        "<b>Navigation:</b>\n"
        "• Tap inline buttons to navigate\n"
        "• Use ◀ Back buttons to go back\n"
        "• The bot edits messages in-place (chat stays clean)\n\n"
        "<b>Editing fields:</b>\n"
        "1. Open a listing → tap ✏️ Edit\n"
        "2. Choose a field to edit\n"
        "3. Type the new value (bot will ask for it)\n"
        "4. Value is saved automatically\n\n"
        "<b>AI Pipeline (REQ1–REQ5):</b>\n"
        "1. Open a listing → tap 🤖 AI Pipeline\n"
        "2. Choose which REQ to run\n"
        "3. Bot runs Gemini AI and shows results\n"
        "• REQ1: Keywords — needs REQ1 data first\n"
        "• REQ2: Titles — generates SEO titles\n"
        "• REQ3: Tags — generates 13 Etsy tags\n"
        "• REQ4: Description — generates listing description\n"
        "• REQ5: Alt Text — upload images first, then run\n\n"
        "<b>File uploads:</b>\n"
        "• For Images: send photos directly in chat\n"
        "• For Digital Files: send a file (PDF, ZIP, PNG)\n"
        "• Max file size: 50MB\n\n"
        "<b>Publishing:</b>\n"
        "• Open listing → tap 🚀 Publish to Etsy\n"
        "• Confirms before publishing\n"
        "• Sends notification on success\n"
    )
