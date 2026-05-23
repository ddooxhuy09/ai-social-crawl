import asyncio
import tempfile
import os

from telegram_bot import api as tg
from telegram_bot import keyboards as kb
from telegram_bot import actions


_user_state = {}


def _set_state(chat_id, state, data=None):
    _user_state[chat_id] = {"state": state, "data": data or {}}


def _get_state(chat_id):
    return _user_state.get(chat_id, {})


def _clear_state(chat_id):
    _user_state.pop(chat_id, None)


def handle_command(chat_id, text, message_id=None):
    parts = text.strip().split(maxsplit=1)
    cmd = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""

    if cmd == "/start":
        handle_main_menu(chat_id, message_id)
    elif cmd == "/help":
        tg.send_message(chat_id, actions.format_help())
    elif cmd == "/listings":
        handle_list(chat_id, 1, message_id)
    elif cmd == "/new":
        if arg:
            handle_create_listing(chat_id, arg)
        else:
            _set_state(chat_id, "awaiting_new_name")
            tg.send_message(
                chat_id,
                "📝 Enter a name for the new listing:",
                reply_markup=tg.force_reply("e.g. Baby Bunny Pattern"),
            )
    elif cmd == "/listing":
        if arg:
            handle_view(chat_id, arg, message_id)
        else:
            tg.send_message(chat_id, "Usage: /listing &lt;name&gt;")
    else:
        pass


def handle_main_menu(chat_id, message_id=None):
    text = (
        "<b>🤖 Etsy Listing Bot</b>\n\n"
        "Manage your Etsy listings directly from Telegram.\n"
        "Use /help for a full guide."
    )
    if message_id:
        tg.edit_message(chat_id, message_id, text, kb.main_menu())
    else:
        tg.send_message(chat_id, text, kb.main_menu())


def handle_list(chat_id, page=1, message_id=None):
    listings = actions.get_all_listings()
    if not listings:
        text = "📋 No listings yet.\n\nCreate one with /new or tap the button below."
        markup = kb.kb([[kb.btn("➕ New Listing", "new")], [kb.btn("◀ Main", "main")]])
        if message_id:
            tg.edit_message(chat_id, message_id, text, markup)
        else:
            tg.send_message(chat_id, text, markup)
        return

    text = f"📋 <b>Your Listings</b> ({len(listings)} total)\n\nTap a listing to view details."
    markup = kb.listing_list(listings, page)
    if message_id:
        tg.edit_message(chat_id, message_id, text, markup)
    else:
        tg.send_message(chat_id, text, markup)


def handle_view(chat_id, listing_name, message_id=None):
    h = actions.get_listing(listing_name)
    if not h:
        text = f"❌ Listing <b>{listing_name}</b> not found."
        if message_id:
            tg.edit_message(chat_id, message_id, text, kb.back_only("list:1"))
        else:
            tg.send_message(chat_id, text)
        return

    text = actions.format_listing_detail(h)
    markup = kb.listing_detail(listing_name, h)
    if message_id:
        tg.edit_message(chat_id, message_id, text, markup)
    else:
        tg.send_message(chat_id, text, markup)


def handle_edit_menu(chat_id, listing_name, message_id):
    h = actions.get_listing(listing_name)
    if not h:
        tg.edit_message(chat_id, message_id, f"❌ Listing not found.", kb.back_only("list:1"))
        return

    text = f"✏️ <b>Edit:</b> {listing_name}\n\nWhich field do you want to edit?"
    tg.edit_message(chat_id, message_id, text, kb.edit_menu(listing_name, h))


