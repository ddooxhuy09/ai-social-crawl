import os
import json
import urllib.request
import ssl


_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE


def _get_token():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set")
    return token


def _api(method, payload, timeout=35):
    token = _get_token()
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_ctx) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt < 2:
                import time
                time.sleep(2 ** attempt)
            else:
                print(f"[TELEGRAM API] {method} failed: {e}")
                return {"ok": False, "error": str(e)}


def get_chat_id():
    return os.getenv("TELEGRAM_CHAT_ID", "")


def send_message(chat_id, text, reply_markup=None, parse_mode="HTML"):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return _api("sendMessage", payload)


def edit_message(chat_id, message_id, text, reply_markup=None, parse_mode="HTML"):
    payload = {"chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return _api("editMessageText", payload)


def answer_callback(callback_query_id, text=None, show_alert=False):
    payload = {"callback_query_id": callback_query_id}
    if text:
        payload["text"] = text[:200]
    if show_alert:
        payload["show_alert"] = True
    return _api("answerCallbackQuery", payload)


def send_chat_action(chat_id, action="typing"):
    return _api("sendChatAction", {"chat_id": chat_id, "action": action})


def get_updates(offset=0, timeout=30):
    return _api("getUpdates", {
        "offset": offset,
        "timeout": timeout,
        "allowed_updates": ["message", "callback_query"],
    }, timeout=timeout + 5)


def get_file(file_id):
    return _api("getFile", {"file_id": file_id})


def download_file(file_path, dest_path):
    token = _get_token()
    url = f"https://api.telegram.org/file/bot{token}/{file_path}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=60, context=_ctx) as resp:
        with open(dest_path, "wb") as f:
            f.write(resp.read())
    return dest_path


def force_reply(placeholder="Type your answer..."):
    return {"force_reply": True, "input_field_placeholder": placeholder}


def inline_keyboard(buttons):
    return {"inline_keyboard": buttons}
