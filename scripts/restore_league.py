#!/usr/bin/env python3
"""Restore the league state to Firebase from a snapshot.

    python3 scripts/restore_league.py                    # latest snapshot
    python3 scripts/restore_league.py path/to/backup.json

Asks for confirmation, then PUTs the snapshot over the live league. Every
device picks the restored state up on its next sync. Past snapshots live in
git history: git log --oneline -- data/backups/league.json
"""
import json
import pathlib
import sys
import urllib.request

DB = 'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app'
LEAGUE = 'the-league-2627'
ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT = ROOT / 'data' / 'backups' / 'league.json'


def main():
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    if not src.exists():
        raise SystemExit(f'no snapshot at {src}')
    data = json.loads(src.read_text())
    if data is None:
        raise SystemExit('snapshot is null — refusing to wipe the league with it')
    keys = ', '.join(sorted(data)) if isinstance(data, dict) else type(data).__name__
    print(f'About to OVERWRITE the live league "{LEAGUE}" with {src}')
    print(f'Snapshot contains: {keys}')
    if input('Type RESTORE to proceed: ').strip() != 'RESTORE':
        raise SystemExit('aborted')
    body = json.dumps(data).encode()
    req = urllib.request.Request(f'{DB}/leagues/{LEAGUE}.json', data=body, method='PUT',
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        r.read()
    print('restored. Tell the lads to refresh.')


if __name__ == '__main__':
    main()
