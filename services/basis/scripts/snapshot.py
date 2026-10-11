"""Dump the SQLite DB + calibration + every API response into data/snapshot/ for DEMO_MODE."""
import json, shutil, sys
from pathlib import Path
from fastapi.testclient import TestClient
from backend import config

def main():
    out = config.SNAPSHOT_DIR
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(config.DB_PATH, out / "basis.db")
    shutil.copy(config.CALIBRATION_PATH, out / "calibration.json")
    from backend.main import app
    c = TestClient(app)
    (out / "events.json").write_text(json.dumps(c.get("/events").json(), indent=1))
    (out / "calibration_api.json").write_text(json.dumps(c.get("/calibration").json()))
    (out / "divergence.json").write_text(json.dumps(c.get("/divergence").json(), indent=1))
    ev_dir = out / "events"; ev_dir.mkdir(exist_ok=True)
    for e in c.get("/events").json():
        (ev_dir / f"{e['id']}.json").write_text(json.dumps(c.get(f"/events/{e['id']}").json()))
    print(f"snapshot written to {out} ({len(list(ev_dir.iterdir()))} events)")

if __name__ == "__main__":
    sys.exit(main())