def handle_edit_field(chat_id, listing_name, field, message_id=None):
    h = actions.get_listing(listing_name)
    if not h:
        tg.send_message(chat_id, f"❌ Listing not found.")
        return

    if field == "when":
        text = f"📅 Select <b>When Made</b> for {listing_name}:"
        markup = kb.when_made_menu(listing_name)
        if message_id:
            tg.edit_message(chat_id, message_id, text, markup)
        else:
            tg.send_message(chat_id, text, markup)
        return

    field_labels = {
        "price": ("💰 Price", "Enter new price (VND)", "e.g. 150000"),
        "title": ("📝 Title", "Enter new title", "e.g. Crochet Bunny Pattern"),
        "desc": ("📝 Description", "Enter new description", "Paste description text..."),
        "tags": ("🏷 Tags", "Enter tags (comma-separated, max 13)", "tag1, tag2, tag3"),
        "qty": ("📦 Quantity", "Enter new quantity", "e.g. 500"),
        "images": ("🖼 Images", "Send photos to add as listing images.\nOne at a time or as an album.", None),
        "digital": ("📎 Digital File", "Send the digital file (PDF, ZIP, PNG)", None),
    }

    label, prompt, placeholder = field_labels.get(field, (field, f"Enter new {field}", ""))
    current_val = _get_current_field_value(h, field)

    text = f"{label}\n\nListing: <b>{listing_name}</b>"
    if current_val and field not in ("images", "digital"):
        text += f"\nCurrent: {current_val}"
    text += f"\n\n{prompt}"

    if field in ("images", "digital"):
        _set_state(chat_id, f"awaiting_file:{listing_name}:{field}")
        markup = kb.back_only(f"edit:{listing_name}")
        if message_id:
            tg.edit_message(chat_id, message_id, text, markup)
        else:
            tg.send_message(chat_id, text, markup)
    else:
        _set_state(chat_id, f"awaiting_input:{listing_name}:{field}")
        if message_id:
            tg.edit_message(chat_id, message_id, text, kb.back_only(f"edit:{listing_name}"))
        tg.send_message(
            chat_id,
            prompt,
            reply_markup=tg.force_reply(placeholder),
        )


def _get_current_field_value(h, field):
    if field == "price":
        return h.get("price", "")
    elif field == "title":
        req2 = h.get("req2") or {}
        titles = req2.get("titles") or []
        return titles[0] if titles else ""
    elif field == "desc":
        return (h.get("req4") or {}).get("description_text", "")[:100]
    elif field == "tags":
        tags = (h.get("req3") or {}).get("tags") or []
        return ", ".join(tags[:8])
    elif field == "qty":
        return str(h.get("quantity", 500))
    return ""


def handle_save_input(chat_id, text):
    state = _get_state(chat_id)
    state_str = state.get("state", "")
    if not state_str.startswith("awaiting_input:"):
        return False

    _, listing_name, field = state_str.split(":", 2)
    value = text.strip()
    if not value:
        tg.send_message(chat_id, "❌ Empty value. Try again.")
        return True

    result = actions.update_field(listing_name, field, value)
    _clear_state(chat_id)

    if result:
        tg.send_message(chat_id, f"✅ <b>{field}</b> updated for <b>{listing_name}</b>!")
        handle_view(chat_id, listing_name)
    else:
        tg.send_message(chat_id, "❌ Failed to save. Check the field name.")
    return True


def handle_save_when_made(chat_id, listing_name, value, message_id):
    result = actions.update_field(listing_name, "when_made", value)
    if result:
        tg.edit_message(chat_id, message_id, f"✅ When Made set to <b>{value}</b>!", kb.back_only(f"view:{listing_name}"))
    else:
        tg.edit_message(chat_id, message_id, "❌ Failed to save.", kb.back_only(f"edit:{listing_name}"))


def handle_create_listing(chat_id, name):
    result = actions.create_listing(name)
    if result.get("created"):
        tg.send_message(chat_id, f"✅ Listing <b>{name}</b> created!")
        handle_view(chat_id, name)
    else:
        tg.send_message(chat_id, f"⚠️ Listing <b>{name}</b> already exists.")


