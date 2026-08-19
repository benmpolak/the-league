#!/usr/bin/env python3
"""Merge data/provisional.json into the ALREADY-generated feed files.

fetch_fpl.py does this as part of a full refresh, but a full refresh pulls a
fresh FPL snapshot — not something to do an hour before a draft. This applies
only the provisional merge, in place, touching nothing else:

    python3 scripts/apply_provisional.py          # apply
    python3 scripts/apply_provisional.py --check  # report, write nothing

Idempotent: provisional ids already present are replaced, not doubled, so
running it twice is the same as running it once. Removing an entry from
data/provisional.json and re-running removes the player from the feed.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import provisional  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / 'js' / 'data.js'
DATA_JSON = ROOT / 'data' / 'data.json'
PLAYERS_RE = re.compile(r'^const PLAYERS = (\[.*\]);$', re.MULTILINE)


def main():
    check_only = '--check' in sys.argv
    entries = provisional.load()

    src = DATA_JS.read_text(encoding='utf-8')
    m = PLAYERS_RE.search(src)
    if not m:
        raise SystemExit('could not find "const PLAYERS = [...];" in js/data.js')
    players = json.loads(m.group(1))
    merged = provisional.merge(players)

    real = [p for p in merged if not p.get('provisional')]
    prov = [p for p in merged if p.get('provisional')]
    print(f'{len(real)} real players + {len(prov)} provisional = {len(merged)}')
    for p in prov:
        print(f"  {p['id']}  {p['pos']:2}  {p['name']} ({p['club']}) £{p['price']}m")
    if not entries:
        print('data/provisional.json is empty or absent — nothing to merge')

    if check_only:
        return

    DATA_JS.write_text(
        src[:m.start(1)] + json.dumps(merged, ensure_ascii=False) + src[m.end(1):],
        encoding='utf-8')

    blob = json.loads(DATA_JSON.read_text(encoding='utf-8'))
    blob['players'] = merged
    DATA_JSON.write_text(json.dumps(blob, ensure_ascii=False), encoding='utf-8')

    print(f'wrote {DATA_JS.relative_to(ROOT)} and {DATA_JSON.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
