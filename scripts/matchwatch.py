#!/usr/bin/env python3
"""Keep the feed fresh through a match day without anyone pressing a button.

Marc, 28 Aug 2026: "why, do i have to do this. you know the timings, surely we
can automate it."

Fair. The timings are in data/fixtures.json and always were.

THE PROBLEM. fpl.yml asks GitHub's scheduler for a run every five minutes —
288 a day. Over 28 Aug it got five, with gaps of six hours, six hours and
three. live.yml, on the same cron, got about three and none at all through the
evening kickoff. Even the hourly jobs are throttled: the league backup ran
twice in the day, leaving a thirteen-hour hole. It has been getting worse since
26 Aug. Cron on this repo is not a schedule, it is a suggestion.

Everything downstream broke from that one fault: waivers refused to run on a
368-minute-old feed, the scoreboard sat hours behind during matches, and the
Vidiprinter had no stats to work from at all.

THE TRICK. GitHub throttles the SCHEDULER. It does not throttle a job that is
already running, and this repo is public, so Actions minutes are free and
unlimited. So stop asking for 288 short runs and ask for a few long ones that
watch the football themselves: each fire sits through the match window fetching
every couple of minutes, and one fire covers hours instead of seconds. Three
chained jobs of five hours each — `needs:` chaining always works, unlike cron —
means a single fire on Saturday morning covers the whole card.

Off-matchday it costs nothing: with no window near, this exits in seconds.

Not a replacement for moving the fetch to a Cloud Function, which is the real
fix and is Ben's to make. This is what can be built without a deploy.

Usage:
  python3 scripts/matchwatch.py --plan     what it would do now, as JSON
  python3 scripts/matchwatch.py            watch, fetch, commit, until budget
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# team sheets land about an hour before kickoff and are the most valuable thing
# we fetch all week, so the window opens before the match does
PRE_MIN = int(os.environ.get('MW_PRE_MIN', 75))
# and stays open past the whistle: bonus points and the provisional flags take
# a while to settle, and the round is not really over until they have
POST_MIN = int(os.environ.get('MW_POST_MIN', 150))
POLL_SEC = int(os.environ.get('MW_POLL_SEC', 150))
# how long to hang around waiting for a window that has not opened yet. Longer
# than this and it is cheaper to exit and let the next fire pick it up.
IDLE_WAIT_MIN = int(os.environ.get('MW_IDLE_WAIT_MIN', 45))
BUDGET_MIN = int(os.environ.get('MW_BUDGET_MIN', 290))  # under the 6h job cap


def parse_ts(s):
    try:
        return datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None


def load_fixtures(path=None):
    p = path or os.path.join(ROOT, 'data', 'fixtures.json')
    with open(p, encoding='utf-8') as fh:
        return json.load(fh)


def windows(fixtures, now=None):
    """Merged [open, close] spans around every fixture still worth watching.

    A fixture already finished is not worth a runner. Two kickoffs an hour
    apart are one window, not two — the merge is what stops a Saturday card
    becoming five separate sittings with gaps we would sleep through.
    """
    now = now or datetime.now(timezone.utc)
    spans = []
    for f in fixtures or []:
        if not isinstance(f, dict) or f.get('finished'):
            continue
        k = parse_ts(f.get('date'))
        if not k:
            continue
        close = k + timedelta(minutes=POST_MIN)
        if close < now:
            continue                      # over and settled long ago
        spans.append((k - timedelta(minutes=PRE_MIN), close))
    spans.sort()
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


def plan(fixtures, now=None):
    """What to do right now: watch, wait then watch, or go home."""
    now = now or datetime.now(timezone.utc)
    wins = windows(fixtures, now)
    if not wins:
        return {'action': 'idle', 'reason': 'no unfinished fixtures ahead'}
    for open_at, close_at in wins:
        if open_at <= now <= close_at:
            return {'action': 'watch', 'until': close_at.isoformat(),
                    'reason': f'window open until {close_at:%a %d %b %H:%M}Z'}
        if now < open_at:
            wait = (open_at - now).total_seconds() / 60
            if wait <= IDLE_WAIT_MIN:
                return {'action': 'wait', 'start': open_at.isoformat(),
                        'until': close_at.isoformat(),
                        'reason': f'window opens in {wait:.0f} min'}
            return {'action': 'idle', 'start': open_at.isoformat(),
                    'reason': f'next window in {wait:.0f} min — too far to hold a runner'}
    return {'action': 'idle', 'reason': 'every window is behind us'}


def sh(*args, **kw):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, **kw)


def fetch_and_commit():
    """One pass. Returns a short status string for the log."""
    r = sh(sys.executable, os.path.join('scripts', 'fetch_fpl.py'))
    if r.returncode != 0:
        return f'fetch FAILED: {(r.stderr or r.stdout).strip().splitlines()[-1][:120] if (r.stderr or r.stdout).strip() else "no output"}'
    files = ['js/data.js', 'data/data.json', 'data/stats.json',
             'data/fixtures.json', 'data/teamnews.json']
    sh('git', 'add', *files)
    if sh('git', 'diff', '--cached', '--quiet').returncode == 0:
        return 'no change'
    sh('git', 'commit', '-m', 'data: FPL refresh')
    # fpl.yml, the lineups fetch and a human can all be pushing to main; land
    # on top of whatever arrived rather than failing the pass
    for attempt in range(4):
        if sh('git', 'push').returncode == 0:
            return 'pushed'
        sh('git', 'pull', '--rebase', 'origin', 'main')
        time.sleep(2 ** attempt)
    return 'push FAILED after 4 tries'


def main():
    now = datetime.now(timezone.utc)
    p = plan(load_fixtures(), now)
    if '--plan' in sys.argv:
        print(json.dumps(p, indent=1))
        return 0

    print(f'{now:%a %d %b %H:%M}Z — {p["action"]}: {p["reason"]}', flush=True)
    if p['action'] == 'idle':
        return 0

    if p['action'] == 'wait':
        start = parse_ts(p['start'])
        secs = max(0, (start - datetime.now(timezone.utc)).total_seconds())
        print(f'sleeping {secs / 60:.0f} min until the window opens', flush=True)
        time.sleep(secs)

    close_at = parse_ts(p['until'])
    budget_end = now + timedelta(minutes=BUDGET_MIN)
    passes = 0
    while True:
        t = datetime.now(timezone.utc)
        if t > close_at:
            print(f'window closed — {passes} passes', flush=True)
            return 0
        if t > budget_end:
            # the next job in the chain picks it up; that is what `needs:` is for
            print(f'budget spent after {passes} passes, window open until '
                  f'{close_at:%H:%M}Z — handing over', flush=True)
            return 0
        passes += 1
        print(f'  {t:%H:%M}Z pass {passes}: {fetch_and_commit()}', flush=True)
        time.sleep(POLL_SEC)


if __name__ == '__main__':
    sys.exit(main())
