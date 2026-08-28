#!/usr/bin/env python3
"""Print the league's operational state. Read-only, public node, no credentials.

Marc, 28 Aug 2026: "surely you can do this without me telling you."

He was right twice over. The dev sandbox cannot reach Firebase — its egress
proxy blocks the database host, verified, not assumed — so twice this week the
state of the live league was something I INFERRED from a symptom and then
asserted as fact. Once about the Trough being shut, which it was not. Guessing
at server state and reporting the guess as a finding is worse than saying
nothing.

The runner can reach it. So this reads the handful of operational fields that
answer "did the run happen, and what is the league waiting on", and prints
them where a session with no network can read them back.

Deliberately narrow:
  - the PUBLIC node only, unauthenticated, exactly what a signed-out visitor
    of the site already receives. No service account, no secrets, no signing
    in as anybody.
  - scalar operational fields only — timestamps, flags, counts. No rosters, no
    lineups, no names, nothing from private/. The job log on a public repo is
    a public place and the league's business does not belong in it.
  - it reads. There is no code path here that writes.

Usage: python3 scripts/league_status.py
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

DB = os.environ.get('LEAGUE_DB',
                    'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app')
LEAGUE = os.environ.get('LEAGUE_ID', 'the-league-2627')
BASE = f'{DB}/v2/leagues/{LEAGUE}/public'


def get(path):
    url = f'{BASE}/{path}.json'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'the-league/1.0 (status probe)'})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode('utf-8')), None
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code} {e.reason}'
    except Exception as e:
        return None, str(e)[:120]


def ago(stamp):
    if not stamp:
        return 'never'
    try:
        t = datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
    except Exception:
        return f'{stamp} (unparsed)'
    mins = (datetime.now(timezone.utc) - t).total_seconds() / 60
    return f'{t:%a %d %b %H:%M}Z  ({mins/60:.1f}h ago)' if mins > 90 else f'{t:%a %d %b %H:%M}Z  ({mins:.0f}m ago)'


def main():
    print(f'league: {LEAGUE}   read at {datetime.now(timezone.utc):%a %d %b %H:%M}Z')
    print('=' * 62)

    wm, err = get('waiverMeta')
    if err:
        print(f'waiverMeta: UNREADABLE — {err}')
        print('  (if this is a permission error the public node is not world-readable,')
        print('   and this probe cannot help — say so rather than inferring state.)')
    else:
        wm = wm or {}
        print(f'last waiver run : {ago(wm.get("lastRun"))}')
        print(f'control         : {wm.get("control") or "auto"}')
        print(f'skip flag       : {wm.get("skip") or "none"}')

    st, err = get('phase')
    print(f'phase           : {st if not err else "unreadable — " + err}')

    # the run ledger says what the scheduler actually did, which is the bit
    # that distinguishes "ran", "skipped: not due" and "deferred"
    runs, err = get('waiverRuns')
    if err:
        print(f'run ledger      : unreadable — {err}')
    elif not runs:
        print('run ledger      : empty')
    else:
        rows = sorted(runs.items(), key=lambda kv: str((kv[1] or {}).get('finishedAt')
                                                       or (kv[1] or {}).get('deferredAt') or ''), reverse=True)
        print(f'run ledger      : {len(runs)} entries, most recent first')
        for rid, r in rows[:6]:
            r = r or {}
            when = r.get('finishedAt') or r.get('deferredAt') or r.get('startedAt')
            when = datetime.fromtimestamp(when / 1000, timezone.utc).strftime('%a %d %b %H:%M') if isinstance(when, (int, float)) else '?'
            print(f'   {rid:<26} {str(r.get("status")):<10} {when}  {str(r.get("result") or r.get("reason") or "")[:52]}')

    # counts only — never contents
    for node, label in (('claims', 'pending claims'), ('trades', 'trades')):
        v, err = get(node)
        if err:
            print(f'{label:<16}: unreadable — {err}')
        else:
            print(f'{label:<16}: {len(v) if isinstance(v, dict) else 0} key(s)')

    print('=' * 62)
    print('read-only: this script has no write path.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
