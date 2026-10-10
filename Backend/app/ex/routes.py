"""Endpoints for EX, the strategy assessment."""
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from ..metrics import metric_catalog
from . import gemini
from .assess import AssessError, assess
from .spec import SpecError, parse_spec

router = APIRouter(prefix="/api/ex", tags=["ex"])


class AssessRequest(BaseModel):
    strategy: str = ""


@router.get("/ping")
def ping():
    """Calls Gemini once. 200 means the key, the model and the network all work."""
    return gemini.ping()


@router.get("/models")
def models():
    """Which Gemini models your key can use. Pick one for GEMINI_MODEL."""
    return {"models": gemini.list_models()}


@router.get("/metrics")
def metrics():
    """The closed list of things a strategy can be measured on. The review screen reads this."""
    return {"metrics": metric_catalog()}


@router.post("/validate")
def validate(body: dict = Body(...)):
    """Check a spec and return it in clean form. The review screen calls this after you edit one."""
    try:
        return parse_spec(body).to_dict()
    except SpecError as exc:
        raise HTTPException(status_code=422, detail=" ".join(exc.problems))


@router.post("/assess")
def assess_strategy(req: AssessRequest):
    """A strategy in words in, a validated spec out: {"spec": {...}, "attempts": 1}."""
    try:
        return assess(req.strategy)
    except AssessError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)