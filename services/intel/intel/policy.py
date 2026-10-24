"""The trading policy (policy.toml) and the kill switch.

The kill switch is either INTEL_KILL=1 in the environment or a file named KILL in the data directory
(`python -m intel kill` makes it, `python -m intel kill --off` removes it). While it's on, the guard
refuses every order and the pipeline stops before proposing anything.
"""
import os
import tomllib
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "policy.toml"
DATA_DIR = ROOT / "data"
MODES, BROKERS = ("approve", "auto"), ("proposals", "alpaca")


@dataclass(frozen=True)
class Gate:
    require_primary: bool = True
    min_independent_major: int = 2
    major_weight: float = 0.75
    max_story_age_days: int = 7
    min_conviction: float = 0.6
    market_min_volume: float = 5000
    market_max_spread: float = 0.08
    block_on_market_contradiction: bool = True


@dataclass(frozen=True)
class Sizing:
    base_position_pct: float = 3.0
    max_position_pct: float = 5.0
    min_cash_pct: float = 10.0
    min_order_usd: float = 50
    max_order_usd: float = 2500


@dataclass(frozen=True)
class Limits:
    max_trades_per_day: int = 3
    max_weekly_turnover_pct: float = 15.0
    max_positions: int = 25
    blocked_tickers: tuple = ()


@dataclass(frozen=True)
class Policy:
    mode: str = "approve"
    broker: str = "proposals"
    allow_live: bool = False
    gate: Gate = Gate()
    sizing: Sizing = Sizing()
    limits: Limits = Limits()


def load(path=DEFAULT_PATH):
    cfg = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    if cfg.get("mode", "approve") not in MODES:
        raise ValueError(f"policy mode must be one of {MODES}, not {cfg['mode']!r}")
    if cfg.get("broker", "proposals") not in BROKERS:
        raise ValueError(f"policy broker must be one of {BROKERS}, not {cfg['broker']!r}")
    limits = dict(cfg.get("limits", {}))
    limits["blocked_tickers"] = tuple(t.upper() for t in limits.get("blocked_tickers", ()))
    return Policy(mode=cfg.get("mode", "approve"), broker=cfg.get("broker", "proposals"),
                  allow_live=bool(cfg.get("allow_live", False)), gate=Gate(**cfg.get("gate", {})),
                  sizing=Sizing(**cfg.get("sizing", {})), limits=Limits(**limits))


def load_env(path=ROOT.parent.parent / ".env"):
    """Read atropos's .env (KEY=value lines) into the environment, never overriding what's already set."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        value = value.split(" #")[0].strip().strip('"').strip("'")
        if sep and key and value and not key.startswith("#") and key.strip() not in os.environ:   # KEY= stays unset
            os.environ[key.strip()] = value


def kill_file(data_dir=DATA_DIR):
    return Path(data_dir) / "KILL"


def killed(data_dir=DATA_DIR):
    return os.environ.get("INTEL_KILL", "").lower() in ("1", "true", "yes") or kill_file(data_dir).exists()


def set_killed(on, data_dir=DATA_DIR):
    f = kill_file(data_dir)
    if on:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("Trading stopped. Delete this file (or run `python -m intel kill --off`) to resume.\n")
    elif f.exists():
        f.unlink()
