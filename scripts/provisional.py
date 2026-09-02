"""Committee-issued provisional players.

A signing can be announced, medicalled and photographed in a scarf days before
the FPL API knows he exists. Drafting him used to mean picking a departed
player as a stand-in and everyone remembering the arrangement until April.

Instead, `data/provisional.json` lists such players by hand and they are merged
into the generated feed by fetch_fpl.py — so they reach the CLIENT (js/data.js)
and the SERVER (data/data.json) from the same source, and survive every
scheduled refresh. A provisional that is not re-merged would leave whoever
drafted him holding "#900001 (unknown)".

IDs live at 900001+. FPL element ids are in the hundreds, so the ranges can
never meet; anything in this range is provisional by definition.

When the real player lands in the feed, the Chairman hands him over and the
entry is deleted from data/provisional.json. Until then he simply records no
minutes, which the auto-subs already treat as "did not play".
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROVISIONAL_FILE = ROOT / 'data' / 'provisional.json'
ID_FLOOR = 900001

REQUIRED = ('id', 'name', 'team', 'club', 'pos', 'price')
POSITIONS = ('GK', 'DF', 'MF', 'FW')


def load():
    """Read and validate data/provisional.json. Returns [] when absent."""
    if not PROVISIONAL_FILE.exists():
        return []
    entries = json.loads(PROVISIONAL_FILE.read_text(encoding='utf-8'))
    if not isinstance(entries, list):
        raise ValueError('provisional.json must be a list')
    seen = set()
    for e in entries:
        for k in REQUIRED:
            if k not in e:
                raise ValueError(f'provisional entry missing "{k}": {e}')
        if not isinstance(e['id'], int) or e['id'] < ID_FLOOR:
            raise ValueError(f'provisional id must be an integer >= {ID_FLOOR}: {e["id"]}')
        if e['id'] in seen:
            raise ValueError(f'duplicate provisional id {e["id"]}')
        if e['pos'] not in POSITIONS:
            raise ValueError(f'bad position {e["pos"]!r} (want one of {POSITIONS})')
        seen.add(e['id'])
    return entries


def record(e):
    """Build a full player record — every field the app reads must be present,
    or a provisional lands on the board as a pile of undefineds."""
    price = float(e['price'])
    return {
        'id': e['id'],
        'name': e['name'],
        'full': e.get('full') or e['name'],
        'team': e['team'],
        'club': e['club'],
        'pos': e['pos'],
        # no FPL code exists yet; the id doubles as one so nothing collides
        # with a real player's history in js/history25.js
        'code': e['id'],
        'status': 'a',
        'news': e.get('note') or 'Signed. Awaiting the FPL feed.',
        'newsAdded': e.get('signed') or '',
        'chance': None,
        'price': price,
        'pts': 0,
        # no history and no points, so the board ranks him on price — the same
        # fallback every genuinely new arrival gets (Ben's ruling, UAT night)
        'rating': round(price),
        'xp': 0.0,
        'ppg': 0.0,
        'mp': 0,
        'g': 0,
        'a': 0,
        'cs': 0,
        'xg': 0.0,
        'xa': 0.0,
        'nat': e.get('nat'),
        # the one field real players never carry: everything downstream keys
        # off this rather than sniffing the id range
        'provisional': True,
    }


def merge(players):
    """Rebuild the provisional tail of a generated player list from
    data/provisional.json, which is the single source of truth.

    EVERY existing provisional is stripped first, then the declared ones are
    appended. That is what makes deletion work: the handover — the whole point
    of the mechanism — is "remove the entry, re-run". An earlier version only
    replaced ids it found in the file, so a removed entry (or an emptied file)
    left the placeholder in the feed for ever, silently.

    Idempotent in both directions: re-running never doubles an entry, and
    nothing declared is nothing carried."""
    entries = load()
    ids = {e['id'] for e in entries}
    kept = [p for p in players
            if not p.get('provisional') and p.get('id') not in ids and p.get('id', 0) < ID_FLOOR]
    return kept + [record(e) for e in entries]


# ---------------------------------------------------------------------------
# Men the feed still has at the WRONG CLUB
#
# Marc, 2 Sept 2026: "you appear to have missed tosin, how did this happen?"
#
# Because there was nothing to see. The holding pen compares a man's club in
# the feed against his club in the draft-night snapshot. Tosin moved on
# deadline day and FPL had not processed it — the feed said Chelsea, the
# snapshot said Chelsea, so no rule anywhere could tell he had gone. The pen is
# only ever as current as its source.
#
# provisional.json above covers the man the feed does not have AT ALL. It does
# not cover this: a man the feed has, at a club he has left. Same disease, and
# until now no cure — and no manual lever either, since the Chairman can
# release a man FROM the pen but has no way to put one in.
#
# So: data/moved.json states where a man actually plays, and the feed is
# corrected on the next refresh — which puts him in the pen by the ordinary
# rule, with no special case anywhere downstream. Same handover discipline as a
# provisional: when FPL catches up, delete the entry.
MOVED_FILE = ROOT / 'data' / 'moved.json'
MOVED_REQUIRED = ('id', 'club')


def load_moves():
    """Read and validate data/moved.json. Returns [] when absent."""
    if not MOVED_FILE.exists():
        return []
    entries = json.loads(MOVED_FILE.read_text(encoding='utf-8'))
    if not isinstance(entries, list):
        raise ValueError('moved.json must be a list')
    seen = set()
    for e in entries:
        for k in MOVED_REQUIRED:
            if k not in e:
                raise ValueError(f'moved entry missing "{k}": {e}')
        if not isinstance(e['id'], int):
            raise ValueError(f'moved id must be an integer: {e["id"]!r}')
        if e['id'] in seen:
            raise ValueError(f'duplicate moved id {e["id"]}')
        seen.add(e['id'])
    return entries


def apply_moves(players, teams):
    """Correct the club of men data/moved.json says have moved.

    `teams` is the feed's own team list, so the full club name can never
    disagree with the code — state the code, the name follows.

    An id the feed does not carry is an ERROR, not a shrug. A typo that
    silently corrects nobody is exactly how a man goes missing from the pen,
    which is the fault this whole mechanism exists to fix.

    An entry the feed has already caught up with is left alone and reported, so
    the Chairman knows to delete it. It is not an error: the refresh runs every
    five minutes and must not start failing the moment FPL does its job.

    Returns (players, notes) — the list is corrected in place and also
    returned, for callers that prefer the expression."""
    entries = load_moves()
    if not entries:
        return players, []
    by_short = {t['short']: t for t in teams}
    by_id = {p.get('id'): p for p in players}
    notes = []
    for e in entries:
        p = by_id.get(e['id'])
        if not p:
            raise ValueError(f'moved.json names id {e["id"]}, which is not in the feed')
        club = str(e['club']).upper()
        t = by_short.get(club)
        if not t:
            raise ValueError(f'moved.json gives id {e["id"]} the club {club!r}, '
                             f'which is not a club this season')
        if p.get('club') == club:
            notes.append(f'{p["name"]}: the feed already has him at {club} — delete this entry')
            continue
        notes.append(f'{p["name"]}: {p.get("club")} -> {club} (the feed still says {p.get("club")})')
        p['club'] = club
        p['team'] = t['name']
        # say so on his card rather than letting the correction be invisible
        if not p.get('news'):
            p['news'] = e.get('note') or f'Signed for {t["name"]}. Awaiting the FPL feed.'
            p['newsAdded'] = e.get('signed') or ''
    return players, notes
