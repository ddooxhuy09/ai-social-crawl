import asyncio
import os

from telegram_bot import api as tg
from telegram_bot.handlers import handle_callback, handle_message_update, handle_file_message


async def start_bot_polling():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        print("[TELEGRAM BOT] TELEGRAM_BOT_TOKEN not set, bot disabled.")
        return

    print("[TELEGRAM BOT] Starting polling...")
    offset = 0

    while True:
        try:
            resp = await asyncio.to_thread(tg.get_updates, offset, 30)

            if not resp.get("ok"):
                await asyncio.sleep(5)
                continue

            for update in resp.get("result", []):
                offset = update["update_id"] + 1

                if "callback_query" in update:
                    try:
                        handle_callback(update["callback_query"])
                    except Exception as e:
                        print(f"[TELEGRAM BOT] Callback error: {e}")

                elif "message" in update:
                    msg = update["message"]
                    try:
                        if handle_file_message(msg):
                            continue
                        handle_message_update(msg)
                    except Exception as e:
                        print(f"[TELEGRAM BOT] Message error: {e}")

        except asyncio.CancelledError:
            print("[TELEGRAM BOT] Polling cancelled.")
            break
        except Exception as e:
            print(f"[TELEGRAM BOT] Polling error: {e}")
            await asyncio.sleep(5)
