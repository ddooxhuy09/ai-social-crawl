"""
Shared utilities for all crawler modules.
"""
import asyncio


def _run_async(coro):
    """
    Drop-in replacement for asyncio.run() that avoids hanging on
    shutdown_default_executor() — which blocks indefinitely when
    undetected_playwright leaves internal WebSocket threads alive.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        try:
            pending = asyncio.all_tasks(loop)
            if pending:
                for t in pending:
                    t.cancel()
                loop.run_until_complete(asyncio.wait(pending, timeout=5.0))
        except Exception:
            pass
        try:
            loop.close()
        except Exception:
            pass
