from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_path: str
    supabase_url: str
    supabase_service_role_key: str
    gemini_api_key: str
    llm_model: str
    frontend_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        default_db = Path(__file__).resolve().parents[1] / "callguide.db"
        origins = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
        return cls(
            database_path=os.getenv("DATABASE_PATH", str(default_db)),
            supabase_url=os.getenv("SUPABASE_URL", "").strip(),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip(),
            gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
            llm_model=os.getenv("LLM_MODEL", "gemini-3.8-flash").strip() or "gemini-3.8-flash",
            frontend_origins=tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
        )


def is_remote_database(settings: Settings) -> bool:
    return bool(settings.supabase_url or settings.supabase_service_role_key)
