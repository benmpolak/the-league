/* Prediction accuracy, rebuilt from the deadline (Marc, 15 Sept 2026: "I want
 * it to be from the % as close to what it said at the deadline as possible").
 *
 * Nothing about a projection is stored, so the card winds the season back with
 * asOfGw and asks the real matchOdds() again. That is only worth anything if
 * the wind-back is airtight, so most of this file is spent attacking it:
 *   - blind: no points, no appearances, no settled status, no finished
 *     fixtures for the round being projected or any round after it
 *   - not TOO blind: every earlier round is still fully visible, because that
 *     history is exactly what the projection is supposed to be using
 *   - inert: with asOfGw unset, every one of those readers answers precisely as
 *     it did before this existed. This is the one that matters most — the
 *     machinery sits inside functions the whole site depends on
 *   - restored: a throw inside withAsOf must not leave the season wound back
 *   - honest: the marking cannot be beaten by a card that peeks. The same
 *     projection run with eyes open scores far better, and the gap is the proof
 * Run against any side-port server with TEST_BASE_URL=http://127.0.0.1:8135.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {
    const log = [];
    const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

    /* ----- the frozen treatment room -----
     * Checked on the REAL feed before the demo season replaces it, because
     * this is the one part of the wind-back that depends on shipped data.
     * Today's injury list says nothing about who was fit in August: without
     * this the reconstruction rules out men who played 90 minutes. */
    const realNews = state.teamNews;
    (() => {
      t('the frozen team news is loaded on boot', !!realNews?.rounds,
        realNews ? Object.keys(realNews.rounds || {}).join(',') : 'absent');
      if (!realNews?.rounds) return;
      const archived = Object.keys(realNews.rounds).map(Number).sort((a, b) => a - b);
      const T = GAMEWEEKS.findIndex(g => g.n === archived[0]);
      t('and it knows the rounds it has, and admits the ones it has not',
        newsKnownAt(T) && !newsKnownAt(GAMEWEEKS.findIndex(g => g.n === archived[archived.length - 1] + 1)));
      // an unflagged man was unflagged, not unknown
      const clean = PLAYERS.find(p => !realNews.rounds[String(archived[0])].flagged[String(p.id)]);
      t('a man the desk said nothing about reads as available that week',
        !!clean && newsAt(clean.id, T)?.s === 'a' && newsAt(clean.id, T)?.c === 100);
      // The point of the exercise: today's flags must not rule out a man who
      // was fit at that deadline. Read on men who did NOT play that week —
      // for anyone who did, startChance answers 1 off the teamsheet before it
      // ever looks at a flag, which would hide the very thing being tested.
      const wasFit = PLAYERS.filter(p => {
        const n = newsAt(p.id, T);
        return n && n.s === 'a' && !appearedInGw(p.id, T)
          && p.status && p.status !== 'a' && p.status !== 'd';
      });
      t('men fit at that deadline but flagged today are not ruled out by it',
        wasFit.length > 0 && wasFit.every(p => startChance(p, T) === 0)
          && wasFit.some(p => withAsOf(T, () => startChance(p, T)) > 0),
        `${wasFit.length} such players`);
      // and the reverse: a man ruled out THEN stays ruled out then
      const wasOut = PLAYERS.filter(p => {
        const n = newsAt(p.id, T);
        return n && n.s !== 'a' && n.s !== 'd';
      });
      t('and men ruled out at that deadline stay ruled out for that round',
        wasOut.length > 0 && wasOut.every(p => withAsOf(T, () => startChance(p, T)) === 0),
        `${wasOut.length} such players`);
      // Scout's XIs are kept for the open round only, so a rebuilt round must
      // not read this week's team sheet into a fortnight-old deadline
      t('the predicted line-ups go quiet while the season is wound back',
        PLAYERS.every(p => withAsOf(T, () => scoutXI(p, T)) === null));
      // and the gag is the wind-back and nothing wider: wound back to a LATER
      // round, this one is not hidden, and Scout speaks exactly as he always
      // did. (Whether he says anything at all is the freshness rule's business
      // — those XIs are only good for the round they were written for.)
      t('and that gag is the wind-back alone, not a wider silencing',
        PLAYERS.every(p => withAsOf(T + 2, () => scoutXI(p, T)) === scoutXI(p, T)));
      // inert when not asked, for startChance specifically
      const before = PLAYERS.slice(0, 300).map(p => startChance(p, T));
      withAsOf(T, () => PLAYERS.slice(0, 300).map(p => startChance(p, T)));
      t('and today\'s projection is untouched by any of it',
        JSON.stringify(before) === JSON.stringify(PLAYERS.slice(0, 300).map(p => startChance(p, T))));
    })();

    /* ----- a season with enough behind it to project from ----- */
    state = buildDemoState();
    state.teamNews = realNews;   // the demo replaces state wholesale
    const WEEKS = 5;
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < WEEKS; i++) {
      const gwN = GAMEWEEKS[i].n, ps = {};
      for (const q of PLAYERS) {
        if (rnd() < 0.35) continue;
        const gp = { FW: 0.34, MF: 0.18, DF: 0.06, GK: 0.01 }[q.pos];
        ps[q.id] = { min: 90, st: 1, g: rnd() < gp ? 1 : 0, a: rnd() < 0.12 ? 1 : 0,
          cs: rnd() < 0.3 ? 1 : 0, sv: q.pos === 'GK' ? Math.floor(rnd() * 6) : 0 };
      }
      state.matchStats['gw' + gwN] = { gw: i, label: GAMEWEEKS[i].label, final: true, playerStats: ps };
      GAMEWEEKS[i].finished = true;
      // the calendar has to agree the round was played, or nothing below is
      // testing a wind-back at all
      for (const f of state.fixtures.filter(f => f.gw === gwN)) { f.finished = true; f.fp = true; f.started = true; f.minutes = 90; }
    }
    const realStatus = window.gwStatus;
    window.gwStatus = i => (i < WEEKS ? 'final' : realStatus(i));

    const TARGET = 3;              // a round with three settled weeks behind it
    const mid = state.managers[0].id;
    const someone = lineupFor(mid, TARGET)[0];
    const club = PLAYER_BY_ID[someone].team;
    const gwN = GAMEWEEKS[TARGET].n;

    /* ----- inert until asked. The single most important property here:
       asOfGw lives inside gwEvent, playerPoints and teamFixturesInGw, which
       the entire site reads. Unset, every one of them must answer exactly as
       it always did ----- */
    (() => {
      const before = {
        pts: gwManagerPoints(mid, TARGET),
        player: gwPlayerPoints(someone, TARGET),
        season: playerPoints(someone).pts,
        app: appearedInGw(someone, TARGET),
        fx: teamFixturesInGw(club, gwN).map(f => `${f.home}-${f.away}-${!!f.finished}`).join('|'),
        odds: JSON.stringify(matchOdds(...pairingsFor(TARGET)[0], TARGET)),
      };
      withAsOf(TARGET, () => matchOdds(...pairingsFor(TARGET)[0], TARGET));
      const after = {
        pts: gwManagerPoints(mid, TARGET),
        player: gwPlayerPoints(someone, TARGET),
        season: playerPoints(someone).pts,
        app: appearedInGw(someone, TARGET),
        fx: teamFixturesInGw(club, gwN).map(f => `${f.home}-${f.away}-${!!f.finished}`).join('|'),
        odds: JSON.stringify(matchOdds(...pairingsFor(TARGET)[0], TARGET)),
      };
      t('the season reads identically before and after a wind-back',
        JSON.stringify(before) === JSON.stringify(after),
        Object.keys(before).filter(k => before[k] !== after[k]).join(', ') || 'all match');
      t('and asOfGw is back to nothing', asOfGw === null, String(asOfGw));
    })();

    /* ----- blind to the round it is projecting, and everything after ----- */
    withAsOf(TARGET, () => {
      t('wound back: nobody has scored in the target round',
        gwManagerPoints(mid, TARGET) === 0 && gwPlayerPoints(someone, TARGET) === 0);
      t('wound back: nobody has appeared in it',
        lineupFor(mid, TARGET).every(id => !appearedInGw(id, TARGET)));
      t('wound back: it is not a settled round',
        realStatus(TARGET) !== 'final', realStatus(TARGET));
      t('wound back: its fixtures are still to be played',
        teamFixturesInGw(club, gwN).every(f => !f.finished && !f.fp && !f.started));
      t('wound back: the whole afternoon is still to come',
        playerFixtureState(PLAYER_BY_ID[someone], gwN).frac === 1);
      t('wound back: later rounds are hidden too',
        gwManagerPoints(mid, TARGET + 1) === 0 && !appearedInGw(someone, TARGET + 1));
      t('wound back: the season total counts only what came before',
        playerPoints(someone).pts === [0, 1, 2].reduce((s, i) => s + gwPlayerPoints(someone, i), 0),
        `${playerPoints(someone).pts}`);
      // a settled round with nothing banked and everything to play for is
      // exactly a deadline: both sides must read as eleven men still to play
      const o = teamOutlook(mid, TARGET);
      t('wound back: eleven men still to play, nothing banked',
        o.toPlay === 11 && o.varsum > 0, `toPlay ${o.toPlay}`);
      // The submitted eleven, except where a man was ruled out before a ball
      // was kicked — the site forecast-subs those at a real deadline too, so
      // the reconstruction must as well. What it must NOT do is move anyone
      // for any other reason: no settled auto-subs, and nobody swapped because
      // of how the afternoon went.
      const live = liveXI(mid, TARGET);
      t('wound back: no settled auto-subs, the round has not been played',
        live.subs.length === 0, JSON.stringify(live.subs));
      t('wound back: the eleven moves only for men ruled out before kick-off',
        live.forecast.every(s => startChance(PLAYER_BY_ID[s.out], TARGET) === 0),
        live.forecast.map(s => PLAYER_BY_ID[s.out].name).join(', ') || 'none moved');
    });

    /* ----- but NOT blind to the history it is meant to be using ----- */
    (() => {
      const openEyes = [0, 1, 2].map(i => gwManagerPoints(mid, i));
      const woundBack = withAsOf(TARGET, () => [0, 1, 2].map(i => gwManagerPoints(mid, i)));
      t('every earlier round is still fully visible',
        JSON.stringify(openEyes) === JSON.stringify(woundBack), woundBack.join(','));
      t('and there was something there to see', openEyes.some(x => x > 0), openEyes.join(','));
    })();

    /* ----- a throw must not leave the season wound back ----- */
    (() => {
      let threw = false;
      try { withAsOf(TARGET, () => { throw new Error('boom'); }); } catch (e) { threw = true; }
      t('a throw inside a wind-back still restores the season',
        threw && asOfGw === null && gwManagerPoints(mid, TARGET) > 0,
        `asOfGw=${asOfGw}`);
    })();

    /* ----- the marking itself ----- */
    const rounds = [0, 1, 2, 3, 4].map(i => predictionsFor(i));
    (() => {
      t('every settled round is marked, six games each',
        rounds.every(r => r.length === 6), rounds.map(r => r.length).join(','));
      t('every game has a call, a result and a verdict',
        rounds.flat().every(r => ['a', 'b', 'd'].includes(r.call)
          && ['a', 'b', 'd'].includes(r.actual) && typeof r.right === 'boolean'));
      t('right means the call matched the result, and nothing else',
        rounds.flat().every(r => r.right === (r.call === r.actual)));
      t('the result recorded is the real one',
        rounds.flat().every((r, k) => {
          const i = Math.floor(k / 6);
          return r.pa === gwManagerPoints(r.a, i) && r.pb === gwManagerPoints(r.b, i);
        }));
      t('the call is the likeliest of the three outcomes',
        rounds.flat().every(r => {
          const best = Math.max(r.o.win, r.o.draw, r.o.loss);
          return Math.abs(r.conf - best) < 1e-9
            && ({ a: r.o.win, b: r.o.loss, d: r.o.draw })[r.call] === best;
        }));
      t('and it is a real projection, not a coin flip on the favourite',
        rounds.flat().every(r => r.conf > 0 && r.conf <= 1));
    })();

    /* ----- the marking is honest: a card that peeked would score far better ----- */
    (() => {
      const blindRight = rounds.flat().filter(r => r.right).length;
      let peekRight = 0;
      for (let i = 0; i < 5; i++) for (const [a, b] of pairingsFor(i)) {
        const o = matchOdds(a, b, i);                 // eyes open: the round is settled
        const call = o.win >= o.loss && o.win >= o.draw ? 'a' : o.loss >= o.draw ? 'b' : 'd';
        const pa = gwManagerPoints(a, i), pb = gwManagerPoints(b, i);
        if (call === (pa > pb ? 'a' : pb > pa ? 'b' : 'd')) peekRight++;
      }
      t('marking blind scores worse than marking with the result in hand',
        blindRight < peekRight, `blind ${blindRight}/30 vs peeking ${peekRight}/30`);
      t('and it is not simply always wrong', blindRight > 0, `${blindRight}/30`);
    })();

    /* ----- the same round asked twice gives the same answer ----- */
    (() => {
      const a = JSON.stringify(predictionsFor(2).map(r => [r.call, r.right]));
      const b = JSON.stringify(predictionsFor(2).map(r => [r.call, r.right]));
      t('a round marked twice is marked the same way', a === b);
      // and the cache cannot serve one state's answers to another
      const sig = predSignature();
      const keep = state.transfers.length;
      state.transfers.push({ managerId: mid, outId: 1, inId: 2, gw: 9, t: Date.now(), n: keep + 1 });
      t('the cache notices when the league underneath it changes', predSignature() !== sig);
      state.transfers.length = keep;
    })();

    /* ----- the card ----- */
    (() => {
      myId = state.managers[0].id; state.view = 'data'; dataView.tab = 'prediction'; dataView.predGw = null;
      render();
      const card = [...document.querySelectorAll('.card')]
        .find(c => /Prediction Accuracy/.test(c.querySelector('h2')?.textContent || ''));
      const txt = card ? card.textContent.replace(/\s+/g, ' ') : '';
      t('the card renders in its own Data Room section',
        !!card && !!document.querySelector('[data-dtab="prediction"]'));
      t('it shows all three tables Marc asked for',
        /Week by week/i.test(txt) && /game by game/i.test(txt) && /By team/i.test(txt));
      // the running total on the last row must be the whole season's marking
      const rows = card ? [...card.querySelectorAll('tbody tr')] : [];
      // the GW cell can carry a 'rebuilt' tag beside the number
      const weekRows = rows.filter(r => /^GW\d+\b/.test(r.cells[0].textContent.trim()));
      const total = rounds.flat().filter(r => r.right).length;
      t('the week-by-week table has a row per settled round',
        weekRows.length === 5, String(weekRows.length));
      t('and its last running total is the season\'s',
        weekRows.length === 5 && weekRows[4].cells[3].textContent.trim() === `${total}/30`,
        weekRows.length === 5 ? weekRows[4].cells[3].textContent.trim() : 'no row');
      t('it defaults to the most recent settled round', /GW5, game by game/i.test(txt));

      // by-team: twelve managers, five games each, and the percentages sorted
      const teamRows = rows.filter(r => /^\d+$/.test(r.cells[1]?.textContent.trim() || '') && r.cells.length === 5);
      t('the by-team table covers all twelve', teamRows.length === 12, String(teamRows.length));
      t('every manager played all five rounds',
        teamRows.every(r => r.cells[1].textContent.trim() === '5'));
      const pcts = teamRows.map(r => +r.cells[3].textContent.replace('%', ''));
      t('and the table runs highest accuracy first',
        pcts.every((x, k) => !k || pcts[k - 1] >= x), pcts.join(','));
      // every game is called for two managers, so the by-team column totals
      // must come to twice the season's tally
      const sum = teamRows.reduce((s, r) => s + +r.cells[2].textContent.trim(), 0);
      t('the by-team counts add up to the season tally, counted twice',
        sum === total * 2, `${sum} vs ${total * 2}`);
      // Marc's own example: of the weeks a manager won, how many we called
      t('the wins-called column never claims more wins than were won',
        teamRows.every(r => {
          const c = r.cells[4].textContent.trim();
          if (c === '—') return true;
          const [got, of] = c.split('/').map(Number);
          return got <= of && of <= 5;
        }));
    })();

    /* ----- the recorded ledger beats the rebuild -----
     * Marc, 15 Sept 2026: "why dont you just take a snapshot at the gameweek
     * deadline". A rebuild re-derives with today's model and would quietly
     * change the day the projection improves; a record is what was claimed.
     * So where a record exists it must be used verbatim — including when the
     * tie was published the other way up. */
    (() => {
      const i = 2, gwN = GAMEWEEKS[i].n;
      const rebuilt = predictionsFor(i).map(r => [r.a, r.b, r.call, r.recorded]);
      // publish a ledger for that round with the sides REVERSED and odds that
      // disagree with the rebuild, so there is no way to pass by accident
      const pairs = pairingsFor(i);
      state.predictions = { rounds: { [String(gwN)]: {
        deadline: 'x', taken: '2026-09-19T17:41:00Z',
        games: pairs.map(([a, b]) => ({ a: b, b: a, w: 0.07, d: 0.05, l: 0.88, pa: 33, pb: 61 })),
      } } };
      PRED_CACHE.clear();
      const rows = predictionsFor(i);
      t('a recorded round is read back instead of rebuilt',
        rows.every(r => r.recorded === true) && rebuilt.some(x => x[3] === false));
      // stored b-vs-a with 88% to the stored 'b' means the FIRST side of our
      // pairing is the one favoured, so every call must come back 'a'
      t('and a tie published the other way up is turned back the right way',
        rows.every(r => r.call === 'a' && Math.abs(r.o.win - 0.88) < 1e-9
          && Math.abs(r.o.loss - 0.07) < 1e-9),
        rows.map(r => `${r.call}/${r.o.win}`).join(' '));
      t('the projected scores come back the right way round too',
        rows.every(r => r.projA === 61 && r.projB === 33));
      t('the pairing itself is untouched by how it was stored',
        JSON.stringify(rows.map(r => [r.a, r.b])) === JSON.stringify(pairs));
      t('and the result is still the real one, not the record\'s',
        rows.every(r => r.pa === gwManagerPoints(r.a, i) && r.pb === gwManagerPoints(r.b, i)));

      // a round missing one of its six is not half-trusted
      state.predictions.rounds[String(gwN)].games.pop();
      PRED_CACHE.clear();
      t('a round missing a tie falls back to a rebuild entire',
        predictionsFor(i).every(r => r.recorded === false));

      // nor is one whose odds are nonsense
      state.predictions = { rounds: { [String(gwN)]: { games: pairs.map(([a, b]) => ({ a, b, w: null, d: null, l: null })) } } };
      PRED_CACHE.clear();
      t('a round with unreadable odds falls back to a rebuild',
        predictionsFor(i).every(r => r.recorded === false));

      // and the card says which is which rather than passing a rebuild off
      state.predictions = { rounds: { [String(gwN)]: { deadline: 'x', taken: 'y',
        games: pairs.map(([a, b]) => ({ a, b, w: 0.6, d: 0.1, l: 0.3, pa: 50, pb: 44 })) } } };
      PRED_CACHE.clear();
      state.view = 'data'; dataView.tab = 'prediction'; dataView.predGw = i; render();
      const card = [...document.querySelectorAll('.card')]
        .find(c => /Prediction Accuracy/.test(c.querySelector('h2')?.textContent || ''));
      const txt = card ? card.textContent.replace(/\s+/g, ' ') : '';
      const rowFor = n => [...card.querySelectorAll('tbody tr')]
        .find(r => r.cells[0].textContent.trim().startsWith(`GW${n}`));
      t('the card marks a rebuilt round as rebuilt',
        /rebuilt/.test(rowFor(GAMEWEEKS[0].n)?.textContent || ''));
      t('and does not call a recorded one rebuilt',
        !/rebuilt/.test(rowFor(gwN)?.textContent || ''));
      t('the card counts how many rounds are the Committee\'s own words',
        /1 of these 5 rounds is the Committee's own words/.test(txt), txt.slice(0, 220));
      t('and a recorded round shows the projection it published',
        /proj 50&ndash;44|proj 50–44/.test(card.innerHTML));

      /* ----- and it reaches the individual archived tie ----- */
      const [ma, mb] = pairingsFor(i)[0];
      showMatchup(ma, mb, i);
      const ov = document.querySelector('#muOverlay');
      const otxt = ov ? ov.textContent.replace(/\s+/g, ' ') : '';
      t('an archived tie shows what was said at the deadline',
        /AT THE DEADLINE/.test(otxt), otxt.slice(0, 120));
      t('and says whether the Committee got it right',
        /got it (right|wrong)/.test(otxt));
      t('and that it was recorded, not reconstructed',
        /Recorded at the deadline/.test(otxt));
      // a round with no record says so on the tie as well
      closeOv(ov);
      const [ea, eb] = pairingsFor(0)[0];
      showMatchup(ea, eb, 0);
      const ov2 = document.querySelector('#muOverlay');
      t('a tie from before the ledger says it was rebuilt',
        /Rebuilt: no record was kept/.test(ov2 ? ov2.textContent : ''));
      closeOv(ov2);
      // and an unplayed round keeps its live bar and nothing else
      showMatchup(...pairingsFor(WEEKS)[0], WEEKS);
      const ov3 = document.querySelector('#muOverlay');
      t('a tie still to be played shows no deadline verdict',
        !/AT THE DEADLINE/.test(ov3 ? ov3.textContent : ''));
      closeOv(ov3);

      state.predictions = null; PRED_CACHE.clear(); dataView.predGw = null;
    })();

    /* ----- picking a different week ----- */
    (() => {
      dataView.predGw = 0; render();
      const card = [...document.querySelectorAll('.card')]
        .find(c => /Prediction Accuracy/.test(c.querySelector('h2')?.textContent || ''));
      t('picking an earlier round switches the game-by-game table',
        /GW1, game by game/i.test(card ? card.textContent.replace(/\s+/g, ' ') : ''));
      dataView.predGw = null;
    })();

    window.gwStatus = realStatus;
    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors while marking the homework', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[prediction] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
