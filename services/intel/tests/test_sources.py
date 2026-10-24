import pytest

from intel.sources import Registry


def test_listed_domain_matches_its_subdomains(registry):
    s = registry.lookup("https://uk.reuters.com/business/some-story")
    assert (s.name, s.tier, s.group) == ("Reuters", "wire", "reuters")
    assert registry.lookup("www.wsj.com").group == "dowjones"


def test_most_specific_listing_wins(registry):
    assert registry.lookup("https://finance.yahoo.com/news/x").name == "Yahoo Finance"
    assert registry.lookup("https://sports.yahoo.com/x").name == "Yahoo"


def test_unknown_host_falls_back_to_its_registrable_domain(registry):
    s = registry.lookup("https://news.bayareadaily.co.uk/story")
    assert (s.domain, s.group, s.tier) == ("bayareadaily.co.uk", "bayareadaily.co.uk", "unknown")
    assert s.weight == registry.weights["unknown"]


def test_investor_relations_hosts_are_primary(registry):
    s = registry.lookup("https://investor.northwind-robotics.com/news/2026/deal")
    assert (s.tier, s.group) == ("primary", "northwind-robotics.com")


def test_owners_collapse_outlets(registry):
    assert {registry.lookup(d).group for d in ("wsj.com", "marketwatch.com", "barrons.com", "dowjones.com")} == {"dowjones"}
    assert registry.lookup("cnbc.com").group == registry.lookup("nbcnews.com").group


def test_only_wires_and_release_services_carry_credits(registry):
    assert registry.creditors
    assert {s.tier for s in registry.creditors} <= {"wire", "press_release"}


def test_unknown_tier_is_rejected(tmp_path):
    bad = tmp_path / "sources.toml"
    bad.write_text('[tiers]\nwire = 0.9\n\n[[source]]\ndomain = "example.com"\nname = "Example"\ntier = "rumor"\n')
    with pytest.raises(ValueError, match="rumor"):
        Registry(bad)


def test_load_env_reads_dotenv_without_overriding(tmp_path, monkeypatch):
    from intel.policy import load_env
    env = tmp_path / ".env"
    env.write_text('# comment\nINTEL_T1="quoted value"\nINTEL_T2=plain  # trailing note\nINTEL_T3=keep\n\nnot a line\n')
    monkeypatch.setenv("INTEL_T3", "already set")
    for k in ("INTEL_T1", "INTEL_T2", "INTEL_T4"):
        monkeypatch.delenv(k, raising=False)
    load_env(env)
    import os
    assert (os.environ["INTEL_T1"], os.environ["INTEL_T2"], os.environ["INTEL_T3"]) == ("quoted value", "plain", "already set")
    assert "INTEL_T4" not in os.environ  # an empty KEY= is the same as not set
    for k in ("INTEL_T1", "INTEL_T2"):
        monkeypatch.delenv(k)


def test_claude_counts_as_available_only_with_credentials(monkeypatch, tmp_path):
    from intel import llm
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID", "INTEL_NO_LLM"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(llm.Path, "home", lambda: tmp_path)
    assert not llm.has_credentials() and not llm.available()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    assert llm.has_credentials()


def test_outlets_met_in_live_runs_are_listed(registry):
    assert registry.lookup("https://247wallst.com/investing/x").tier == "secondary"
    assert registry.lookup("https://www.aol.com/finance/x").tier == "aggregator"
    assert registry.lookup("https://www.investors.com/news/x").tier == "trade"
