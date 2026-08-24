#!/usr/bin/env python3
"""Probe a predicted-line-ups source. Read-only: prints, never writes.

Marc, 24 Aug 2026, wants the projection weighted by predicted line-ups rather
than by our own start history alone. Before a line of parser gets written, four
things have to be established against the real page, and none of them can be
guessed:

  1. does robots.txt allow us to fetch it at all
  2. is the page server-rendered, or drawn by JavaScript after load (a plain
     fetch of a JS-rendered page returns an empty shell and a parser built on
     it would silently return nothing forever)
  3. what the markup around the line-ups actually looks like
  4. how their player names compare to ours — the name map is where these
     integrations really die (the Sky highlights map needed hand-fixing for
     four names; this would be seven hundred)

The dev sandbox cannot reach these hosts — its egress proxy is an allowlist and
blocks even the FPL API. The GitHub runner can, so this runs there via the
"Probe lineup sources" workflow and reports back through the job log.

Usage: python3 scripts/probe_lineups.py [url ...]
"""
import json
import re
import sys
import urllib.error
import urllib.request
import urllib.robotparser
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
UA = 'the-league/1.0 (+https://theleaguehq.co.uk; league projection bot)'

DEFAULT_SOURCES = [
    'https://www.fantasyfootballpundit.com/fantasy-premier-league-team-news/',
    'https://www.fantasyfootballscout.co.uk/team-news',
]


def our_names():
    """web_name and surname for every player we know, longest first."""
    data = json.loads((ROOT / 'data' / 'data.json').read_text(encoding='utf-8'))
    names, surnames = [], []
    for p in data['players']:
        n = (p.get('name') or '').strip()
        if len(n) >= 4:
            names.append(n)
        full = (p.get('full') or '').strip()
        if full:
            last = full.split()[-1]
            if len(last) >= 4:
                surnames.append(last)
    return sorted(set(names), key=len, reverse=True), sorted(set(surnames), key=len, reverse=True)


def robots_verdict(url):
    base = f'{urlsplit(url).scheme}://{urlsplit(url).netloc}'
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(base + '/robots.txt')
    try:
        raw = fetch(base + '/robots.txt')[1]
    except Exception as e:
        return None, f'could not read robots.txt ({e}) — treat as unknown, do NOT assume permission'
    rp.parse(raw.splitlines())
    allowed = rp.can_fetch(UA, url)
    delay = rp.crawl_delay(UA)
    head = '\n'.join('      ' + ln for ln in raw.splitlines()[:40])
    return allowed, f'crawl-delay {delay}\n    robots.txt (first 40 lines):\n{head}'


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,*/*'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode('utf-8', 'replace')


def probe(url, names, surnames):
    print(f'\n{"=" * 78}\n{url}\n{"=" * 78}')

    allowed, detail = robots_verdict(url)
    print(f'  robots: {"ALLOWED" if allowed else "DISALLOWED" if allowed is False else "UNKNOWN"} — {detail}')
    if allowed is not True:
        print('  -> not fetching the page. Permission is not established.')
        return

    try:
        status, html = fetch(url)
    except urllib.error.HTTPError as e:
        print(f'  fetch: HTTP {e.code} — {e.reason}')
        return
    except Exception as e:
        print(f'  fetch: failed — {e}')
        return
    print(f'  fetch: HTTP {status}, {len(html):,} bytes')

    # 2. server-rendered, or an empty JS shell?
    hits = [n for n in names if n in html]
    shits = [n for n in surnames if n in html]
    print(f'  our web_names present verbatim: {len(hits)} of {len(names)}')
    print(f'  our surnames present verbatim:  {len(shits)} of {len(surnames)}')
    if len(hits) + len(shits) < 20:
        print('  -> almost no player names in the raw HTML. This page is drawn by')
        print('     JavaScript; a plain fetch will never see the line-ups. It would')
        print('     need a headless browser in the action (puppeteer-core is already')
        print('     a dependency), or a different source.')
        print(f'  first 600 bytes of body for reference:\n{html[:600]}')
        return
    print(f'  sample matched: {", ".join(hits[:12] or shits[:12])}')

    # 3. what wraps them — the class names a parser would select on
    classes = Counter()
    for n in (hits or shits)[:60]:
        for m in re.finditer(re.escape(n), html):
            window = html[max(0, m.start() - 400):m.start()]
            for c in re.findall(r'class="([^"]{1,80})"', window)[-3:]:
                classes[c.strip()] += 1
    print('  commonest classes within 400 chars before a player name:')
    for c, k in classes.most_common(15):
        print(f'      {k:4}  {c}')

    # a verbatim slice around the first match, so the parser is written against
    # the real thing rather than a description of it
    first = (hits or shits)[0]
    at = html.find(first)
    print(f'\n  --- raw HTML around "{first}" ---')
    print(html[max(0, at - 900):at + 900])
    print('  --- end slice ---')

    # 4. how bad is the name map? which of OUR players never appear at all
    missing = [n for n in names if n not in html]
    print(f'\n  our players absent from the page: {len(missing)}')
    print(f'  a sample of the absent: {", ".join(missing[:25])}')


def main():
    urls = sys.argv[1:] or DEFAULT_SOURCES
    names, surnames = our_names()
    print(f'we know {len(names)} web_names and {len(surnames)} surnames')
    print(f'user-agent: {UA}')
    for u in urls:
        try:
            probe(u, names, surnames)
        except Exception as e:
            print(f'  probe failed for {u}: {e!r}')
    print('\nprobe complete — nothing was written or committed.')


if __name__ == '__main__':
    main()
