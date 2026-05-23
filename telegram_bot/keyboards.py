from telegram_bot.api import inline_keyboard as kb


def btn(text, data):
    return {"text": text, "callback_data": data}


def main_menu():
    return kb([
        [btn("📋 Listings", "list:1"), btn("➕ New Listing", "new")],
        [btn("❓ Help", "help")],
    ])


def listing_list(listings, page=1, per_page=5):
    total = len(listings)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    start = (page - 1) * per_page
    page_items = listings[start:start + per_page]

    rows = []
    for item in page_items:
        slug = item.get("listing_name", "")
        done = sum(1 for k in ["has_req1", "has_req2", "has_req3", "has_req4", "has_req5"] if item.get(k))
        label = item.get("listing_title") or slug
        if len(label) > 30:
            label = label[:27] + "..."
        price = item.get("price", "")
        price_str = f" · {price}" if price else ""
        rows.append([btn(f"{label} ({done}/5){price_str}", f"view:{slug}")])

    nav_row = []
    if page > 1:
        nav_row.append(btn("◀ Prev", f"list:{page - 1}"))
    nav_row.append(btn(f"{page}/{total_pages}", "noop"))
    if page < total_pages:
        nav_row.append(btn("Next ▶", f"list:{page + 1}"))
    rows.append(nav_row)

    rows.append([btn("➕ New Listing", "new"), btn("◀ Main", "main")])
    return kb(rows)


def listing_detail(listing_name, listing):
    rows = [
        [btn("✏️ Edit Fields", f"edit:{listing_name}"), btn("🤖 AI Pipeline", f"ai:{listing_name}")],
        [btn("🚀 Publish to Etsy", f"pub:{listing_name}"), btn("📊 Status", f"status:{listing_name}")],
        [btn("◀ Back to Listings", "list:1")],
    ]
    return kb(rows)


def edit_menu(listing_name, listing):
    has_images = bool(listing.get("req5", {}).get("images"))
    has_digital = bool(listing.get("digital_file"))
    img_label = f"🖼 Images {'✅' if has_images else ''}"
    df_label = f"📎 Digital File {'✅' if has_digital else ''}"
    return kb([
        [btn("💰 Price", f"edit:{listing_name}:price"), btn("📝 Title", f"edit:{listing_name}:title")],
        [btn("🏷 Tags", f"edit:{listing_name}:tags"), btn("📝 Description", f"edit:{listing_name}:desc")],
        [btn("📦 Quantity", f"edit:{listing_name}:qty")],
        [btn("📅 When Made", f"edit:{listing_name}:when")],
        [btn(img_label, f"edit:{listing_name}:images")],
        [btn(df_label, f"edit:{listing_name}:digital")],
        [btn("◀ Cancel", f"view:{listing_name}")],
    ])


def when_made_menu(listing_name):
    options = [
        ("2020 – 2026", "2020_2026"), ("2010 – 2019", "2010_2019"),
        ("2000 – 2009", "2000_2009"), ("Before 2000", "before_2000"),
        ("1990s", "1990s"), ("1980s", "1980s"),
        ("1970s", "1970s"), ("1960s", "1960s"),
        ("1950s", "1950s"), ("Before 1950", "before_1950"),
    ]
    rows = []
    for i in range(0, len(options), 2):
        row = [btn(options[i][0], f"edit:{listing_name}:when:{options[i][1]}")]
        if i + 1 < len(options):
            row.append(btn(options[i + 1][0], f"edit:{listing_name}:when:{options[i + 1][1]}"))
        rows.append(row)
    rows.append([btn("◀ Cancel", f"edit:{listing_name}")])
    return kb(rows)


def ai_menu(listing_name, listing):
    reqs = []
    for i, key in enumerate(["req1", "req2", "req3", "req4", "req5"], 1):
        done = bool(listing.get(key))
        icon = "✅" if done else "⬜"
        reqs.append((f"{icon} REQ{i} {'✅' if done else ''}", f"ai:{listing_name}:req{i}"))
    rows = []
    for i in range(0, len(reqs), 2):
        row = [btn(reqs[i][0], reqs[i][1])]
        if i + 1 < len(reqs):
            row.append(btn(reqs[i + 1][0], reqs[i + 1][1]))
        rows.append(row)
    rows.append([btn("▶️ Run All Missing", f"ai:{listing_name}:all")])
    rows.append([btn("◀ Back", f"view:{listing_name}")])
    return kb(rows)


def confirm_publish(listing_name):
    return kb([
        [btn("✅ Yes, Publish", f"pub:{listing_name}:confirm")],
        [btn("❌ Cancel", f"view:{listing_name}")],
    ])


def back_only(callback_data):
    return kb([[btn("◀ Back", callback_data)]])
