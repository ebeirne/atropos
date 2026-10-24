"""Source registry: who a domain is, how much it counts, and who owns it.

Lookup walks the host from most to least specific (markets.businessinsider.com, then businessinsider.com),
so a listed subdomain like finance.yahoo.com wins over its parent. Hosts that aren't listed fall back to
their registrable domain as both name and group, at the `unknown` tier, except investor./investors./ir.
hosts, which are a company's own IR site and count as primary.
"""
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from tld import get_fld

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "sources.toml"
IR_PREFIXES = ("investor.", "investors.", "ir.")


@dataclass(frozen=True)
class Source:
    domain: str
    name: str
    tier: str
    group: str
    weight: float
    credits: tuple = field(default=(), compare=False, repr=False)


def host_of(url_or_host):
    host = urlsplit(url_or_host).hostname if "//" in url_or_host else url_or_host
    host = (host or "").lower().rstrip(".")
    return host[4:] if host.startswith("www.") else host


def registrable(host):
    return get_fld(host, fix_protocol=True, fail_silently=True) or host


class Registry:
    def __init__(self, path=DEFAULT_PATH):
        cfg = tomllib.loads(Path(path).read_text(encoding="utf-8"))
        self.weights = {k: float(v) for k, v in cfg["tiers"].items()}
        self.sources = {}
        for row in cfg.get("source", []):
            if row["tier"] not in self.weights:
                raise ValueError(f"{row['domain']}: unknown tier {row['tier']!r}")
            credits = tuple(re.compile(p, re.M) for p in row.get("credits", ()))
            domain = row["domain"].lower()
            self.sources[domain] = Source(domain, row["name"], row["tier"], row.get("group", domain),
                                          self.weights[row["tier"]], credits)
        self.creditors = [s for s in self.sources.values() if s.credits]

    def lookup(self, url_or_host):
        host = host_of(url_or_host)
        labels = host.split(".")
        for i in range(len(labels) - 1):
            hit = self.sources.get(".".join(labels[i:]))
            if hit:
                return hit
        fld = registrable(host)
        # investor.apple.com is Apple's own IR site; investors.com itself is a newspaper
        tier = "primary" if host.startswith(IR_PREFIXES) and host != fld else "unknown"
        return Source(fld, fld, tier, fld, self.weights[tier])

    def by_domain(self, domain):
        return self.sources[domain]
