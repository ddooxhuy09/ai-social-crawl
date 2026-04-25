import asyncio
import re
from pathlib import Path

# Paths
STORAGE_DIR = Path("history/user-favorite-items")
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# In-memory session store
_SESSIONS: dict[str, dict] = {}

def log_session(session_id: str, buyer_id: str, msg: str) -> None:
    session = _SESSIONS.get(session_id)
    if session:
        session["logs"].append(msg)
    print(f"[user-favorites][{buyer_id}] {msg}")

async def launch_stealth_browser(playwright):
    browser = await playwright.chromium.launch(
        headless=False,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-web-security",
            "--disable-infobars",
            "--window-size=1366,768"
        ],
    )
    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0"
        ),
        viewport={"width": 1366, "height": 768},
        locale="en-US",
        timezone_id="America/New_York",
        java_script_enabled=True,
    )
    await context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
    """)
    return browser, context

async def check_and_solve_captcha(page, session_id: str, buyer_id: str) -> bool:
    session = _SESSIONS.get(session_id)
    if not session:
        return False
        
    captcha_el = await page.query_selector(
        "iframe[src*='hcaptcha'], iframe[src*='datadome'], #datadome, #hcaptcha"
    )
    if captcha_el or "datadome" in page.url or "challenge" in page.url:
        log_session(session_id, buyer_id, ">>> CAPTCHA detected! Please solve it in the browser or via API.")
        session["captcha_required"] = True
        session["status"] = "captcha_required"
        captcha_event: asyncio.Event = session["_captcha_event"]
        captcha_event.clear()
        
        # Wait for user to trigger captcha-solved endpoint
        await captcha_event.wait()
        
        session["captcha_required"] = False
        session["status"] = "running"
        log_session(session_id, buyer_id, "CAPTCHA solved/bypassed — continuing...")
        await page.wait_for_timeout(2000)
        return True
    return False

async def extract_auth_tokens(page) -> tuple[str, int]:
    csrf_token, raw_user_id = await page.evaluate("""
        () => {
            const text = [...document.querySelectorAll('script')]
                .map(s => s.textContent).join('\\n');
            const csrf = (text.match(/"csrf_nonce"\\s*:\\s*"([^"]+)"/) ||
                          text.match(/"csrfToken"\\s*:\\s*"([^"]+)"/) || [])[1] || null;
            const uid  = (text.match(/"viewed_user_id"\\s*:\\s*(\\d+)/) ||
                          text.match(/"user_id"\\s*:\\s*(\\d+)/) || [])[1] || null;
            return [csrf, uid ? parseInt(uid) : null];
        }
    """)
    
    if not csrf_token:
        html = await page.content()
        m = re.search(r'"csrf_nonce"\s*:\s*"([^"]+)"', html) or \
            re.search(r'"csrfToken"\s*:\s*"([^"]+)"', html)
        if m:
            csrf_token = m.group(1)

    if not raw_user_id:
        html = await page.content()
        m = re.search(r'"viewed_user_id"\s*:\s*(\d+)', html)
        if m:
            raw_user_id = int(m.group(1))

    return csrf_token, (int(raw_user_id) if raw_user_id else None)
