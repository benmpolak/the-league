#!/usr/bin/env python3
"""Snapshot the live league state from Firebase into the repo.

Runs hourly via .github/workflows/backup.yml. Every change is a git commit,
so the full season history lives in `git log -- data/backups/league.json`.

Wipe protection: if the database suddenly returns null/tiny content while the
last snapshot was substantial, the snapshot is NOT overwritten — the incident
is recorded in data/backups/ALERT.txt instead. Restoring is one command:

    python3 scripts/restore_league.py            # restore latest snapshot
    git show <commit>:data/backups/league.json > /tmp/old.json
    python3 scripts/restore_league.py /tmp/old.json   # restore a past one
"""
import json
import pathlib
import time
import urllib.request

DB = 'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app'
LEAGUE = 'the-league-2627'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'backups' / 'league.json'
ALERT = ROOT / 'data' / 'backups' / 'ALERT.txt'


def main():
    with urllib.request.urlopen(f'{DB}/leagues/{LEAGUE}.json', timeout=30) as r:
        raw = r.read()
    new = raw.decode('utf-8')
    old_size = OUT.stat().st_size if OUT.exists() else 0
    new_size = len(raw)
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

    # a live league shrinking to (nearly) nothing is a wipe, not an update
    if old_size > 2000 and (new.strip() == 'null' or new_size < old_size * 0.1):
        ALERT.write_text(
            f'{stamp}: refused to overwrite snapshot — live DB returned '
            f'{new_size} bytes vs {old_size} in the last snapshot.\n'
            f'If this wipe was intentional (league reset), delete league.json '
            f'and this file, then re-run. If not: scripts/restore_league.py\n')
        print(f'ALERT: DB shrank {old_size} -> {new_size} bytes; snapshot preserved')
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # pretty-print stably so git diffs are meaningful and no-change runs are quiet
    try:
        data = json.loads(new)
    except json.JSONDecodeError:
        print('ERROR: DB response was not JSON; nothing written')
        raise SystemExit(1)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True))
    if ALERT.exists():
        ALERT.unlink()
    print(f'ok: snapshot {new_size} bytes at {stamp}')


if __name__ == '__main__':
    main()
