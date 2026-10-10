"""Endpoints for Lego, the pair finder."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..ex.spec import Spec, SpecError, parse_spec
from .engine import Lego, explain
from .presets import PRESETS
from .providers import default_universe, get_prices

router = APIRouter(prefix="/api", tags=["lego"])


class ScanRequest(BaseModel):
    provider: str = "synthetic"
    days: int = 750
    tickers: list[str] | None = None  # None means the provider's default universe


class LegoScanRequest(ScanRequest):
    spec: dict


class MultiScanRequest(ScanRequest):
    strategies: list[str]
    specs: dict[str, dict] | None = None  # EX's spec for a card, used instead of its preset


def _spec(data: dict, label: str = "spec") -> Spec:
    try:
        return parse_spec(data)
    except SpecError as exc:
        raise HTTPException(status_code=422, detail=f"The {label} is not usable. " + " ".join(exc.problems))


@router.get("/universe/{provider}")
def universe(provider: str):
    """The tickers a scan uses when none are given."""
    return {"provider": provider, "tickers": default_universe(provider)}


@router.post("/lego/scan")
def lego_scan(req: LegoScanRequest):
    """One spec (straight from EX's /api/ex/assess) in, the matching pairs and stocks out."""
    spec = _spec(req.spec)
    prices = get_prices(req.provider, req.tickers, req.days)
    result = Lego(prices).run(spec)
    return {
        "spec": spec.to_dict(),
        "universe_size": len(prices.tickers),
        "dropped": prices.dropped,
        "pairs_screened": result["screened"],
        "matched": result["matched"],
        "pairs": result["pairs"],
        "stocks": result["stocks"],
        "explanation": explain(spec, result),
    }


@router.post("/scan/multi")
def scan_multi(req: MultiScanRequest):
    """What the screener calls: several strategy cards scanned over one universe."""
    if not req.strategies:
        raise HTTPException(status_code=422, detail="Pick at least one strategy.")
    given = req.specs or {}
    specs = {}
    for key in dict.fromkeys(req.strategies):
        if key in given:
            specs[key] = _spec(given[key], f"spec for {key}")
        elif key in PRESETS:
            specs[key] = PRESETS[key]
        else:
            raise HTTPException(
                status_code=422,
                detail=f'"{key}" is not a built-in strategy ({", ".join(PRESETS)}). Send its spec in "specs".',
            )

    prices = get_prices(req.provider, req.tickers, req.days)
    lego = Lego(prices)  # shared, so a pair's statistics are worked out once for all strategies
    out, screened = {}, 0
    for key, spec in specs.items():
        result = lego.run(spec)
        screened = max(screened, result["screened"])
        out[key] = {
            "spec": spec.to_dict(),
            "matched": result["matched"],
            "results": result["pairs"],
            "explanation": explain(spec, result),
        }
    return {
        "provider": req.provider,
        "universe_size": len(prices.tickers),
        "dropped": prices.dropped,
        "pairs_screened": screened,
        "strategies": out,
    }
