"""The 'needs' format: what EX (Gemini) hands to Lego, and the checks that guard it.

A spec looks like this once it has passed validation:

    {
      "name": "Inverse movers, not cointegrated",
      "summary": "One plain sentence.",
      "needs": [
        {"metric": "coint_p",  "op": ">",       "value": 0.05},
        {"metric": "spread_z", "op": ">=",      "value": 2},
        {"metric": "corr",     "op": "between", "value": [-0.9, -0.5]}
      ],
      "unmapped": ["anything in the strategy Leaf cannot measure"]
    }

Gemini always sends `value` as a list ([0.05] or [-0.9, -0.5]) because that is the simplest shape
for it to follow. The validator turns that into the form above: a number, or a pair for 'between'.
"""
from __future__ import annotations

import difflib
import math
from dataclasses import dataclass

from ..metrics import METRICS

OPS = (">", ">=", "<", "<=", "between")
MAX_NEEDS = 12
_INF = float("inf")


class SpecError(ValueError):
    """The spec is not usable. `problems` is a list of plain sentences, one per mistake."""

    def __init__(self, problems: list[str]):
        super().__init__(" ".join(problems))
        self.problems = list(problems)


@dataclass(frozen=True)
class Need:
    metric: str
    op: str
    value: float | tuple[float, float]

    def to_dict(self) -> dict:
        v = list(self.value) if isinstance(self.value, tuple) else self.value
        return {"metric": self.metric, "op": self.op, "value": v}

    def text(self) -> str:
        if self.op == "between":
            return f"{self.metric} between {self.value[0]:g} and {self.value[1]:g}"
        return f"{self.metric} {self.op} {self.value:g}"


@dataclass(frozen=True)
class Spec:
    name: str
    summary: str
    needs: tuple[Need, ...]
    unmapped: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "summary": self.summary,
            "needs": [n.to_dict() for n in self.needs],
            "unmapped": list(self.unmapped),
        }


def _number(x) -> float | None:
    """A real, finite number. Booleans, strings, NaN and infinity are not numbers here."""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    return float(x) if math.isfinite(x) else None


def _parse_need(i: int, raw, problems: list[str]) -> Need | None:
    tag = f"Need {i + 1}"
    if not isinstance(raw, dict):
        problems.append(f"{tag} must be an object with metric, op and value.")
        return None

    n_before = len(problems)

    metric = raw.get("metric")
    if not isinstance(metric, str) or metric not in METRICS:
        hint = ""
        if isinstance(metric, str):
            close = difflib.get_close_matches(metric, METRICS, n=1)
            hint = f' Did you mean "{close[0]}"?' if close else ""
        problems.append(
            f'{tag}: "{metric}" is not a metric Leaf can measure.{hint} '
            f"Choose from: {', '.join(METRICS)}."
        )

    op = raw.get("op")
    if op not in OPS:
        problems.append(f'{tag}: "{op}" is not a valid comparison. Use one of: {", ".join(OPS)}.')

    # value: a number, or a list of numbers. Gemini sends a list even for one number.
    value = raw.get("value")
    values = list(value) if isinstance(value, (list, tuple)) else [value]
    nums = [_number(v) for v in values]
    if any(n is None for n in nums) or not nums:
        problems.append(f"{tag}: value must be a number (or two numbers for between).")
        return None
    if op == "between":
        if len(nums) != 2:
            problems.append(f"{tag}: between needs exactly two numbers, a low and a high.")
        elif nums[0] == nums[1]:
            problems.append(f"{tag}: between needs two different numbers.")
    elif op in OPS and len(nums) != 1:
        problems.append(f'{tag}: "{op}" takes one number, not {len(nums)}.')

    if metric in METRICS:
        m = METRICS[metric]
        for n in nums:
            if not m.lo <= n <= m.hi:
                problems.append(
                    f"{tag}: {n:g} is outside the range that makes sense for {metric} "
                    f"({m.lo:g} to {m.hi:g})."
                )
                break

    if metric == "corr" and op in OPS and op != "between" and nums[0] == 0:
        problems.append(
            f"{tag}: a correlation above or below 0 only gives a direction, not a real difference. "
            f'Use "between" with a range, for example between -0.9 and -0.5 for inverse movers '
            f"or between 0.5 and 0.9 for pairs that move together."
        )

    if len(problems) > n_before:
        return None
    if op == "between":
        return Need(metric, op, (min(nums), max(nums)))  # 'between 0.5 and 0.9' reads the same either way
    return Need(metric, op, nums[0])


