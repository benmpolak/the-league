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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

    # The live overlay, which is what the Vidiprinter actually diffs during a
    # match. Marc, 28 Aug 2026, 40 minutes into Palace v City: "why is the
    # vidiprinter not working" — and the honest answer from a sandbox that
    # cannot reach Firebase was "one of the two lanes is provably dead and I
    # cannot see the other". This makes the other one readable.
    #
    # liveTick writes this every minute off the FPL API, independently of the
    # Pages feed, so a dead data refresh should NOT stop it. If the overlay is
    # fresh and carries players, the fast lane is doing its job and the tape's
    # silence is a client question; if it is stale or absent during a live
    # window, the fast lane is the fault. Scalars only — a stamp, a gameweek
    # and a count. No names, no stats, no rosters.
    lv, err = get('liveStats')
    if err:
        print(f'live overlay    : unreadable — {err}')
    elif not lv:
        print('live overlay    : absent (no live match, or the fast lane is not writing)')
    else:
        t = lv.get('t')
        players = len(lv.get('playerStats') or {})
        fx = lv.get('fx') or []
        started = sum(1 for f in fx if isinstance(f, dict) and f.get('started'))
        when = 'unknown'
        if isinstance(t, (int, float)):
            age = (datetime.now(timezone.utc).timestamp() * 1000 - t) / 60000
            when = f'{datetime.fromtimestamp(t / 1000, timezone.utc):%a %d %b %H:%M}Z ({age:.0f}m ago)'
        print(f'live overlay    : GW{lv.get("n")}  written {when}')
        print(f'   players with stats : {players}')
        print(f'   fixtures started   : {started} of {len(fx)}')

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

    # ---- the holding pen, audited against the live feed ----
    # Marc, 30 Aug 2026: "we need to have a mechanism to ensure that the holding
    # pen is correct by the time thursday comes around."
    #
    # The pen is derived, not stored: it is every man the draft-night snapshot
    # does not have AT HIS CURRENT CLUB, minus anyone who owns him. So it moves
    # on its own as the feed moves, which is right, and also means nobody can
    # see it drift. This recomputes it from the live snapshot and the committed
    # feed and prints it, so the Thursday list is checkable at any hour instead
    # of being taken on trust.
    #
    # Player names are public football data and the pen is on every manager's
    # Trough page, so naming them here leaks nothing. Who OWNS a man is roster
    # data and stays out, per the rest of this script.
    pool, err = get('draftPool/ids')
    if err:
        print(f'holding pen     : unreadable — {err}')
    elif not pool:
        print('holding pen     : no draft-night snapshot on the league')
    else:
        try:
            feed = json.load(open(os.path.join(ROOT, 'data', 'data.json'), encoding='utf-8'))
            players = feed['players'] if isinstance(feed, dict) and 'players' in feed else feed
            if isinstance(players, dict):
                players = list(players.values())
        except Exception as e:
            players = None
            print(f'holding pen     : feed unreadable — {str(e)[:80]}')
        if players:
            at = pool if isinstance(pool, dict) else {i: v for i, v in enumerate(pool)}
            def club_at_draft(pid):
                return at.get(pid, at.get(str(pid)))
            owned = set()
            picks, _ = get('draft/picks')
            for k in (picks.values() if isinstance(picks, dict) else (picks or [])):
                if isinstance(k, dict) and k.get('playerId') is not None:
                    owned.add(int(k['playerId']))
            trs, _ = get('transfers')
            for t in (trs.values() if isinstance(trs, dict) else (trs or [])):
                if not isinstance(t, dict):
                    continue
                if t.get('inId') is not None:
                    owned.add(int(t['inId']))
                owned.discard(int(t['outId'])) if t.get('outId') is not None else None
            pen, movers_owned = [], []
            for p in players:
                was = club_at_draft(p['id'])
                if was == p.get('club'):
                    continue                       # the snapshot has him where he is
                (pen if p['id'] not in owned else movers_owned).append((p, was))
            print(f'holding pen     : {len(pen)} man/men, recomputed from the live snapshot')
            for p, was in sorted(pen, key=lambda x: (-(x[0].get('pts') or 0), x[0]['name'])):
                why = 'new to the game' if was is None else f'moved from {was}'
                flag = '' if p.get('status') == 'a' else f"  [{p.get('status')}]"
                print(f"   {p['name'][:20]:<21}{p.get('club',''):<5}{p.get('pos',''):<4}"
                      f"{p.get('mp', 0):>5} min  {why}{flag}")
            if movers_owned:
                print(f'   ...plus {len(movers_owned)} owned mover(s), correctly NOT penned: '
                      + ', '.join(sorted(p['name'] for p, _ in movers_owned)))

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
