#!/usr/bin/env python3
"""Does the Premier League publish AWAY kit artwork, and at what URL?

Marc, 5 Sept 2026: "someone has asked if we can have players in away kits when
they play away. im not bothered but i want to know if its possible."

The app draws kits from FPL's own image server:

    /dist/img/shirts/standard/shirt_{code}-110.png        outfield
    /dist/img/shirts/standard/shirt_{code}_1-110.png      goalkeeper

"standard" sitting in that path implies siblings, and a Chrome extension exists
that swaps FPL's own site to away kits — so the artwork is public somewhere.
What is not known is the filename, and the dev sandbox cannot find out: its
egress proxy blocks fantasy.premierleague.com outright, so every guess comes
back "blocked" rather than "found" or "missing". The runner has open internet.

Read-only. It fetches public images and prints what it found. It writes
nothing, commits nothing, and needs no credentials.

The comparison that matters is not "does the URL resolve" — a CDN can serve the
HOME shirt for an unknown variant, or a placeholder, and a 200 would look like
success. So this hashes each body and reports whether a candidate is genuinely
a DIFFERENT image from the home shirt for that same club. Same bytes means the
variant does not really exist, whatever the status code says.

Usage: python3 scripts/probe_kits.py
"""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://fantasy.premierleague.com/dist/img/shirts'
SIZE = '110'

# a spread: two big clubs whose away kits are unmistakably different from home,
# plus a promoted side, in case coverage is uneven
SAMPLE = ['ARS', 'LIV', 'MUN', 'EVE']

# every shape worth trying. _1 is the GK shirt in the scheme we already use, so
# _2 and _3 are the natural places for away kits; "special" and an explicit
# "away" are the other obvious guesses.
def candidates(code):
    return [
        (f'{BASE}/standard/shirt_{code}-{SIZE}.png', 'HOME outfield (the one we use — the baseline)'),
        (f'{BASE}/standard/shirt_{code}_1-{SIZE}.png', 'GK home (we use this too)'),
        (f'{BASE}/standard/shirt_{code}_2-{SIZE}.png', 'away outfield?'),
        (f'{BASE}/standard/shirt_{code}_3-{SIZE}.png', 'away GK / third?'),
        (f'{BASE}/standard/shirt_{code}_4-{SIZE}.png', 'fourth variant?'),
        (f'{BASE}/special/shirt_{code}-{SIZE}.png', 'a "special" sibling directory?'),
        (f'{BASE}/away/shirt_{code}-{SIZE}.png', 'an "away" sibling directory?'),
        (f'{BASE}/standard/shirt_{code}_away-{SIZE}.png', 'named "away"?'),
    ]


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'the-league/1.0 (kit probe)'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
            return r.status, body, None
    except urllib.error.HTTPError as e:
        return e.code, b'', None
    except Exception as e:
        return None, b'', str(e)[:90]


def main():
    feed = json.loads((ROOT / 'data' / 'data.json').read_text(encoding='utf-8'))
    codes = {t['short']: t['code'] for t in feed['teams']}
    print(f'kit probe — {SIZE}px assets, {len(SAMPLE)} clubs')
    print('=' * 78)

    verdict = {}
    for short in SAMPLE:
        code = codes.get(short)
        if code is None:
            print(f'{short}: not in this season\'s feed, skipping')
            continue
        print(f'\n{short} (code {code})')
        home_hash = None
        for url, what in candidates(code):
            status, body, err = fetch(url)
            tail = url.split('/dist/img/shirts/')[-1]
            if err:
                print(f'   {"ERR":>4}  {tail:<34} {what}  [{err}]')
                continue
            if status != 200 or not body:
                print(f'   {status:>4}  {tail:<34} {what}')
                continue
            h = hashlib.sha256(body).hexdigest()[:12]
            if home_hash is None:
                home_hash = h
                note = 'baseline'
            elif h == home_hash:
                note = 'SAME IMAGE as home — not a real variant'
            else:
                note = '*** DIFFERENT IMAGE ***'
                verdict.setdefault(tail.split('/')[0] + '/' + tail.split('shirt_')[1].replace(f'{code}', '{code}'), set()).add(short)
            print(f'   {status:>4}  {tail:<34} {len(body):>7}b  {h}  {note}')

    print('\n' + '=' * 78)
    if verdict:
        print('CANDIDATES THAT RETURNED A GENUINELY DIFFERENT IMAGE:')
        for pat, clubs in sorted(verdict.items()):
            print(f'   {pat}   for {", ".join(sorted(clubs))}')
        print('\nA pattern that works for EVERY club sampled is the one to use.')
    else:
        print('No candidate produced an image different from the home shirt.')
        print('On this evidence away kits are not available at these paths, and')
        print('the answer to Marc is no — not without hosting the artwork ourselves.')
    print('read-only: this script has no write path.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
