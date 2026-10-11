from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import get_settings
from .ex.gemini import GeminiError
from .ex.routes import router as ex_router
from .lego.providers import ProviderError
from .lego.routes import router as lego_router

app = FastAPI(title="Leaf backend")
app.include_router(ex_router)
app.include_router(lego_router)


# Every error the frontend sees is { "detail": "plain sentence" } with a non-2xx status.
@app.exception_handler(GeminiError)
def gemini_error(_: Request, exc: GeminiError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


@app.exception_handler(ProviderError)
def provider_error(_: Request, exc: ProviderError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


@app.exception_handler(RequestValidationError)
def bad_request(_: Request, exc: RequestValidationError):
    # FastAPI's own errors are a list of objects. Flatten the first one into a sentence.
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", ())[1:])
    why = first.get("msg", "invalid request")
    return JSONResponse(status_code=422, content={"detail": f"Invalid request{f' ({where})' if where else ''}: {why}."})


@app.get("/api/health")
def health():
    s = get_settings()
    # Reports whether a key exists, never the key itself.
    return {"ok": True, "gemini_key_set": bool(s.gemini_api_key), "model": s.gemini_model}