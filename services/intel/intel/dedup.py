"""Independence: which articles are one piece of writing, who wrote it, and how many owners stand behind a story.

Twelve sites running the same Reuters story are one source. Copies are found three ways: the same canonical
URL, the same long headline on the same day, or body text that mostly contains the other's (word 5-gram
containment, so a local paper running the first half of a wire story still matches). Each copy cluster gets
one origin: a wire credit in any member wins ("(Reuters) -", "--(BUSINESS WIRE)--", an AP byline), then a
canonical link pointing at another site (a repost naming its original), then the earliest member's own site.
Origins under one owner (WSJ, MarketWatch, Barron's) count once, at the best tier among them. Paywall
teasers are left out: a headline behind a login isn't evidence.

`corroborate` assumes every article it's handed bears on the same claim; choosing those is the caller's job.
"""
import hashlib
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from w3lib.url import canonicalize_url

TRACKING = {"fbclid", "gclid", "dclid", "msclkid", "yclid", "cmpid", "cmp", "ocid", "taid", "smid", "sr_share",
            "ref", "ref_src", "src", "mod", "ncid", "soc_src", "soc_trk", "s_cid", "yptr", "guccounter", "rss",
            "feedtype", "partner", "mbid", "cid", "ito", "itm_source", "itm_medium", "itm_campaign"}
TRACKING_PREFIXES = ("utm_", "mc_", "guce_", "__twitter", "_hs", "pk_")
SHINGLE = 5
CONTAINMENT = 0.6       # share of the shorter text's shingles found in the longer one
NEAR_BITS = 18          # SimHash shortlist radius; containment makes the actual call
MIN_SHINGLES = 20       # below this a text is too short to call a copy on wording alone
TITLE_WORDS = 8         # headlines shorter than this are too generic to match on
CREDIT_WINDOW = 600     # datelines sit at the top, "Reporting by ...; Editing by" at the bottom


def canonical(url):
    """One spelling per article: https, no www./amp., no tracking params or fragment, sorted query, no trailing slash."""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    for prefix in ("www.", "amp.", "m."):
        if host.startswith(prefix) and host.count(".") > 1:
            host = host[len(prefix):]
    path = re.sub(r"/amp/?$|\.amp(?=\.html?$)", "", parts.path) or "/"
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if k.lower() not in TRACKING and not k.lower().startswith(TRACKING_PREFIXES) and k.lower() != "amp"]
    url = canonicalize_url(urlunsplit(("https", host, path, urlencode(query), "")))
    return url[:-1] if url.endswith("/") and urlsplit(url).path != "/" else url


def words(text):
    return re.findall(r"\w+", unicodedata.normalize("NFKC", text or "").lower())


def shingles(text, k=SHINGLE):
    w = words(text)
    return {hash(tuple(w[i:i + k])) for i in range(len(w) - k + 1)}


def containment(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def simhash(text, k=2):
    """64-bit SimHash over word bigrams weighted by count, stable across runs so it can be stored.

    Coarse on article-length text: copies land within ~12 bits, independent stories on the same event
    ~24 and up. Use it to shortlist candidates and let `containment` decide.
    """
    w = words(text)
    v = [0] * 64
    for feat, n in Counter(" ".join(w[i:i + k]) for i in range(max(len(w) - k + 1, 1 if w else 0))).items():
        h = int.from_bytes(hashlib.blake2b(feat.encode(), digest_size=8).digest(), "big")
        for bit in range(64):
            v[bit] += n if h >> bit & 1 else -n
    return sum(1 << bit for bit in range(64) if v[bit] > 0)


def hamming(a, b):
    return (a ^ b).bit_count()


def detect_credit(article, registry):
    """The wire or release service an article credits, or None. Searches the dateline, the sign-off and the byline."""
    text = article.text or ""
    spots = (text[:CREDIT_WINDOW], text[-CREDIT_WINDOW:], "\n".join(article.authors))
    for src in registry.creditors:
        if any(p.search(spot) for p in src.credits for spot in spots):
            return src
    return None


def origin(article, registry, credit=None):
    """Who wrote this copy: the credited wire, else the site its canonical names, else the site it's on."""
    own = registry.lookup(article.url)
    credit = credit or detect_credit(article, registry)
    if credit:
        return credit
    named = registry.lookup(article.canonical_url) if article.canonical_url else own
    return named if named.group != own.group and named.tier != "aggregator" else own


@dataclass
class Cluster:
    members: list
    origin: object

    @property
    def urls(self):
        return [m.url for m in self.members]


@dataclass
class Origin:
    group: str
    name: str
    tier: str
    weight: float
    urls: list = field(default_factory=list)
    clusters: int = 0


@dataclass
class Corroboration:
    origins: list
    clusters: list
    excluded: list

    @property
    def score(self):
        return round(sum(o.weight for o in self.origins), 3)

    @property
    def independent(self):
        return sum(1 for o in self.origins if o.weight > 0)

    @property
    def has_primary(self):
        return any(o.tier == "primary" for o in self.origins)

    def to_dict(self):
        return {"score": self.score, "independent": self.independent, "has_primary": self.has_primary,
                "origins": [vars(o) for o in self.origins], "excluded": self.excluded,
                "clusters": [{"origin": c.origin.name, "urls": c.urls} for c in self.clusters]}


def _title_key(a):
    w = words(a.title)
    return (" ".join(w), a.published[:10]) if len(w) >= TITLE_WORDS and a.published else None


def cluster(articles, registry):
    parent = list(range(len(articles)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    seen = {}
    for i, a in enumerate(articles):
        for key in (("url", canonical(a.canonical_url or a.url)), ("title", _title_key(a))):
            if key[1] is None:
                continue
            if key in seen:
                union(i, seen[key])
            else:
                seen[key] = i
    sh = [shingles(a.text) for a in articles]
    for i in range(len(articles)):
        if len(sh[i]) < MIN_SHINGLES:
            continue
        for j in range(i + 1, len(articles)):
            if len(sh[j]) >= MIN_SHINGLES and find(i) != find(j) and containment(sh[i], sh[j]) >= CONTAINMENT:
                union(i, j)

    groups = {}
    for i in range(len(articles)):
        groups.setdefault(find(i), []).append(articles[i])
    out = []
    for members in groups.values():
        members.sort(key=lambda m: (m.published or "9999", m.url))
        by_credit = next((s for s in (detect_credit(m, registry) for m in members) if s), None)
        found = [origin(m, registry) for m in members]
        by_canonical = next((s for m, s in zip(members, found) if s.group != registry.lookup(m.url).group), None)
        by_site = next((s for s in found if s.tier != "aggregator"), found[0])
        out.append(Cluster(members, by_credit or by_canonical or by_site))
    return out


def corroborate(articles, registry):
    usable = [a for a in articles if not a.stub]
    clusters = cluster(usable, registry)
    by_group = {}
    for c in clusters:
        o = by_group.get(c.origin.group)
        if o is None:
            o = by_group[c.origin.group] = Origin(c.origin.group, c.origin.name, c.origin.tier, c.origin.weight)
        elif c.origin.weight > o.weight:
            o.name, o.tier, o.weight = c.origin.name, c.origin.tier, c.origin.weight
        o.urls.extend(c.urls)
        o.clusters += 1
    origins = sorted(by_group.values(), key=lambda o: (-o.weight, o.group))
    return Corroboration(origins, clusters, [a.url for a in articles if a.stub])
