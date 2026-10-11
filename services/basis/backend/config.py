import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
SNAPSHOT_DIR = DATA_DIR / "snapshot"
DB_PATH = DATA_DIR / "basis.db"
EVENTS_PATH = DATA_DIR / "events.json"
CALIBRATION_PATH = DATA_DIR / "calibration.json"

DEMO_MODE = os.getenv("DEMO_MODE", "0") in ("1", "true", "True")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
REFRESH_SECONDS = int(os.getenv("REFRESH_SECONDS", "60"))

for d in (CACHE_DIR, SNAPSHOT_DIR):
    d.mkdir(parents=True, exist_ok=True)
