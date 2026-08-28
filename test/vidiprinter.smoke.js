/* The Vidiprinter is a record of the round, not a diary of your device.
 *
 * Marc, 28 Aug 2026, mid Palace v City: "its definitely the first but i think
 * this shows a misunderstanding of what the vidiprinter is. its a record of
 * everything live, shouldnt be linked to anyones device."
 *
 * The old tape was built by diffing each sync against the last and appending to
 * localStorage, so it held what YOUR phone was awake to see. The properties
 * pinned here are the ones that failed that night:
 *
 *   - the same stats produce the same tape, wherever they are read
 *   - a device arriving late sees everything that has already happened
 *   - nothing survives in localStorage, so a wipe changes nothing
 *   - an empty baseline no longer swallows the match (the exact GW2 failure:
 *     the Pages feed held zero stats, so the first overlay became a silent
 *     baseline and ate the lot)
 *   - the klaxon SOUND still needs a before-and-after, because a noise is a
 *     live moment; it must not blast on page load for historic goals
 *
 * Usage: python3 -m http.server 8125 (repo root) then node test/vidiprinter.smoke.js
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {
    const log = [];
    const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
    const blank = () => ({ min: 90, st: 1, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 });

    /* a round in progress: one match kicked off an hour ago */
    function matchday() {
      state = buildDemoState();
      state.phase = 'season';
      const g = GAMEWEEKS[0];
      g.finished = false;
      g.from = new Date(Date.now() - 36e5).toISOString();
      g.to = new Date(Date.now() + 6 * 864e5).toISOString();
      state.fixtures = [];
      for (let k = 0; k + 1 < TEAMS.length; k += 2)
        state.fixtures.push({ id: 100 + k, gw: g.n, home: TEAMS[k].name, away: TEAMS[k + 1].name,
          date: new Date(Date.now() - 36e5).toISOString(), started: true, minutes: 60,
          finished: false, hs: 1, as: 0 });
      state.matchStats['gw' + g.n] = { gw: 0, final: false, playerStats: {} };
      return state.matchStats['gw' + g.n];
    }

    // a scorer who is actually in somebody's XI, so the credit line has a team
    const pickStarter = () => {
      for (const m of state.managers) {
        const xi = effectiveXI(m.id, 0).xi;
        for (const pid of xi) if (PLAYER_BY_ID[pid]) return { p: PLAYER_BY_ID[pid], mid: m.id };
      }
      return null;
    };

    /* ----- the whole point: nothing is stored, so nothing is personal ----- */
    (() => {
      const ev = matchday();
      const { p, mid } = pickStarter();
      ev.playerStats[p.id] = { ...blank(), g: 2, a: 1 };

      const a = vidiLines(0);
      t('a man on two goals prints, with no diff and no history',
        a.length >= 1 && /2 GOALS/.test(a[0].txt), a[0] ? a[0].txt.slice(0, 70) : 'nothing');
      t('and the line credits the manager who started him',
        a[0].txt.includes(teamName(mid)), a[0].txt.slice(0, 90));

      // "shouldn't be linked to anyone's device": wipe every scrap of storage
      // and the tape must be byte-identical, because it was never in there
      const before = JSON.stringify(vidiLines(0));
      try { localStorage.clear(); } catch { /* nothing to clear is the point */ }
      const after = JSON.stringify(vidiLines(0));
      t('clearing localStorage changes the tape not at all',
        before === after && after.length > 2, `${before.length} vs ${after.length} chars`);

      const keys = Object.keys(localStorage).filter(k => /vidi/i.test(k));
      t('and the Vidiprinter keeps nothing in localStorage at all',
        keys.length === 0, keys.join(', '));
    })();

    /* ----- a device that arrives late still sees the whole match -----
       This is Marc's Palace v City exactly: the Pages feed held ZERO stats, so
       the old tape took the first overlay as a silent baseline and printed
       nothing for the forty minutes already played. */
    (() => {
      const ev = matchday();
      const { p } = pickStarter();
      // a phone opening now, with a cold, empty feed and a match already an
      // hour old: the stats land in one go, having missed nothing and seen
      // nothing happen
      ev.playerStats = {};
      const cold = vidiLines(0);
      t('with no stats at all the tape has nothing to say', cold.length === 0, String(cold.length));

      ev.playerStats[p.id] = { ...blank(), g: 1 };
      const late = vidiLines(0);
      t('a goal scored before this device ever loaded still prints',
        late.some(l => l.txt.includes(p.name) && /GOAL/.test(l.txt)),
        late.map(l => l.txt.slice(0, 40)).join(' | ') || 'nothing');
      t('and the card renders it rather than "the tape is quiet"',
        vidiCard().includes(p.name) && !vidiCard().includes('tape is quiet'),
        'the card was empty');
    })();

    /* ----- two devices, one truth ----- */
    (() => {
      const ev = matchday();
      const { p } = pickStarter();
      ev.playerStats[p.id] = { ...blank(), g: 1, yc: 1 };
      const first = vidiLines(0).map(l => l.txt);
      // a second device that watched the goal and the booking arrive separately
      // used to end up with two lines where this one has one; now both derive
      const second = vidiLines(0).map(l => l.txt);
      t('the same stats give the same tape, every time it is computed',
        JSON.stringify(first) === JSON.stringify(second), `${first.length} vs ${second.length} lines`);
      t('one player with two incidents is ONE line, not one per sync',
        first.filter(x => x.includes(p.name)).length === 1,
        first.filter(x => x.includes(p.name)).join(' | '));
      t('and that line carries both incidents',
        /GOAL/.test(first[0]) && /booked/.test(first[0]), first[0]);
    })();

    /* ----- no repeats, however many times it is rendered -----
       Ben, 25 Aug: Castagne printed "booked" three times. The old dedupe was a
       key set over a stored feed; derivation makes the bug unreachable. */
    (() => {
      const ev = matchday();
      const { p } = pickStarter();
      ev.playerStats[p.id] = { ...blank(), yc: 1 };
      for (let i = 0; i < 5; i++) vidiCard();
      const lines = vidiLines(0).filter(l => l.txt.includes(p.name));
      t('rendering five times prints one booking, not five',
        lines.length === 1, String(lines.length));
      // a genuine second yellow is a different total and still reads correctly
      ev.playerStats[p.id] = { ...blank(), yc: 2, rc: 1 };
      const now = vidiLines(0).find(l => l.txt.includes(p.name));
      t('a second card and a red both show on the one line',
        now && /RED CARD/.test(now.txt) && /booked/.test(now.txt), now ? now.txt.slice(0, 80) : 'gone');
    })();

    /* ----- the fixture replaces the device clock ----- */
    (() => {
      const ev = matchday();
      const { p } = pickStarter();
      ev.playerStats[p.id] = { ...blank(), g: 1 };
      const l = vidiLines(0).find(x => x.txt.includes(p.name));
      t('each line is stamped with its match, not a local time',
        l && / v /.test(l.at) && !/\d\d:\d\d/.test(l.at), l ? l.at : 'no stamp');
      t('a goal carries the real score in that game',
        /1\u20130/.test(l.txt), l.txt.slice(0, 90));
      const html = vidiCard();
      t('and the rendered card shows the fixture stamp',
        html.includes(l.at), 'fixture stamp missing from the card');
    })();

    /* ----- the klaxon: printed always, SOUNDED only on the moment ----- */
    (() => {
      const ev = matchday();
      const lob = Object.values(PLAYER_BY_ID).find(p =>
        p.pos === 'FW' && LOBUS_LIST.some(l => normName(p.name).includes(l)));
      if (!lob) { t('a certified lobus exists to test with', false, 'none found'); return; }
      let sounds = 0;
      const realPlay = window.playSound;
      window.playSound = k => { if (k === 'klaxon') sounds++; };

      // he scored before this device loaded: the LINE must be there...
      ev.playerStats[lob.id] = { ...blank(), g: 1 };
      const lines = vidiLines(0);
      t('a lobus who scored before you opened the app is on the tape',
        lines.some(l => /LOBUS KLAXON/.test(l.txt)),
        lines.map(l => l.txt.slice(0, 30)).join(' | ') || 'nothing');
      // ...and rendering it must NOT set the klaxon off
      vidiCard(); vidiCard();
      t('but rendering historic goals never sounds the klaxon',
        sounds === 0, `${sounds} blasts on render`);

      // a goal arriving live does sound it, once
      vidiKlaxon(0, { [lob.id]: { ...blank(), g: 1 } }, { [lob.id]: { ...blank(), g: 2 } });
      t('a goal arriving live sounds it', sounds === 1, String(sounds));
      vidiKlaxon(0, { [lob.id]: { ...blank(), g: 1 } }, { [lob.id]: { ...blank(), g: 2 } });
      t('the same goal re-emitted by a flickering feed does not sound it twice',
        sounds === 1, String(sounds));

      // an assist is not a goal, and a civilian is not a lobus
      vidiKlaxon(0, { [lob.id]: { ...blank(), g: 2 } }, { [lob.id]: { ...blank(), g: 2, a: 1 } });
      t('an assist does not sound the klaxon', sounds === 1, String(sounds));
      const civ = Object.values(PLAYER_BY_ID).find(p =>
        p.pos === 'FW' && !LOBUS_LIST.some(l => normName(p.name).includes(l)));
      vidiKlaxon(0, { [civ.id]: { ...blank(), g: 0 } }, { [civ.id]: { ...blank(), g: 1 } });
      t('and a civilian centre-forward never does', sounds === 1, String(sounds));

      // a cold start has no before-and-after, so it must stay silent
      vidiKlaxon(0, {}, { [lob.id]: { ...blank(), g: 3 } });
      t('a cold start with no baseline stays silent', sounds === 1, String(sounds));
      window.playSound = realPlay;
    })();

    /* ----- what must NOT change: the tape never touches a score ----- */
    (() => {
      const ev = matchday();
      const { p, mid } = pickStarter();
      const before = gwManagerPoints(mid, 0);
      ev.playerStats[p.id] = { ...blank(), g: 3 };
      const scored = gwManagerPoints(mid, 0);
      vidiLines(0); vidiCard(); vidiCard();
      t('deriving the tape leaves the settled score exactly where it was',
        gwManagerPoints(mid, 0) === scored, `${gwManagerPoints(mid, 0)} vs ${scored}`);
      t('(and the goals did move it, so the check means something)',
        scored !== before, `${before} → ${scored}`);
    })();

    return log;
  });

  for (const line of log) { console.log(line); if (line.startsWith('PASS')) pass++; else fail++; }
  console.log(`${pageErrors.length === 0 ? 'PASS' : 'FAIL'}  no page errors${pageErrors.length ? ' — ' + pageErrors.join(' | ') : ''}`);
  if (pageErrors.length === 0) pass++; else fail++;

  await browser.close();
  console.log(`\n[vidiprinter] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
