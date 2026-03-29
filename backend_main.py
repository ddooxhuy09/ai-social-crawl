import sys
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from supabase import create_client

from projects.worker import task_worker_loop

app = FastAPI(title="Pinterest Crawler API")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(task_worker_loop())

# ── Auth middleware ────────────────────────────────────────────────────────────

_supabase = None

def _get_supabase():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_ANON_KEY"))
    return _supabase


_SKIP_AUTH_PREFIXES = ("/api/auth/", "/health", "/avatars/", "/api/henull_proxy/")

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # Only protect /api/* routes, skip auth endpoints
    if path.startswith("/api/") and not any(path.startswith(p) for p in _SKIP_AUTH_PREFIXES):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        token = auth_header[7:]
        try:
            user = _get_supabase().auth.get_user(token)
            if not user or not user.user:
                return JSONResponse({"detail": "Invalid token"}, status_code=401)
        except Exception:
            return JSONResponse({"detail": "Invalid token"}, status_code=401)
    return await call_next(request)

_cors_env = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173")
allowed_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ── Routers ────────────────────────────────────────────────────────────────────

# Auth: /api/auth/login, /api/auth/logout
from auth.router import router as auth_router
app.include_router(auth_router)

# Crawl page: /api/search, /api/history/*, /api/pinterest/*
from crawlers.router import router as crawlers_router
app.include_router(crawlers_router)

# AI image generation & CLIP search: /api/generate-image/*, /api/search_by_image, /api/search_by_prompt
from create_image_by_ai.router import router as image_router
app.include_router(image_router)

# Chat AI session history: /api/chat-ai/*
from chat_ai.router import router as chat_router
app.include_router(chat_router)

# Project management: /api/projects/*
from projects.router import router as projects_router
app.include_router(projects_router)

# Product requirements: /api/requirements/*
from product_requirements.router import router as requirements_router
app.include_router(requirements_router)

# Etsy listing generation: /api/listing/*
from etsy_listing.listings_router import router as listings_router
app.include_router(listings_router)

# Etsy Hunt (HEnull): /api/etsy_hunt/*, /api/open_henull
from etsy_hunt.router import router as etsy_hunt_router
app.include_router(etsy_hunt_router)


# ── Avatar static files ────────────────────────────────────────────────────────
_avatars_dir = Path(__file__).resolve().parent / "history" / "avatars"
_avatars_dir.mkdir(parents=True, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=str(_avatars_dir)), name="avatars")


# ── Frontend SPA Fallback ──────────────────────────────────────────────────────
# Serves the built React app; falls back to index.html for client-side routing.

def _get_frontend_dist_dir() -> Path | None:
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).resolve().parent
    dist = base / "frontend_dist"
    if dist.exists() and (dist / "index.html").exists():
        return dist
    dev_dist = base / "frontend" / "dist"
    if dev_dist.exists() and (dev_dist / "index.html").exists():
        return dev_dist
    return None


_frontend_dist = _get_frontend_dist_dir()
if _frontend_dist:

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api") or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        root = _frontend_dist.resolve()
        path = (root / full_path).resolve()
        if path.is_file() and str(path.resolve()).startswith(str(root)):
            return FileResponse(path)
        return FileResponse(
            _frontend_dist / "index.html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            }
        )


# Run with:
#   uvicorn backend_main:app --reload --port 8000