def handle_file_upload(chat_id, file_id, file_name, file_size):
    state = _get_state(chat_id)
    state_str = state.get("state", "")
    if not state_str.startswith("awaiting_file:"):
        return False

    _, listing_name, field = state_str.split(":", 2)

    tg.send_chat_action(chat_id, "upload_document")
    tg.send_message(chat_id, f"⏳ Downloading {file_name}...")

    try:
        file_info = tg.get_file(file_id)
        if not file_info.get("ok"):
            raise Exception("getFile failed")

        file_path = file_info["result"]["file_path"]

        with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file_name}") as tmp:
            tmp_path = tmp.name
        tg.download_file(file_path, tmp_path)

        if field == "digital":
            result = actions.save_digital_file(listing_name, tmp_path, file_name, file_size)
            _clear_state(chat_id)
            if result:
                tg.send_message(chat_id, f"✅ Digital file <b>{file_name}</b> uploaded!")
                handle_view(chat_id, listing_name)
            else:
                tg.send_message(chat_id, "❌ Failed to save digital file.")
        elif field == "images":
            from pathlib import Path
            from fastapi import UploadFile
            from starlette.datastructures import UploadFile as StarletteUploadFile
            import io

            asset_dir_path = actions.get_listing_asset_dir(listing_name, "req5")
            asset_dir_path.mkdir(parents=True, exist_ok=True)

            state_data = state.get("data", {})
            uploaded_images = state_data.get("uploaded_images", [])
            uploaded_images.append(tmp_path)
            state_data["uploaded_images"] = uploaded_images
            _set_state(chat_id, f"awaiting_file:{listing_name}:images", state_data)

            tg.send_message(
                chat_id,
                f"📷 Image saved ({len(uploaded_images)} total). Send more or tap Done.",
                kb.kb([
                    [kb.btn("✅ Done — Run REQ5", f"ai:{listing_name}:req5")],
                    [kb.btn("◀ Cancel", f"edit:{listing_name}")],
                ]),
            )

        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    except Exception as e:
        _clear_state(chat_id)
        tg.send_message(chat_id, f"❌ Upload failed: {str(e)[:200]}")

    return True


def handle_ai_menu(chat_id, listing_name, message_id):
    h = actions.get_listing(listing_name)
    if not h:
        tg.edit_message(chat_id, message_id, "❌ Listing not found.", kb.back_only("list:1"))
        return

    text = f"🤖 <b>AI Pipeline:</b> {listing_name}\n\nChoose which REQ to run:"
    tg.edit_message(chat_id, message_id, text, kb.ai_menu(listing_name, h))