def _limits(n: Need) -> tuple[float, bool, float, bool]:
    """(low, low is strict, high, high is strict) of the values a need allows."""
    if n.op == "between":
        return n.value[0], False, n.value[1], False
    if n.op == ">":
        return n.value, True, _INF, False
    if n.op == ">=":
        return n.value, False, _INF, False
    if n.op == "<":
        return -_INF, False, n.value, True
    return -_INF, False, n.value, False  # "<="


def _check_conflicts(needs: list[Need], problems: list[str]) -> None:
    """Needs on the same metric must leave at least one value that satisfies all of them."""
    by_metric: dict[str, list[Need]] = {}
    for n in needs:
        by_metric.setdefault(n.metric, []).append(n)
    for metric, group in by_metric.items():
        lo, lo_strict, hi, hi_strict = -_INF, False, _INF, False
        for n in group:
            a, a_strict, b, b_strict = _limits(n)
            if a > lo or (a == lo and a_strict):
                lo, lo_strict = a, a_strict
            if b < hi or (b == hi and b_strict):
                hi, hi_strict = b, b_strict
        if lo > hi or (lo == hi and (lo_strict or hi_strict)):
            said = " and ".join(n.text() for n in group)
            problems.append(f"The needs for {metric} cannot all be true at once ({said}).")


def parse_spec(data) -> Spec:
    """Check a spec (from Gemini or from the review screen) and return it in its clean form.

    Collects every mistake instead of stopping at the first, so they can all be shown or
    handed back to Gemini together.
    """
    if not isinstance(data, dict):
        raise SpecError(["The strategy assessment must be a JSON object."])

    problems: list[str] = []
    name = str(data.get("name") or "").strip()[:80] or "Custom strategy"
    summary = str(data.get("summary") or "").strip()[:300]

    raw_unmapped = data.get("unmapped")
    unmapped = [str(u).strip()[:160] for u in raw_unmapped if str(u).strip()] if isinstance(raw_unmapped, list) else []

    raw_needs = data.get("needs")
    needs: list[Need] = []
    if not isinstance(raw_needs, list):
        problems.append("needs must be a list.")
    elif not raw_needs:
        msg = "No needs. Nothing in this strategy could be expressed with the metrics Leaf can measure."
        if unmapped:
            msg += f" Could not map: {'; '.join(unmapped)}."
        problems.append(msg)
    elif len(raw_needs) > MAX_NEEDS:
        problems.append(f"Too many needs ({len(raw_needs)}). Keep it to {MAX_NEEDS} or fewer.")
    else:
        for i, raw in enumerate(raw_needs):
            need = _parse_need(i, raw, problems)
            if need:
                needs.append(need)
        if len(needs) == len(raw_needs):
            _check_conflicts(needs, problems)

    if problems:
        raise SpecError(problems)
    return Spec(name, summary, tuple(needs), tuple(unmapped))


def gemini_schema() -> dict:
    """The JSON schema handed to Gemini so its answer already has the right shape.

    Built from the metric list, so the two can never disagree. It sticks to the small set of
    schema keywords Gemini documents as supported. The validator above still checks everything,
    because a schema cannot express ranges per metric or conflicts between needs.
    """
    return {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "A short title for the strategy, under 60 characters."},
            "summary": {"type": "string", "description": "One plain sentence saying what the strategy looks for."},
            "needs": {
                "type": "array",
                "description": "Every measurable condition a stock or pair must meet. Empty if none can be measured.",
                "items": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string", "enum": list(METRICS)},
                        "op": {"type": "string", "enum": list(OPS)},
                        "value": {
                            "type": "array",
                            "description": "One number, or two numbers [low, high] when op is between.",
                            "items": {"type": "number"},
                            "minItems": 1,
                            "maxItems": 2,
                        },
                    },
                    "required": ["metric", "op", "value"],
                },
            },
            "unmapped": {
                "type": "array",
                "description": "Parts of the strategy that none of the metrics can measure. Empty if everything mapped.",
                "items": {"type": "string"},
            },
        },
        "required": ["name", "summary", "needs", "unmapped"],
    }