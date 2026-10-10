"""Shared test setup."""
import pytest

from app.ex import gemini


@pytest.fixture(autouse=True)
def never_call_the_real_gemini(monkeypatch):
    """Safety net: if a test ever reaches the real Gemini client, fail loudly.

    Your real key is in .env, so without this a mistake in a test would spend real quota.
    Tests that need a Gemini stand-in replace this with their own fake.
    """
    def refuse(*args, **kwargs):
        raise AssertionError("A test tried to call the real Gemini. Use a fake instead.")

    monkeypatch.setattr(gemini.genai, "Client", refuse)

@pytest.fixture(autouse=True)
def never_call_the_real_yahoo(monkeypatch, tmp_path):
    """Same idea for market data: no test downloads from Yahoo or touches the real cache."""
    from app.lego import providers

    def refuse(*args, **kwargs):
        raise AssertionError("A test tried to download from Yahoo. Use a fake instead.")

    monkeypatch.setattr(providers, "_download", refuse)
    monkeypatch.setattr(providers, "CACHE_DIR", tmp_path / "yahoo")
