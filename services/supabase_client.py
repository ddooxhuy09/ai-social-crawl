"""
Singleton Supabase client shared across the entire backend.
"""
import os
from supabase import create_client, Client

_supabase: Client | None = None


def get_supabase() -> Client:
    """Return the shared singleton Supabase client."""
    global _supabase
    if _supabase is None:
        _supabase = create_client(
            os.getenv("SUPABASE_URL", ""),
            os.getenv("SUPABASE_ANON_KEY", ""),
        )
    return _supabase


def new_supabase_client() -> Client:
    """Create a fresh per-request Supabase client (for isolated session operations)."""
    return create_client(
        os.getenv("SUPABASE_URL", ""),
        os.getenv("SUPABASE_ANON_KEY", ""),
    )
