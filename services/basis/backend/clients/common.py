"""Shared httpx client with a file cache so any upstream failure degrades to the last good response."""
import json, hashlib, time, logging
import httpx
from backend.config import CACHE_DIR

log = logging.getLogger("basis.http")
_client = httpx.Client(timeout=httpx.Timeout(60, connect=15), headers={"User-Agent": "basis-hackathon/0.1"})


def _key(url, params):
    return hashlib.sha1((url + json.dumps(params or {}, sort_keys=True)).encode()).hexdigest()


def get_json(url, params=None, ttl=None):
    """Return (json, stale). On HTTP/network error, return the cached copy with stale=True (or raise if none)."""
    k = CACHE_DIR / (_key(url, params) + ".json")
    if ttl and k.exists() and time.time() - k.stat().st_mtime < ttl:
        return json.loads(k.read_text())["data"], False
    try:
        for attempt in range(5):
            r = _client.get(url, params=params)
            if r.status_code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            break
        r.raise_for_status()
        data = r.json()
        k.write_text(json.dumps({"url": url, "params": params, "data": data}))
        return data, False
    except Exception as e:  # noqa: BLE001
        log.warning("GET %s failed (%s); using cache=%s", url, e, k.exists())
        if k.exists():
            return json.loads(k.read_text())["data"], True
        raise


def get_text(url, params=None, ttl=None):
    k = CACHE_DIR / (_key(url, params) + ".txt")
    if ttl and k.exists() and time.time() - k.stat().st_mtime < ttl:
        return k.read_text(), False
    try:
        r = _client.get(url, params=params)
        r.raise_for_status()
        k.write_text(r.text)
        return r.text, False
    except Exception as e:  # noqa: BLE001
        log.warning("GET %s failed (%s)", url, e)
        if k.exists():
            return k.read_text(), True
        raise
