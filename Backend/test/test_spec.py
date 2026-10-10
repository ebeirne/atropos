"""Tests for the needs format, the metric list and the endpoints that use them.

Run from the backend folder:  python -m pytest -q
None of these call Gemini, so they need no key and no internet.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.ex.spec import SpecError, gemini_schema, parse_spec
from app.main import app
from app.metrics import METRICS, metric_catalog

client = TestClient(app)


def spec(*needs, **extra):
    return {"name": "T", "summary": "s", "needs": list(needs), "unmapped": [], **extra}


def need(metric, op, value):
    return {"metric": metric, "op": op, "value": value}


def problems(data):
    with pytest.raises(SpecError) as info:
        parse_spec(data)
    return info.value.problems


# ---------- the happy path ----------

def test_example_from_the_design():
    out = parse_spec(
        spec(
            need("coint_p", ">", 0.05),
            need("spread_z", ">=", 2),
            need("corr", "between", [-0.9, -0.5]),
        )
    ).to_dict()
    assert out["needs"] == [
        {"metric": "coint_p", "op": ">", "value": 0.05},
        {"metric": "spread_z", "op": ">=", "value": 2.0},
        {"metric": "corr", "op": "between", "value": [-0.9, -0.5]},
    ]


def test_gemini_style_list_value_becomes_a_plain_number():
    out = parse_spec(spec(need("coint_p", "<=", [0.05]))).to_dict()
    assert out["needs"][0]["value"] == 0.05


def test_between_is_put_in_order():
    out = parse_spec(spec(need("corr", "between", [-0.5, -0.9]))).to_dict()
    assert out["needs"][0]["value"] == [-0.9, -0.5]


def test_the_three_built_in_strategies_can_be_expressed():
    mean_reversion = spec(need("coint_p", "<=", 0.05), need("half_life", "between", [3, 40]), need("corr", ">=", 0.5))
    arbitrage = spec(need("coint_p", "<=", 0.01), need("half_life", "<=", 15), need("corr", ">=", 0.6))
    hedging = spec(need("corr", ">=", 0.7), need("coint_p", ">", 0.10), need("hedge_effectiveness", ">=", 0.5))
    for s in (mean_reversion, arbitrage, hedging):
        assert len(parse_spec(s).needs) == 3


def test_stock_and_pair_needs_can_be_mixed():
    parse_spec(spec(need("volatility", "<", 0.3), need("avg_volume", ">=", 1_000_000), need("corr", ">", 0.8)))


def test_name_and_summary_defaults_and_limits():
    out = parse_spec({"needs": [need("corr", ">", 0.5)]}).to_dict()
    assert out["name"] == "Custom strategy" and out["summary"] == "" and out["unmapped"] == []
    long = parse_spec({"name": "x" * 500, "summary": "y" * 900, "needs": [need("corr", ">", 0.5)]})
    assert len(long.name) == 80 and len(long.summary) == 300


# ---------- things that must be rejected ----------

def test_unknown_metric_suggests_the_closest():
    p = problems(spec(need("coint_pvalue", ">", 0.05)))
    assert len(p) == 1 and 'Did you mean "coint_p"' in p[0] and "Choose from" in p[0]


def test_unknown_metric_with_no_close_match_still_lists_choices():
    p = problems(spec(need("rsi", ">", 70)))
    assert "Did you mean" not in p[0] and "coint_p" in p[0]


@pytest.mark.parametrize("op", ["=", "==", "!=", "above", None, ""])
def test_bad_operator(op):
    assert "not a valid comparison" in problems(spec(need("corr", op, 0.5)))[0]


@pytest.mark.parametrize(
    "op, value, phrase",
    [
        (">", [0.1, 0.2], "takes one number"),
        ("between", [0.1], "exactly two numbers"),
        ("between", 0.1, "exactly two numbers"),
        ("between", [0.4, 0.4], "two different numbers"),
        (">", "0.5", "must be a number"),
        (">", True, "must be a number"),
        (">", None, "must be a number"),
        (">", [], "must be a number"),
        (">", float("nan"), "must be a number"),
        (">", float("inf"), "must be a number"),
    ],
)
def test_bad_values(op, value, phrase):
    assert phrase in problems(spec(need("corr", op, value)))[0]


@pytest.mark.parametrize(
    "metric, value",
    [("coint_p", 5), ("coint_p", -0.1), ("corr", 2), ("half_life", -3), ("volatility", 25), ("spread_z_abs", -1)],
)
def test_value_outside_the_sensible_range(metric, value):
    assert "outside the range" in problems(spec(need(metric, ">", value)))[0]


def test_between_bounds_are_both_checked():
    assert "outside the range" in problems(spec(need("corr", "between", [-0.5, 1.5])))[0]


def test_needs_that_cannot_all_be_true():
    p = problems(spec(need("coint_p", ">", 0.5), need("coint_p", "<", 0.1)))
    assert len(p) == 1 and "cannot all be true" in p[0] and "coint_p > 0.5" in p[0]


@pytest.mark.parametrize(
    "a, b, conflict",
    [
        ((">", 0.5), ("<=", 0.5), True),    # nothing is above 0.5 and also at most 0.5
        ((">=", 0.5), ("<", 0.5), True),
        ((">", 0.5), ("<", 0.5), True),
        ((">=", 0.5), ("<=", 0.5), False),  # exactly 0.5 satisfies both
        (("between", [0.1, 0.3]), (">", 0.4), True),
        (("between", [0.1, 0.3]), (">", 0.2), False),
    ],
)
def test_boundary_conflicts(a, b, conflict):
    data = spec(need("corr", *a), need("corr", *b))
    if conflict:
        assert "cannot all be true" in problems(data)[0]
    else:
        parse_spec(data)


def test_different_metrics_never_conflict():
    parse_spec(spec(need("corr", ">", 0.9), need("coint_p", "<", 0.1), need("volatility", ">", 0.2)))


def test_empty_needs_explains_what_could_not_be_mapped():
    p = problems(spec(unmapped=["RSI above 70", "earnings surprise"]))
    assert "No needs" in p[0] and "RSI above 70; earnings surprise" in p[0]


def test_too_many_needs():
    many = [need("corr", ">", 0.1)] * 13
    assert "Too many needs" in problems(spec(*many))[0]


def test_every_mistake_is_reported_together():
    p = problems(spec(need("nope", ">", 1), need("corr", "??", 0.5), need("coint_p", ">", 9)))
    assert len(p) == 3


@pytest.mark.parametrize("data", [None, [], "text", 5, {"needs": "corr > 0.5"}, {"needs": [5]}, {}])
def test_garbage_in_gives_a_readable_error_not_a_crash(data):
    assert problems(data)


# ---------- the schema handed to Gemini ----------

ALLOWED_KEYWORDS = {"type", "properties", "items", "enum", "required", "minItems", "maxItems", "description"}


def _keywords(node, found=None):
    found = set() if found is None else found
    if isinstance(node, dict):
        for k, v in node.items():
            if k != "properties":
                found.add(k)
            if k == "properties":
                for sub in v.values():
                    _keywords(sub, found)
            else:
                _keywords(v, found)
    elif isinstance(node, list):
        for v in node:
            _keywords(v, found)
    return found


def test_schema_uses_only_documented_keywords_and_is_plain_json():
    schema = gemini_schema()
    assert json.loads(json.dumps(schema)) == schema
    assert _keywords(schema) <= ALLOWED_KEYWORDS


def test_schema_lists_exactly_the_metrics_we_have():
    item = gemini_schema()["properties"]["needs"]["items"]["properties"]
    assert item["metric"]["enum"] == list(METRICS)
    assert item["op"]["enum"] == [">", ">=", "<", "<=", "between"]


def test_schema_lets_gemini_return_no_needs():
    needs = gemini_schema()["properties"]["needs"]
    assert "minItems" not in needs  # an unmeasurable strategy must be able to say so


# ---------- endpoints ----------

def test_metrics_endpoint():
    body = client.get("/api/ex/metrics").json()["metrics"]
    assert [m["key"] for m in body] == list(METRICS) == [m["key"] for m in metric_catalog()]
    assert {m["scope"] for m in body} == {"stock", "pair"}
    assert all(m["meaning"] and m["label"] for m in body)


def test_validate_endpoint_accepts_and_cleans():
    r = client.post("/api/ex/validate", json=spec(need("corr", "between", [-0.5, -0.9])))
    assert r.status_code == 200 and r.json()["needs"][0]["value"] == [-0.9, -0.5]


def test_validate_endpoint_rejects_with_one_plain_sentence():
    r = client.post("/api/ex/validate", json=spec(need("coint_p", ">", 0.5), need("coint_p", "<", 0.1)))
    assert r.status_code == 422 and isinstance(r.json()["detail"], str) and "cannot all be true" in r.json()["detail"]


@pytest.mark.parametrize("content", ["[1, 2]", "not json", '"just text"', ""])
def test_malformed_requests_still_return_a_string_detail(content):
    r = client.post("/api/ex/validate", content=content, headers={"Content-Type": "application/json"})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str) and r.json()["detail"].startswith("Invalid request")
    


# ---------- correlation must be a real range, not just a sign ----------

@pytest.mark.parametrize("op", [">", ">=", "<", "<="])
def test_correlation_against_zero_alone_is_rejected_with_a_range_suggestion(op):
    p = problems(spec(need("corr", op, 0)))
    assert len(p) == 1 and "between -0.9 and -0.5" in p[0]


def test_correlation_ranges_and_non_zero_bounds_are_still_fine():
    parse_spec(spec(need("corr", "between", [-0.9, -0.5])))
    parse_spec(spec(need("corr", "between", [-0.2, 0.2])))
    parse_spec(spec(need("corr", "<", -0.5)))
    parse_spec(spec(need("volatility", ">", 0)))  # the rule is about correlation only