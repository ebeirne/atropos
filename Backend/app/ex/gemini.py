"""The only file that talks to Gemini. Everything else in the backend calls these functions."""
from __future__ import annotations

import json
import time

from google import genai
from google.genai import errors, types

from ..config import Settings, get_settings

THINKING_LEVELS = ("minimal", "low", "medium", "high")
RETRY_CODES = (500, 503, 504)  # Gemini's side of the fence
RETRY_WAIT_S = 1.5


class GeminiError(Exception):
    """A problem the caller can act on. `status` is the HTTP status the API should return."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


class UnparseableAnswer(ValueError):
    """Gemini answered, but the text was not valid JSON. Worth one more try."""


def _scrub(text: str, settings: Settings) -> str:
    """Never let the key leak into a message, even by accident."""
    key = settings.gemini_api_key
    return text.replace(key, "***") if key else text


def _client(settings: Settings) -> genai.Client:
    if not settings.gemini_api_key:
        raise GeminiError(
            "GEMINI_API_KEY is not set. Add it to backend/.env and restart the server.", 503
        )
    return genai.Client(
        api_key=settings.gemini_api_key,
        http_options=types.HttpOptions(timeout=int(settings.gemini_timeout_s * 1000)),
    )


def _explain(exc: Exception, settings: Settings) -> GeminiError:
    """Turn an SDK or network failure into a plain sentence."""
    if isinstance(exc, errors.APIError):
        code = exc.code or 0
        detail = _scrub(str(exc.message or exc), settings)
        if code in (401, 403) or "API key" in detail:
            return GeminiError(f"Gemini rejected the API key ({code}). Check GEMINI_API_KEY in backend/.env. {detail}")
        if code == 404:
            return GeminiError(
                f"Gemini does not know the model '{settings.gemini_model}'. "
                f"Open /api/ex/models to see what your key can use, then set GEMINI_MODEL in backend/.env."
            )
        if code == 429:
            return GeminiError("Gemini says the quota or rate limit was reached. Wait a minute and try again.", 429)
        if code == 504:
            return GeminiError(
                f"Gemini did not answer within {settings.gemini_timeout_s:g}s (504). It is probably busy. "
                f"Try again shortly, or set a faster GEMINI_MODEL in backend/.env.", 504
            )
        if code == 503:
            return GeminiError("Gemini is overloaded right now (503). Try again shortly.", 503)
        if code >= 500:
            return GeminiError(f"Gemini had a problem on its side ({code}). Try again shortly.")
        return GeminiError(f"Gemini rejected the request ({code}): {detail}")
    return GeminiError(f"Could not reach Gemini ({type(exc).__name__}). Check the internet connection.")


def _thinking(settings: Settings):
    """How hard Gemini thinks before answering. Less thinking is faster, and EX is a simple task."""
    level = settings.gemini_thinking
    if level in ("default", "auto", "off", ""):
        return None
    if level not in THINKING_LEVELS:
        raise GeminiError(
            f"GEMINI_THINKING is '{level}'. Use one of: {', '.join(THINKING_LEVELS)}, or default. "
            f"Fix it in backend/.env and restart the server.", 503
        )
    return types.ThinkingConfig(thinking_level=level.upper())


def _models(settings: Settings) -> list[str]:
    """The model for the first try, then the one for the retry."""
    fallback = settings.gemini_fallback_model
    if fallback.lower() in ("", "off", "none"):
        fallback = settings.gemini_model
    return [settings.gemini_model, fallback]


def ping(settings: Settings | None = None) -> dict:
    """The smallest possible real call. Proves the key, the model name and the network all work."""
    settings = settings or get_settings()
    client = _client(settings)
    started = time.perf_counter()
    try:
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents="Reply with the single word: ok",
            config=types.GenerateContentConfig(thinking_config=_thinking(settings)),
        )
    except Exception as exc:  # noqa: BLE001 - every failure becomes a readable GeminiError
        raise _explain(exc, settings) from exc
    return {
        "model": settings.gemini_model,
        "reply": (response.text or "").strip(),
        "ms": round((time.perf_counter() - started) * 1000),
    }


def list_models(settings: Settings | None = None) -> list[str]:
    """Model IDs this key can call for text generation. Use it when GEMINI_MODEL is rejected."""
    settings = settings or get_settings()
    client = _client(settings)
    try:
        found = []
        for m in client.models.list():
            actions = getattr(m, "supported_actions", None) or []
            if "generateContent" in actions:
                found.append((m.name or "").removeprefix("models/"))
    except Exception as exc:  # noqa: BLE001
        raise _explain(exc, settings) from exc
    return sorted(n for n in found if n.startswith("gemini"))


def _why_empty(response) -> str:
    """If Gemini returned no text, say why when it told us (for example a safety block)."""
    feedback = getattr(response, "prompt_feedback", None)
    reason = getattr(feedback, "block_reason", None)
    if not reason:
        candidates = getattr(response, "candidates", None) or []
        reason = getattr(candidates[0], "finish_reason", None) if candidates else None
    return f" ({getattr(reason, 'name', reason)})" if reason else ""


def generate_json(prompt: str, system: str, schema: dict, settings: Settings | None = None):
    """One call whose answer must be JSON in the shape of `schema`. Returns the parsed JSON.

    Temperature is left at Gemini's default on purpose: Google advises against lowering it for
    current models. The schema and our own validation keep the answer in shape instead.
    """
    settings = settings or get_settings()
    client = _client(settings)
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_json_schema=schema,
        thinking_config=_thinking(settings),
    )
    # Gemini's own hiccups (overloaded, timed out) get one more try, on the lighter fallback
    # model when there is one: a busy model tends to stay busy for a while.
    # Nothing else is retried: a bad key or a quota limit would only fail again.
    models = _models(settings)
    for attempt, model in enumerate(models, 1):
        try:
            response = client.models.generate_content(model=model, contents=prompt, config=config)
            break
        except Exception as exc:  # noqa: BLE001
            code = exc.code if isinstance(exc, errors.APIError) else None
            if attempt < len(models) and code in RETRY_CODES:
                if model == models[attempt]:
                    time.sleep(RETRY_WAIT_S)
                continue
            raise _explain(exc, settings) from exc

    text = (response.text or "").strip()
    if not text:
        raise GeminiError(f"Gemini returned no answer{_why_empty(response)}. Try rewording the strategy.")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise UnparseableAnswer("Gemini's answer was not valid JSON.") from exc