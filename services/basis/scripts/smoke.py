"""Smoke test: every endpoint returns 200 and the key fields are populated."""
from fastapi.testclient import TestClient
from backend.main import app
c = TestClient(app)
evs = c.get("/events").json(); assert evs, "no events"
print(f"/events: {len(evs)} events; with proxy: {sum(1 for e in evs if e['p_proxy'] is not None)}")
for e in evs:
    assert e["p_raw"] is not None, e["id"]
    print(f"  {e['id']:26s} raw={e['p_raw']:.3f} cal={e['p_calibrated']:.3f} proxy={e['p_proxy'] if e['p_proxy'] is None else round(e['p_proxy'],3)} basis={None if e['basis'] is None else round(e['basis'],3)} z={None if e['basis_z'] is None else round(e['basis_z'],2)} trust={e['trust_score']} leak={e['leakage_flag']}")
d = c.get(f"/events/{evs[0]['id']}").json(); assert d["history"] and d["betas"] is not None
cal = c.get("/calibration").json(); assert cal["bins"]
sc = c.post("/scenario", json={"event_id": evs[0]["id"], "p_new": 0.9}).json(); assert "moves" in sc
print("scenario:", sc["moves"][:2])
print("divergence top:", [(r["id"], r["divergence_score"]) for r in c.get("/divergence").json()[:3]])
print("arb:", [(r["id"], round(r["net_edge"],3)) for r in c.get("/arb").json()])
print("SMOKE OK")
