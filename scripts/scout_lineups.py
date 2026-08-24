#!/usr/bin/env python3
"""Read Fantasy Football Scout's predicted line-ups into our player ids.

Marc, 24 Aug 2026. The probe established that the page is fetchable
(robots.txt: `Disallow:` — everything allowed) and server-rendered, and
scripts/lineups.py established that their names can be matched onto ours.
This is the part that reads the page.

THE HAZARD, and the reason this parser is fussier than it looks: the page
carries editorial prose alongside the predicted XI, and the prose is full of
player names that are NOT selected —

    "Ross Barkley or Lamare Bogarde are options to come in for Joao Gomes...
     if Abraham isn't fit, Emery will have to play someone like Garnacho"

Barkley, Bogarde and Garnacho are being discussed, not picked. A parser that
swept the whole block would read all three as nailed-on starters, which is
worse than having no data at all — it would be confidently wrong, and the win
bar would repeat it without a flicker. So extraction is scoped strictly to the
`scout-picks` pitch subtree and never touches the prose.

Everything here fails CLOSED. A club that yields no XI, or a page that yields
too few clubs, is reported and dropped rather than half-written: the model we
already have is better than a corrupted version of it.

Usage:
    python3 scripts/scout_lineups.py --dry      fetch, parse, print, write nothing
    python3 scripts/scout_lineups.py            fetch, parse, write data/lineups.json
"""
import json
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

import lineups

ROOT = Path(__file__).resolve().parent.parent
SOURCE = 'https://www.fantasyfootballscout.co.uk/team-news'
UA = 'the-league/1.0 (+https://theleaguehq.co.uk; league projection bot)'

# a predicted XI is eleven men; anything well short of that is a parse that has
# come apart, not a manager with ideas
MIN_PER_CLUB = 8
MIN_CLUBS = 12


def classes(attrs):
    for k, v in attrs:
        if k == 'class' and v:
            return v.split()
    return []


def attr(attrs, want):
    for k, v in attrs:
        if k == want:
            return v
    return None


# tags that never close. Counting these as opens is what broke the first
# version against the live page: the depth drifted up, the club block never
# closed, and every club on the page was swallowed into the first one.
VOID = {'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'col', 'area',
        'base', 'embed', 'param', 'track', 'wbr'}