async def handle_run_req(chat_id, listing_name, req_num, message_id):
    h = actions.get_listing(listing_name)
    if not h:
        tg.send_message(chat_id, "❌ Listing not found.")
        return

    if not h.get("req1") and req_num != 1:
        tg.send_message(chat_id, "❌ Run REQ1 first before running other REQs.")
        return

    tg.send_chat_action(chat_id, "typing")
    tg.send_message(chat_id, f"⏳ Running REQ{req_num} for <b>{listing_name}</b>...\nThis may take a moment.")

    try:
        if req_num == 1:
            from etsy_listing.req1_list_keywords import KeywordManualRequest, save_manual_keywords
            req1 = h.get("req1") or {}
            existing_keywords = [item["keyword"] for item in (req1.get("data") or [])]
            if existing_keywords:
                kw_str = ", ".join(existing_keywords)
            else:
                kw_str = h.get("seed_keyword") or listing_name
            result = await save_manual_keywords(KeywordManualRequest(
                listing_name=listing_name,
                keywords=kw_str,
                seed_keyword=h.get("seed_keyword") or "manual",
            ))

        elif req_num == 2:
            from etsy_listing.req2_generate_title_listing import GenerateTitlesRequest, generate_listing_titles
            result = await generate_listing_titles(GenerateTitlesRequest(
                listing_name=listing_name,
                custom_attributes=(h.get("req3") or {}).get("custom_attributes", ""),
            ))

        elif req_num == 3:
            req2 = h.get("req2") or {}
            title = (req2.get("titles") or [None])[0] or h.get("seed_keyword", "")
            if not title:
                tg.send_message(chat_id, "❌ No title found. Run REQ2 first or set a title manually.")
                return
            from etsy_listing.req3_generate_tags import GenerateTagsRequest, generate_listing_tags
            result = await generate_listing_tags(GenerateTagsRequest(
                listing_name=listing_name,
                listing_title=title,
                custom_attributes=(h.get("req2") or {}).get("custom_attributes", ""),
            ))

        elif req_num == 4:
            req2 = h.get("req2") or {}
            title = (req2.get("titles") or [None])[0] or h.get("seed_keyword", "")
            if not title:
                tg.send_message(chat_id, "❌ No title found. Run REQ2 first or set a title manually.")
                return
            req4 = h.get("req4") or {}
            from etsy_listing.req4_generate_description_listing import GenerateDescriptionRequest, generate_listing_description
            result = await generate_listing_description(GenerateDescriptionRequest(
                listing_name=listing_name,
                listing_title=title,
                materials_skill_level=req4.get("materials_skill_level", ""),
                finished_sizes=req4.get("finished_sizes", ""),
                story_ideas=req4.get("story_ideas", ""),
                shop_link=req4.get("shop_link", ""),
            ))

        elif req_num == 5:
            from fastapi import UploadFile
            from pathlib import Path
            import io

            state = _get_state(chat_id)
            state_data = state.get("data", {})
            uploaded_paths = state_data.get("uploaded_images", [])

            files_to_upload = []
            for path in uploaded_paths:
                file_bytes = Path(path).read_bytes()
                filename = Path(path).name
                uf = UploadFile(filename=filename, file=io.BytesIO(file_bytes))
                files_to_upload.append(uf)

            if not files_to_upload:
                req5 = h.get("req5") or {}
                if not req5.get("images"):
                    tg.send_message(chat_id, "❌ No images. Upload images first via Edit → Images.")
                    return

            from etsy_listing.req5_generate_image_alt_text import generate_image_alt_texts
            from starlette.datastructures import Headers

            form_files = []
            for uf in files_to_upload:
                uf.headers = Headers({"content-type": "image/jpeg"})
                form_files.append(uf)

            result = await generate_image_alt_texts(
                listing_name=listing_name,
                files=form_files,
            )

            _clear_state(chat_id)
            for p in uploaded_paths:
                try:
                    os.unlink(p)
                except OSError:
                    pass
        else:
            tg.send_message(chat_id, "❌ Unknown REQ number.")
            return

        h = actions.get_listing(listing_name)
        text = f"✅ <b>REQ{req_num}</b> completed for <b>{listing_name}</b>!\n\n"
        text += actions.format_listing_detail(h)
        tg.send_message(chat_id, text, kb.listing_detail(listing_name, h))

    except Exception as e:
        tg.send_message(chat_id, f"❌ REQ{req_num} failed: <code>{str(e)[:300]}</code>")


def handle_publish_confirm(chat_id, listing_name, message_id):
    h = actions.get_listing(listing_name)
    if not h:
        tg.edit_message(chat_id, message_id, "❌ Listing not found.")
        return

    text = f"🚀 <b>Publish to Etsy?</b>\n\n{actions.format_listing_detail(h)}\n\nThis will trigger the Save as Draft automation."
    tg.edit_message(chat_id, message_id, text, kb.confirm_publish(listing_name))


