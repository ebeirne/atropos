"""P2: export PNGs of the headline charts for the pitch deck using headless Chrome.
Usage: python -m scripts.export_charts [--base http://localhost:5174] [--out data/charts]
"""
import argparse, subprocess, shutil, sys
from pathlib import Path

CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium", "chrome"]
SHOTS = [("calibration", "/calibration", 1400, 1100), ("fomc-2026-09", "/events/fomc-2026-09", 1400, 720),
         ("fomc-2026-12", "/events/fomc-2026-12", 1400, 720), ("overview", "/", 1400, 1500)]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--base", default="http://localhost:5174"); ap.add_argument("--out", default="data/charts")
    a = ap.parse_args()
    exe = next((c for c in CHROME if Path(c).exists() or shutil.which(c)), None)
    if not exe:
        print("no Chrome found"); return 1
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for name, path, w, h in SHOTS:
        f = out / f"{name}.png"
        subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={w},{h}",
                        "--virtual-time-budget=8000", f"--screenshot={f}", a.base + path], capture_output=True)
        print(f, f.stat().st_size if f.exists() else "FAILED")
    return 0

if __name__ == "__main__":
    sys.exit(main())