class ScoutParser(HTMLParser):
    """Pull each club's predicted XI out of its own pitch subtree.

    A club block is delimited by its data-team-code, NOT by counting its way
    to a matching close tag: the live page has unclosed <li> and bare <img>,
    and any depth count over the whole block drifts and never comes home. The
    next team-news-item closes the previous one, which real markup cannot break.

    Inside a block the pitch still needs depth, because the prose sits beside
    it and only nesting tells them apart — but that count skips void tags and
    is bounded by the block, so a stray tag costs one club, never the page.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.clubs = {}
        self._club = None          # team code of the block we are inside
        self._pitch_depth = 0      # >0 while inside the scout-picks subtree
        self._name_depth = 0       # >0 while inside a player-name element
        self._buf = []
        self._text = []            # every bit of text in the block, for "Last Updated"

    def _close_club(self):
        if self._club is None:
            return
        blob = ' '.join(self._text)
        m = re.search(r'Last Updated\s*:?\s*([^<|]{3,40})', blob)
        if m:
            self.clubs[self._club]['updated'] = m.group(1).strip()
        self._club = None
        self._pitch_depth = 0
        self._name_depth = 0
        self._text = []

    def handle_starttag(self, tag, attrs):
        cls = classes(attrs)
        code = attr(attrs, 'data-team-code')
        if code and 'team-news-item' in cls:
            self._close_club()                      # the previous block ends here
            self._club = code.strip().lower()
            self.clubs.setdefault(self._club, {'xi': [], 'formation': None, 'updated': None})
            return
        if self._club is None or tag in VOID:
            return
        if self._pitch_depth:
            self._pitch_depth += 1
            # the name may sit on a span inside the player cell
            if any(c == 'player-name' or c.startswith('player-name') for c in cls):
                if not self._name_depth:
                    self._buf = []
                self._name_depth += 1
            elif self._name_depth:
                self._name_depth += 1
        elif 'scout-picks' in cls:
            # the pitch itself. `scoutpicksweek` is a different feature (their
            # weekly captain picks) and must not be swept up.
            self._pitch_depth = 1
            for c in cls:
                if c.startswith('formation-'):
                    self.clubs[self._club]['formation'] = c[len('formation-'):]

    def handle_endtag(self, tag):
        if self._club is None or tag in VOID:
            return
        if self._name_depth:
            self._name_depth -= 1
            if self._name_depth == 0:
                name = re.sub(r'\s+', ' ', ''.join(self._buf)).strip()
                if name:
                    self.clubs[self._club]['xi'].append(name)
        if self._pitch_depth:
            self._pitch_depth -= 1

    def handle_data(self, data):
        if self._club is None:
            return
        if self._name_depth:
            self._buf.append(data)
        self._text.append(data)


def parse(html):
    p = ScoutParser()
    p.feed(html)
    p._close_club()                                 # the last block on the page
    return p.clubs


MONTHS = {m: i + 1 for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}


def stamp_to_date(text, now=None):
    """"Fri 21st Aug" -> "2026-08-21". None if it will not read.

    Their stamp carries no year, so take whichever year puts the date nearest
    today — that is the only reading that survives the turn of the year, when
    "Sat 2nd Jan" is written a week after "Tue 29th Dec".

    The date is the whole point of the stamp: an XI last touched before the
    previous round finished is not a prediction for this one, and the model has
    to be able to tell the difference.
    """
    import datetime as dt
    if not text:
        return None
    now = now or dt.datetime.now(dt.timezone.utc)
    m = re.search(r'(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3})', text)
    if not m:
        return None
    day, mon = int(m.group(1)), MONTHS.get(m.group(2)[:3].lower())
    if not mon:
        return None
    best = None
    for year in (now.year - 1, now.year, now.year + 1):
        try:
            cand = dt.date(year, mon, day)
        except ValueError:
            continue
        gap = abs((cand - now.date()).days)
        if best is None or gap < best[0]:
            best = (gap, cand)
    return best[1].isoformat() if best else None


def to_ids(raw, players):
    """Their names -> our ids, per club. Unmatched names are reported, never guessed."""
    index = lineups.build_index(players)
    index.pop('_dropped', None)
    index.pop('_rescued', None)
    # their team code is not necessarily our club short code
    ours = {lineups.norm(p.get('club')) for p in players if p.get('club')}
    out, unknown_clubs, unmatched = {}, [], []
    for code, block in raw.items():
        key = lineups.norm(code)
        if key not in ours:
            unknown_clubs.append(code)
            continue
        ids, misses = [], []
        for name in block['xi']:
            pid = lineups.match(name, key, index)
            if pid is None:
                misses.append(name)
            elif pid not in ids:
                ids.append(pid)
        if misses:
            unmatched.append((code, misses))
        out[key.upper()] = {
            'xi': ids,
            'formation': block.get('formation'),
            'updated': block.get('updated'),
            'updatedOn': stamp_to_date(block.get('updated')),
            'named': len(block['xi']),
            'unmatched': misses,
        }
    return out, unknown_clubs, unmatched


def fetch(url=SOURCE):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,*/*'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')


def build(html, players):
    raw = parse(html)
    clubs, unknown_clubs, unmatched = to_ids(raw, players)
    thin = [c for c, b in clubs.items() if len(b['xi']) < MIN_PER_CLUB]
    for c in thin:                      # fail closed, per club
        clubs.pop(c)
    ok = len(clubs) >= MIN_CLUBS
    return {
        'source': SOURCE,
        'fetched': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'clubs': clubs,
    }, {'unknown_clubs': unknown_clubs, 'unmatched': unmatched, 'thin': thin, 'ok': ok}


# Marc's cadence, as hours before the deadline rather than days of the week:
# the morning after the last round, Thursday, Friday, and again before kickoff.
# Days of the week would misfire on every midweek round, and there are several.
WINDOWS = [96, 72, 48, 24, 3]


def window_now(gameweeks, now=None):
    """Which fetch window are we in? -> (gw number, window hours, hours out).

    Not "is the clock within an hour of T-24", because GitHub's scheduler runs
    20 to 70 minutes behind its cron and a narrow band would simply be missed.
    Instead: the tightest window we have ENTERED. Pair that with the round and
    it names a slot — (GW2, T-24h) — and the fetcher takes each slot once,
    whenever the runner actually turns up.
    """
    import datetime as dt
    now = now or dt.datetime.now(dt.timezone.utc)
    nxt = None
    for g in gameweeks:
        try:
            when = dt.datetime.fromisoformat(g['deadline'].replace('Z', '+00:00'))
        except Exception:
            continue
        if when > now and (nxt is None or when < nxt[1]):
            nxt = (g.get('n'), when)
    if not nxt:
        return None, None, None
    hrs = (nxt[1] - now).total_seconds() / 3600
    entered = [w for w in WINDOWS if hrs <= w]
    if not entered:
        return nxt[0], None, hrs      # still too early in the week
    return nxt[0], min(entered), hrs


def main():
    dry = '--dry' in sys.argv
    force = '--force' in sys.argv
    players = lineups.load_players()
    slot = None
    if not dry and not force:
        gws = json.loads((ROOT / 'data' / 'data.json').read_text(encoding='utf-8'))['gameweeks']
        gw, win, hrs = window_now(gws)
        if win is None:
            print(f'too early in the week ({hrs:.0f}h to the deadline)' if hrs is not None
                  else 'no deadline ahead — nothing to fetch for')
            return 0
        slot = f'gw{gw}-T{win}h'
        try:
            done = json.loads((ROOT / 'data' / 'lineups.json').read_text(encoding='utf-8')).get('slot')
        except Exception:
            done = None
        if done == slot:
            print(f'{slot} already fetched ({hrs:.0f}h to the deadline)')
            return 0
        print(f'fetch window {slot} ({hrs:.0f}h to the deadline)')
    html = fetch()
    print(f'fetched {len(html):,} bytes from {SOURCE}')
    book, report = build(html, players)
    clubs = book['clubs']
    print(f'clubs with a usable XI: {len(clubs)}')
    for code in sorted(clubs):
        b = clubs[code]
        print(f"  {code:<4} {len(b['xi']):>2}/11  formation {b['formation'] or '?':<8} "
              f"updated {b['updated'] or '?':<16}"
              f"{'  UNMATCHED: ' + ', '.join(b['unmatched']) if b['unmatched'] else ''}")
    if report['thin']:
        print(f"dropped for too few names: {', '.join(report['thin'])}")
    if report['unknown_clubs']:
        print(f"team codes we do not recognise: {', '.join(report['unknown_clubs'])}")
    if not report['ok']:
        print(f"REFUSING: only {len(clubs)} clubs parsed, need {MIN_CLUBS}. "
              f"Writing nothing — the existing model is better than a broken feed.")
        return 1
    if dry:
        print('\ndry run — nothing written.')
        return 0
    if slot:
        book['slot'] = slot
    (ROOT / 'data' / 'lineups.json').write_text(
        json.dumps(book, ensure_ascii=False, sort_keys=True), encoding='utf-8')
    print(f"wrote data/lineups.json ({len(clubs)} clubs)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
