"""
Telegram Notification Module (Integrated)
Gửi thông báo về Telegram mà không làm block Worker.
"""

import os
import urllib.request
import urllib.parse
import json
import html
import threading

def _send_telegram_sync(message: str):
    """
    Hệ thống gọi ngầm hàm này ở một Thread khác để gửi API tới Telegram.
    Retry tối đa 3 lần nếu gặp lỗi network tạm thời.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("[TELEGRAM] Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong file .env")
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
    }).encode("utf-8")
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                pass  # Lặng lẽ gửi
            return  # Gửi thành công
        except Exception as e:
            if attempt < 2:
                import time
                time.sleep(2 ** attempt)  # 1s, 2s
            else:
                print(f"[TELEGRAM] Gửi thất bại sau 3 lần thử: {e}")


def send_telegram(message: str):
    """
    Bắn tin nhắn thông qua một Thread riêng (Fire-and-forget), 
    tránh block event loop của FastAPI hoặc Worker.
    """
    threading.Thread(target=_send_telegram_sync, args=(message,), daemon=True).start()


# ── Các hàm tiện ích ───────────────────────────────────────────

def notify_step1_done(project_name: str, item_title: str):
    """Gọi sau khi user hoàn thành việc chọn sản phẩm ở Step 1"""
    msg = (
        f"✅ <b>Step 1 hoàn thành!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"🎯 Sản phẩm gốc: {html.escape(item_title)}"
    )
    send_telegram(msg)


def notify_ai_image_done(project_name: str, task_title: str, done: int, total: int):
    """Gọi khi hoàn thành vẽ ảnh AI bằng prompt"""
    all_done = (done >= total) and (total > 0)
    icon = "🎉" if all_done else "🖌"
    msg = (
        f"{icon} <b>[Redesign Step 2] Vừa render AI xong bức ảnh!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"🖼 Task: {html.escape(task_title)}\n"
        f"📊 Tiến độ hiện tại: {done}/{total}"
    )
    if all_done:
        msg += "\n✨ <b>Tất cả các task vẽ ảnh AI đã hoàn thành!</b>"
    send_telegram(msg)


def notify_crawl_all_done(project_name: str, keyword: str):
    """Báo cáo 1 lần khi crawl xong hết nhóm crawl_keyword / image"""
    msg = (
        f"✅ <b>[Crawl Task] Đã hoàn thành!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"🔑 Keyword: <b>{html.escape(keyword)}</b>\n"
        f"👉 Trở lại app để kiểm tra kết quả ngay thôi."
    )
    send_telegram(msg)


def notify_step3_done(project_name: str, filename: str):
    """Gọi sau khi xuất file báo cáo cuối cùng"""
    msg = (
        f"🎉 <b>Step 3 hoàn thành!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"📄 Báo cáo hệ thống xuất thành file: <code>{html.escape(filename)}</code>\n"
        f"👉 Tới project để tải ngay file Word về máy thôi."
    )
    send_telegram(msg)


def notify_error(project_name: str, step: str, error: str):
    """Báo cáo khẩn khi luồng bị dính lỗi Exception"""
    msg = (
        f"❌ <b>Lỗi phát sinh tại nhánh {html.escape(step)}!</b>\n"
        f"📁 Project: <b>{html.escape(project_name)}</b>\n"
        f"⚠️ Chi tiết mã lỗi:\n<code>{html.escape(str(error)[:400])}</code>"
    )
    send_telegram(msg)
