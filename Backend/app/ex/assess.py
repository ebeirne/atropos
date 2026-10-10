"""EX, the strategy assessment: a strategy in words in, a validated list of needs out."""
from __future__ import annotations

from . import gemini
from .prompt import build_prompt, build_system
from .spec import SpecError, gemini_schema, parse_spec

MAX_CHARS = 4000
ATTEMPTS = 2  # the first try, and one more with the problems fed back


class AssessError(Exception):
    """`status` 422 means the strategy itself is the problem. 502 means Gemini's answer was."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def assess(strategy: str, call=None) -> dict:
    """Ask Gemini what a strategy needs, check the answer, and retry once if it is not usable.

    `call` is the function that talks to Gemini. It defaults to the real one, and tests swap in
    a fake so they never touch the network.
    """
    text = (strategy or "").strip()
    if not text:
        raise AssessError("Describe the strategy first.")
    if len(text) > MAX_CHARS:
        raise AssessError(f"That description is too long. Keep it under {MAX_CHARS} characters.")

    call = call or gemini.generate_json
    system, schema = build_system(), gemini_schema()
    problems: list[str] = []

    for attempt in range(1, ATTEMPTS + 1):
        prompt = build_prompt(text, problems or None)
        try:
            raw = call(prompt, system, schema)
        except gemini.UnparseableAnswer:
            problems = ["Your last answer was not valid JSON. Answer with only the JSON object."]
            continue

        try:
            return {"spec": parse_spec(raw).to_dict(), "attempts": attempt}
        except SpecError as exc:
            # Gemini said plainly that nothing here can be measured. Retrying would only
            # push it to guess, so report it as it is.
            said_nothing_maps = isinstance(raw, dict) and raw.get("needs") == [] and raw.get("unmapped")
            if said_nothing_maps:
                raise AssessError(" ".join(exc.problems)) from exc
            problems = exc.problems

    raise AssessError(
        "Gemini's answer did not pass Leaf's checks after two tries. "
        + " ".join(problems)
        + " Try rewording the strategy.",
        502,
    )