def handle_publish_execute(chat_id, listing_name):
    import projects.telegram_notify as tg_notify
    h = actions.get_listing(listing_name)
    if not h:
        tg.send_message(chat_id, "❌ Listing not found.")
        return

    tg.send_message(chat_id, "⏳ Publishing to Etsy... (automation running)")
    try:
        tg_notify.notify_listing_done(h.get("project_name", ""), h.get("listing_name", ""))
        tg.send_message(chat_id, f"✅ <b>Published!</b> Listing <b>{listing_name}</b> has been sent to Etsy.")
    except Exception as e:
        tg.send_message(chat_id, f"❌ Publish failed: {str(e)[:200]}")


def handle_callback(callback_query):
    cq = callback_query
    chat_id = cq["message"]["chat"]["id"]
    message_id = cq["message"]["message_id"]
    query_id = cq["id"]
    data = cq.get("data", "")

    tg.answer_callback(query_id)

    if data == "noop":
        return

    parts = data.split(":")

    if data == "main":
        handle_main_menu(chat_id, message_id)

    elif data == "help":
        tg.send_message(chat_id, actions.format_help())

    elif data == "new":
        _set_state(chat_id, "awaiting_new_name")
        tg.edit_message(
            chat_id, message_id,
            "📝 Enter a name for the new listing:",
            {"inline_keyboard": [[kb.btn("◀ Cancel", "main")]]},
        )
        tg.send_message(
            chat_id,
            "Type the listing name:",
            reply_markup=tg.force_reply("e.g. Baby Bunny Pattern"),
        )

    elif parts[0] == "list":
        page = int(parts[1]) if len(parts) > 1 else 1
        handle_list(chat_id, page, message_id)

    elif parts[0] == "view" and len(parts) == 2:
        handle_view(chat_id, parts[1], message_id)

    elif parts[0] == "edit" and len(parts) == 2:
        handle_edit_menu(chat_id, parts[1], message_id)

    elif parts[0] == "edit" and len(parts) == 3:
        handle_edit_field(chat_id, parts[1], parts[2], message_id)

    elif parts[0] == "edit" and len(parts) == 4 and parts[2] == "when":
        handle_save_when_made(chat_id, parts[1], parts[3], message_id)

    elif parts[0] == "ai" and len(parts) == 2:
        handle_ai_menu(chat_id, parts[1], message_id)

    elif parts[0] == "ai" and len(parts) == 3:
        req_num = int(parts[2].replace("req", ""))
        asyncio.ensure_future(handle_run_req(chat_id, parts[1], req_num, message_id))

    elif parts[0] == "pub" and len(parts) == 2:
        handle_publish_confirm(chat_id, parts[1], message_id)

    elif parts[0] == "pub" and len(parts) == 3 and parts[2] == "confirm":
        handle_publish_execute(chat_id, parts[1])

    elif parts[0] == "status":
        h = actions.get_listing(parts[1])
        if h:
            text = f"📊 <b>Status:</b> {parts[1]}\n\n{actions.format_listing_detail(h)}"
            tg.edit_message(chat_id, message_id, text, kb.listing_detail(parts[1], h))


def handle_message_update(message):
    chat_id = message["chat"]["id"]
    text = message.get("text", "").strip()

    state = _get_state(chat_id)
    state_str = state.get("state", "")

    if state_str == "awaiting_new_name":
        if text:
            _clear_state(chat_id)
            handle_create_listing(chat_id, text)
        return

    if state_str.startswith("awaiting_input:"):
        if text:
            handle_save_input(chat_id, text)
        return

    if text.startswith("/"):
        handle_command(chat_id, text)


def handle_file_message(message):
    chat_id = message["chat"]["id"]

    if "document" in message:
        doc = message["document"]
        file_id = doc["file_id"]
        file_name = doc.get("file_name", "file")
        file_size = doc.get("file_size", 0)
        handle_file_upload(chat_id, file_id, file_name, file_size)
        return True

    if "photo" in message:
        photos = message["photo"]
        if photos:
            photo = photos[-1]
            file_id = photo["file_id"]
            handle_file_upload(chat_id, file_id, f"image_{photo['file_unique_id']}.jpg", photo.get("file_size", 0))
            return True

    return False
