from dataclasses import replace
from datetime import datetime, timezone

import pytest

from intel import decide, stories
from intel.claims import file_new
from intel.dedup import origin
from intel.markets import Market
from intel.policy import Policy
from intel.portfolio import Portfolio, Position
from intel.store import Store
from tests.conftest import FakeClaude

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
POLICY = Policy()
PORTFOLIO = Portfolio(equity=100_000, cash=20_000, positions={"NWRB": Position("NWRB", 100, 50, 5_000)}, source="snaptrade")


def market(question, yes=0.2, volume=50_000, spread=0.02, id="m1"):
    return Market(venue="polymarket", id=id, event=question, question=question, url="https://polymarket.com/x",
                  yes=yes, bid=yes - spread / 2, ask=yes + spread / 2, spread=spread, volume=volume, liquidity=None,
                  close_time="2027-06-30T00:00:00Z", status="open")


def build(tmp_path, articles, universe, names=None, claude=None, when="2026-10-22T15:00:00Z"):
    from intel.sources import Registry
    store, registry = Store(tmp_path / "evidence.db"), Registry()
    for name in names or articles:
        store.put(articles[name], origin=origin(articles[name], registry), fetched_at=when)
    file_new(store, universe, ask=claude or FakeClaude())
    stories.assign(store)
    return store


def evaluate(store, universe, registry, claude=None, search=lambda q: [], policy=POLICY, portfolio=PORTFOLIO):
    return decide.evaluate(store, policy, 1, universe, portfolio, registry=registry, search=search,
                           ask=claude or FakeClaude(), now=NOW)


def test_the_fixture_story_passes_the_gate_and_becomes_a_sized_proposal(tmp_path, articles, universe, registry):
    store = build(tmp_path, articles, universe)
    r = evaluate(store, universe, registry)
    checks = r["gate"]["checks"]
    assert all(c["ok"] for c in checks.values())
    assert "Business Wire (the company's own release)" in checks["primary"]["detail"]
    assert "Reuters" in checks["independent"]["detail"] and "Associated Press" in checks["independent"]["detail"]
    assert (r["status"], r["side"], r["notional"]) == ("proposed", "buy", 2400.0)  # 100k x 3% x 0.8
    p = decide.get_proposal(store, r["proposal_id"])
    assert (p["status"], p["ticker"], p["conviction"], p["horizon_months"]) == ("proposed", "NWRB", 0.8, 18)
    assert p["evidence"]["corroboration"]["independent"] == 3
    assert stories.get(store, 1)["status"] == "proposed"


@pytest.mark.parametrize("names, failed", [
    (["reuters_original", "local_syndicated", "yahoo_repost", "ap_independent"], "primary"),
    (["reuters_original", "local_syndicated", "yahoo_repost", "businesswire_pr"], "independent"),
])
def test_the_gate_needs_a_primary_source_and_two_independent_majors(tmp_path, articles, universe, registry, names, failed):
    store = build(tmp_path, articles, universe, names)
    r = evaluate(store, universe, registry)
    assert (r["status"], r["gate"]["failed"]) == ("passed", failed)
    assert stories.get(store, 1)["gate"]["reason"].startswith(f"gate: {failed}")


def test_old_news_and_neutral_news_dont_trade(tmp_path, articles, universe, registry):
    store = build(tmp_path, articles, universe, when="2026-10-01T15:00:00Z")
    assert evaluate(store, universe, registry)["gate"]["failed"] == "fresh"
    store = build(tmp_path / "b", articles, universe, claude=FakeClaude(direction="neutral"))
    assert evaluate(store, universe, registry)["gate"]["failed"] == "direction"


def test_a_credible_contradicting_market_blocks_and_a_thin_one_doesnt_count(tmp_path, articles, universe, registry):
    store = build(tmp_path, articles, universe)
    blocked = evaluate(store, universe, registry, claude=FakeClaude(bearing="contradicts"),
                       search=lambda q: [market("Will the FTC sue to block Northwind-Contoso?")])
    assert blocked["status"] == "passed" and "prediction market contradicts" in blocked["reason"]
    stories.set_status(store, 1, "open")
    thin = evaluate(store, universe, registry, claude=FakeClaude(bearing="contradicts"),
                    search=lambda q: [market("Will the FTC sue?", volume=900)])
    assert thin["status"] == "proposed"
    assert thin["markets"][0]["credible"] is False and thin["markets"][0]["bearing"] == "unknown"


@pytest.mark.parametrize("claude, why", [
    (FakeClaude(action="hold"), "the model says hold"),
    (FakeClaude(conviction=0.45), "conviction 0.45"),
    (FakeClaude(action="sell"), "against positive news"),
])
def test_the_model_can_say_no(tmp_path, articles, universe, registry, claude, why):
    store = build(tmp_path, articles, universe)
    r = evaluate(store, universe, registry, claude=claude)
    assert r["status"] == "passed" and why in r["reason"]


def test_no_model_means_no_trade(tmp_path, articles, universe, registry):
    store = build(tmp_path, articles, universe)

    def no_thesis(system, prompt, schema, **kw):
        return None if schema is decide.THESIS_OUT else FakeClaude()(system, prompt, schema)
    r = evaluate(store, universe, registry, claude=no_thesis)
    assert r["status"] == "passed" and "Claude isn't available" in r["reason"]


def test_sells_are_sized_from_what_is_held(tmp_path, articles, universe, registry):
    store = build(tmp_path, articles, universe, claude=FakeClaude(direction="negative", action="sell", conviction=0.7))
    r = evaluate(store, universe, registry, claude=FakeClaude(direction="negative", action="sell", conviction=0.7))
    assert (r["side"], r["notional"]) == ("sell", 3500.0)
    store2 = build(tmp_path / "b", articles, universe, claude=FakeClaude(direction="negative"))
    r2 = evaluate(store2, universe, registry, claude=FakeClaude(action="sell"), portfolio=replace(PORTFOLIO, positions={}))
    assert r2["status"] == "passed" and r2["reason"] == "nothing to sell"
