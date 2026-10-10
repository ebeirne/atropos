"""Fetch Kalshi's published contract terms for the releases Atty quotes, and keep their text.

Kalshi posts the terms of every contract family as PDFs in a public document store
(kalshi-public-docs.s3.amazonaws.com/contract_terms/). Atty reads them for the edge
cases that decide whether protection pays at all: what happens if the agency delays or
skips the release, which number counts (first print, rounding), and when trading stops.

    python -I scripts/fetch_rules.py          -> data/rules/<NAME>.txt and data/rules/index.json
"""
import io, json, sys, time, urllib.request
from pathlib import Path

from pypdf import PdfReader

BASE = 'https://kalshi-public-docs.s3.amazonaws.com/contract_terms/'
UA = 'Atropos/1.0 (local research tool)'
# the families behind the contracts Atty quotes, and the ones about delays
NAMES = {
    'YOYCPI': 'cpi', 'ACPI': 'cpi', 'CPI': 'cpi', 'CORECPI': 'cpi', 'CPIDELAY': 'cpi',
    'PAYROLLS': 'nfp', 'JOBS': 'nfp', 'NFPDELAY': 'nfp',
    'FEDDECISION': 'fomc', 'FED': 'fomc',
}
OUT = Path(__file__).resolve().parent.parent / 'data' / 'rules'


def fetch(name):
    req = urllib.request.Request(BASE + name + '.pdf', headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        if 'pdf' not in r.headers.get('Content-Type', ''):
            raise ValueError('not a PDF')
        data = r.read()
    if len(data) > 5_000_000:
        raise ValueError('unexpectedly large')
    text = '\n'.join((p.extract_text() or '') for p in PdfReader(io.BytesIO(data)).pages)
    return ' '.join(text.split())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = {'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'source': BASE, 'families': {}}
    for name, release in NAMES.items():
        try:
            text = fetch(name)
            (OUT / f'{name}.txt').write_text(text, encoding='utf-8')
            index['families'][name] = {'release': release, 'chars': len(text), 'url': BASE + name + '.pdf'}
            print(f'{name:12} {release:5} {len(text):6} chars')
        except Exception as e:  # keep going; a missing family is reported, not fatal
            index['families'][name] = {'release': release, 'error': str(e)}
            print(f'{name:12} {release:5} skipped: {e}', file=sys.stderr)
        time.sleep(0.3)
    (OUT / 'index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
