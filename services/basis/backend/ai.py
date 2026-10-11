"""Claude calls for the belief box. Fails soft: without a key, returns a keyword fallback and a canned note."""
import json, logging, re
from backend import config
from backend.prompts import MATCH_SYSTEM, EXPLAIN_SYSTEM

log = logging.getLogger("basis.ai")
_client = None


def available():
    return bool(config.ANTHROPIC_API_KEY)


def _client_or_none():
    global _client
    if _client is None and available():
        import anthropic
        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


def _call(system, user, max_tokens=400):
    c = _client_or_none()
    msg = c.messages.create(model=config.ANTHROPIC_MODEL, max_tokens=max_tokens, system=system,
                            messages=[{"role": "user", "content": user}])
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")


def _keyword_fallback(belief, events):
    words = set(re.findall(r"[a-z0-9]+", belief.lower()))
    hits = []
    for e in events:
        tw = set(re.findall(r"[a-z0-9]+", e["title"].lower())) | {e["category"]}
        if len(words & tw - {"the", "a", "of", "in", "by", "at", "2026", "2027"}) >= 2:
            hits.append(e["id"])
    return {"matched_event_ids": hits, "interpretation": "(no API key: keyword match) " + belief}


def match_events(belief, events):
    slim = [{"id": e["id"], "title": e["title"], "category": e["category"], "resolution_date": e["resolution_date"]} for e in events]
    if not available():
        return _keyword_fallback(belief, events)
    try:
        txt = _call(MATCH_SYSTEM, f"Belief: {belief}\n\nEvents:\n{json.dumps(slim)}")
        m = re.search(r"\{.*\}", txt, re.S)
        return json.loads(m.group(0)) if m else _keyword_fallback(belief, events)
    except Exception as e:  # noqa: BLE001
        log.warning("match_events failed: %s", e)
        return _keyword_fallback(belief, events)


def explain(belief, cards):
    facts = [{"title": c["title"], "p_raw": c["p_raw"], "p_calibrated": c["p_calibrated"], "p_proxy": c["p_proxy"],
              "basis": c["basis"], "trust_score": c["trust_score"], "leakage_flag": c["leakage_flag"],
              "venues": {v: {"p": d["p"], "volume_24h": d["volume_24h"]} for v, d in c["venues"].items()}} for c in cards]
    if not available():
        c = cards[0]
        px = f"{c['p_proxy']*100:.0f}%" if c["p_proxy"] is not None else "no proxy"
        return (f"Markets price '{c['title']}' at {c['p_raw']*100:.0f}% (calibrated {c['p_calibrated']*100:.0f}%) versus {px} "
                f"from the traditional proxy; trust score is {c['trust_score']}/100. Set ANTHROPIC_API_KEY for a model-written explanation.")
    try:
        return _call(EXPLAIN_SYSTEM, f"Belief: {belief}\n\nNumbers:\n{json.dumps(facts)}", 300).strip()
    except Exception as e:  # noqa: BLE001
        log.warning("explain failed: %s", e)
        return None
