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
    """Append provisional records to a generated player list, replacing any
    already present. Idempotent, so re-running the feed never doubles them."""
    entries = load()
    if not entries:
        return players
    ids = {e['id'] for e in entries}
    kept = [p for p in players if p.get('id') not in ids]
    return kept + [record(e) for e in entries]
