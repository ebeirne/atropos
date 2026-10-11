"""Settings, read from backend/.env (or from real environment variables)."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Look for .env next to the app folder, not in whatever directory the server was started from.
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    gemini_model: str
    gemini_timeout_s: float
    gemini_thinking: str = "low"  # minimal, low, medium, high, or default (let Gemini decide)
    gemini_fallback_model: str = ""  # tried once when the main model is overloaded or too slow


def get_settings() -> Settings:
    return Settings(
        gemini_api_key=os.environ.get("GEMINI_API_KEY", "").strip(),
        gemini_model=os.environ.get("GEMINI_MODEL", "").strip() or "gemini-3.8-flash",
        gemini_timeout_s=float(os.environ.get("GEMINI_TIMEOUT_S", "20") or "20"),
        gemini_thinking=(os.environ.get("GEMINI_THINKING", "") or "low").strip().lower(),
        # Set GEMINI_FALLBACK_MODEL=off to retry the main model instead.
        gemini_fallback_model=(os.environ.get("GEMINI_FALLBACK_MODEL", "") or "gemini-3.5-flash-lite").strip(),
    )