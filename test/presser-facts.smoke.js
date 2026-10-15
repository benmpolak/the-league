/* The facts behind the six new press-conference questions (74becc1; Ian,
 * 13 Oct 2026; Ben, 15 Oct: Football Manager style). cunthanger.test.js
 * checks the wording given a fact; this checks the facts presserCtx builds
 * from a real-shaped league, in the page, and that Cunthanger asks the
 * matching question with those numbers in. Pins:
 *   1. the gap to this week's opponent is capital-P table Points
 *      (h2hStandings .pts), never the fantasy points the table tiebreaks on
 *   2. the playoff line: a cushion to ninth inside the eight, a gap to eighth
 *      outside it, both in Points, never both
 *   3. the Monzo Cup from monzoCupRounds: out on the lowest score, alive by a
 *      margin over the man who went, or joint bottom and saved by the tie
 *   4. a trade read from server-shaped records (trade: '<id>' on both sides'
 *      transfers), with the partner named, and never mistaken for a Trough deal
 * Fable's review, 15 Oct 2026, asked for these. Stubbed-sync harness as
 * transfers-desk.smoke.js: twelve squads drafted by rating, the real season's
 * stats pulled in by syncNow, so the table, the Cup and the pairings are the
 * page's own arithmetic. */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
// the service worker would fetch sync.js past the request block (5458de9)
const noLiveFirebase = pg => pg.evaluate(() => !performance.getEntriesByType('resource').some(e => /gstatic\.com\/firebasejs/.test(e.name)));
let fail = 0, n = 0;
const chk = (name, cond, extra = '') => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`); if (!cond) fail++; };
const J = x => JSON.stringify(x);
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await browser.newPage();
  await p.setBypassServiceWorker(true);
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });
  await p.setViewport({ width: 1100, height: 900 });
  await p.setRequestInterception(true);
  p.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && typeof Cunthanger !== 'undefined');
  const seeded = await p.evaluate(async () => {
    window.WCSync = {
      league: 'the-league-2627',
      call: () => Promise.resolve({ ok: true }),
      auth: { user: () => ({ uid: 'u-test', email: 'ben@example.com' }), sendLink: () => Promise.resolve(), completeLink: () => Promise.resolve(false), signOut: () => Promise.resolve() },
    };
    const s = freshState(); s.phase = 'season'; s.draft.order = s.managers.map(m => m.id);
    // twelve squads of fourteen, drafted by rating, so every round has a
    // result in it and the table and the Cup are real arithmetic
    const byPos = { GK: [], DF: [], MF: [], FW: [] };
    for (const q of PLAYERS) if (!hasLeft(q) && !arrivalLocked(q)) byPos[q.pos].push(q);
    for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => rating(b) - rating(a));
    const need = { GK: 2, DF: 5, MF: 4, FW: 3 };
    let k = 0;
    s.managers.forEach((m, i) => {
      for (const pos of Object.keys(need)) for (let j = 0; j < need[pos]; j++) {
        const q = byPos[pos][i * need[pos] + j];
        s.draft.picks.push({ managerId: m.id, playerId: q.id, code: q.code ?? null, n: ++k });
      }
    });
    window._snap = JSON.parse(JSON.stringify({ phase: s.phase, managers: s.managers, settings: s.settings, draft: s.draft, lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta, adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null, tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null }));
    window.onSharedSnapshot(window._snap);
    await new Promise(r => setTimeout(r, 50));
    window.onAuthChanged({ uid: 'u-test', email: 'ben@example.com' });
    window.onMembershipSnapshot({ managerId: 1, role: 'commissioner' });
    window.onPrivateSnapshot({});
    window.__autoConfirm = true;
    // the snapshot carries no stats; the real season's land here, as on any device
    await syncNow(false);
    window._snap.matchStats = state.matchStats; // so a later snapshot keeps them
    return { last: lastFinalGw(), managers: state.managers.length, players: Object.keys(state.matchStats).length };
  });
  chk('a season with at least four settled rounds to ask about', seeded.last >= 3 && seeded.managers === 12, J(seeded));
  const last = seeded.last;

  /* 1 — the gap is table Points */
  const gap = await p.evaluate(last => {
    const g = last + 1; // the round coming up: a pre-match conference
    const table = h2hStandings(false, g);
    const row = id => table.find(r => r.id === id);
    return state.managers.map(m => {
      const ctx = presserCtx(m.id, g, 'pre');
      const pr = pairingsFor(g).find(x => x.includes(m.id));
      const opp = pr[0] === m.id ? pr[1] : pr[0];
      return { mid: m.id, gap: ctx.gap, pts: [row(m.id).pts, row(opp).pts], ovr: [row(m.id).ovr, row(opp).ovr] };
    });
  }, last);
  chk('the gap to the opponent is both sides\' table Points, for every manager', gap.every(x => x.gap && x.gap.my === x.pts[0] && x.gap.th === x.pts[1]), J(gap.filter(x => !x.gap || x.gap.my !== x.pts[0] || x.gap.th !== x.pts[1])));
  chk('and not the overall fantasy points the table tiebreaks on', gap.every(x => x.ovr[0] !== x.pts[0] && x.gap.my !== x.ovr[0]), J(gap.slice(0, 3)));
  const gapQ = await p.evaluate(last => {
    const hits = [], bad = [];
    for (let g = 1; g <= last + 1; g++) for (const m of state.managers) {
      const ctx = presserCtx(m.id, g, 'pre');
      if (!ctx.gap) continue;
      const q = Cunthanger.questions(ctx, 'pre').find(x => x.id === 'gap');
      if (!q) continue;
      const d = Math.abs(ctx.gap.my - ctx.gap.th);
      const want = ctx.gap.my === ctx.gap.th ? `level on ${ctx.gap.my} Point${ctx.gap.my === 1 ? '' : 's'}` : `${d} Point${d === 1 ? '' : 's'}`;
      const side = ctx.gap.my < ctx.gap.th ? /above you|between you/ : ctx.gap.my > ctx.gap.th ? /clear of|ahead/ : /level on/;
      (q.q.includes(want) && side.test(q.q) ? hits : bad).push({ mid: m.id, g, gap: ctx.gap, q: q.q });
    }
    return { hits: hits.length, bad, sample: hits[0] };
  }, last);
  chk('the press ask about the gap, in Points, from the right side of it', gapQ.hits > 0 && !gapQ.bad.length, J(gapQ.bad.length ? gapQ.bad : gapQ));

  /* 2 — the playoff line after the round */
  const po = await p.evaluate(last => {
    const after = h2hStandings(false, last + 1);
    return state.managers.map(m => {
      const ctx = presserCtx(m.id, last, 'post');
      const k = after.findIndex(r => r.id === m.id);
      return { mid: m.id, k, playoff: ctx.playoff, pts: after[k].pts, eighth: after[7].pts, ninth: after[8].pts, ovrToNinth: after[k].ovr - after[8].ovr, left: REGULAR_GWS - 1 - last };
    });
  }, last);
  const inside = po.filter(x => x.k < 8), outside = po.filter(x => x.k >= 8);
  chk('inside the eight: position, rounds left, a cushion in Points to ninth and no gap', inside.length === 8 && inside.every(x => x.playoff && x.playoff.pos === x.k + 1 && x.playoff.left === x.left && x.playoff.cushion === x.pts - x.ninth && x.playoff.gap === null), J(inside));
  chk('outside it: a gap in Points to eighth and no cushion', outside.length === 4 && outside.every(x => x.playoff && x.playoff.pos === x.k + 1 && x.playoff.left === x.left && x.playoff.gap === x.eighth - x.pts && x.playoff.cushion === null), J(outside));
  chk('the leader\'s cushion is Points, not his overall-points lead over ninth', inside[0].playoff.cushion !== inside[0].ovrToNinth, J([inside[0].playoff.cushion, inside[0].ovrToNinth]));
  const poQ = await p.evaluate(last => {
    const P = k => `${k} Point${k === 1 ? '' : 's'}`;
    const hits = [], bad = [];
    for (let g = 3; g <= last; g++) for (const m of state.managers) {
      const ctx = presserCtx(m.id, g, 'post');
      if (!ctx.playoff) continue;
      const q = Cunthanger.questions(ctx, 'post').find(x => x.id === 'playoff');
      if (!q) continue;
      const o = ctx.playoff;
      const ok = o.pos <= 8
        ? (o.cushion > 0 ? q.q.includes(P(o.cushion)) && /clear/.test(q.q) : /only overall points keep you above ninth/.test(q.q))
        : (o.gap > 0 ? q.q.includes(P(o.gap)) && /off the top eight|to make up on eighth/.test(q.q) : /level on Points with eighth/.test(q.q));
      (ok ? hits : bad).push({ mid: m.id, g, playoff: o, q: q.q });
    }
    return { hits: hits.length, bad, sample: hits[0] };
  }, last);
  chk('the press ask about the playoff line with the cushion or the gap in Points', poQ.hits > 0 && !poQ.bad.length, J(poQ.bad.length ? poQ.bad : poQ));

  /* 3 — the Monzo Cup, from the one calculation the Cup page uses */
  const cup = await p.evaluate(last => {
    // the first Cup round, settled with the last settled round's numbers, so
    // the Cup has a round to talk about before the real one lands
    const i = CUP_START;
    const src = state.matchStats[`gw${GAMEWEEKS[last].n}`];
    state.matchStats[`gw${GAMEWEEKS[i].n}`] = { gw: i, label: GAMEWEEKS[i].label, date: GAMEWEEKS[i].from, final: true, playerStats: JSON.parse(JSON.stringify(src.playerStats)) };
    state.adjustments = {};
    const round = () => monzoCupRounds(i).rounds.find(r => r.i === i);
    let cr = round();
    // a straight knockout first: should the bottom happen to be tied, a
    // Chairman's correction lifts all but one man off it
    if (cr.tie) {
      const low = cr.scores[cr.scores.length - 1].pts;
      state.adjustments[i] = Object.fromEntries(cr.scores.filter(s => s.pts === low).slice(1).map(s => [effectiveXI(s.id, i).xi[0], 1]));
      cr = round();
    }
    const pts = k => `${k} point${k === 1 ? '' : 's'}`;
    const low = cr.scores[cr.scores.length - 1], top = cr.scores[0];
    const facts = state.managers.map(m => ({ mid: m.id, cup: presserCtx(m.id, i, 'post').cup }));
    const wantOut = { out: true, score: low.pts };
    const wantTop = { out: false, score: top.pts, margin: top.pts - low.pts, left: cr.scores.length - 1, outTeam: teamName(cr.out), tied: false };
    const hits = [], bad = [];
    for (const m of state.managers) {
      const ctx = presserCtx(m.id, i, 'post');
      const q = Cunthanger.questions(ctx, 'post').find(x => x.id === 'cup');
      if (!q) continue;
      const c = ctx.cup;
      const ok = c.out ? q.q.includes(pts(c.score)) && /you out|go out of the Monzo Cup/.test(q.q)
        : (q.q.includes(pts(c.margin)) && q.q.includes(cleanTeamName(c.outTeam))) || q.q.includes(`${c.left} left in the Monzo Cup`);
      (ok ? hits : bad).push({ mid: m.id, cup: c, q: q.q });
    }
    // now a tie at the bottom: the lowest man's first starter is corrected up
    // to level with the man above him, and nobody goes
    const second = cr.scores[cr.scores.length - 2];
    state.adjustments[i] = { ...(state.adjustments[i] || {}), [effectiveXI(low.id, i).xi[0]]: second.pts - low.pts };
    const cr2 = round();
    const tiedCtx = presserCtx(low.id, i, 'post'), topCtx2 = presserCtx(top.id, i, 'post');
    const wantTied = { out: false, score: second.pts, margin: 0, left: cr2.scores.length, outTeam: null, tied: true };
    const wantTop2 = { out: false, score: top.pts, margin: top.pts - second.pts, left: cr2.scores.length, outTeam: null, tied: false };
    // the question itself, with no bench story competing for the news slot
    const tiedQ = Cunthanger.questions({ ...tiedCtx, benchBurn: null }, 'post').find(x => x.id === 'cup');
    return { out: cr.out, tie: cr.tie, facts, wantOut, wantTop, outFact: facts.find(f => f.mid === cr.out).cup, topFact: facts.find(f => f.mid === top.id).cup,
      hits: hits.length, bad, sample: hits[0], tie2: { tie: cr2.tie, out: cr2.out, low: cr2.scores.slice(-2).map(s => s.pts) },
      tied: tiedCtx.cup, wantTied, top2: topCtx2.cup, wantTop2, tiedQ: tiedQ ? tiedQ.q : null, wantTiedQ: `Joint bottom of the Monzo Cup on ${pts(second.pts)}, and nobody goes` };
  }, last);
  chk('the round settles with one man out', cup.out != null && !cup.tie, J(cup.tie2));
  chk('the man out is told so, with his score', J(cup.outFact) === J(cup.wantOut), J([cup.outFact, cup.wantOut]));
  chk('a survivor gets his margin over the man who went, who is named, and the field left', J(cup.topFact) === J(cup.wantTop), J([cup.topFact, cup.wantTop]));
  chk('every manager in the round has a Cup fact', cup.facts.every(f => f.cup && typeof f.cup.score === 'number'), J(cup.facts.filter(f => !f.cup)));
  chk('the press ask about the Cup with the score, the margin and the loser, or the field', cup.hits > 0 && !cup.bad.length, J(cup.bad.length ? cup.bad : cup));
  chk('a Chairman\'s correction ties the bottom and nobody goes', cup.tie2.tie === true && cup.tie2.out === null && cup.tie2.low[0] === cup.tie2.low[1], J(cup.tie2));
  chk('joint bottom: no margin, no loser, the whole field still in, and tied', J(cup.tied) === J(cup.wantTied), J([cup.tied, cup.wantTied]));
  chk('the survivor above the tie keeps his margin and is not tied', J(cup.top2) === J(cup.wantTop2), J([cup.top2, cup.wantTop2]));
  chk('the tied man is asked the joint-bottom question, never a margin or a loser', !!cup.tiedQ && cup.tiedQ.startsWith(cup.wantTiedQ), J([cup.tiedQ, cup.wantTiedQ]));

  /* 4 — a trade, from the records the server writes */
  const trade = await p.evaluate(async last => {
    const a = squadAt(1, 0).find(x => x.pos === 'MF'), b = squadAt(2, 0).find(x => x.pos === 'MF');
    const res = { facts: [], hits: 0, bad: [], sample: null };
    for (let g = 1; g <= last + 1; g++) {
      // one trade, two records, both stamped with its id (functions/index.js, tradeAccept)
      const t = Date.now();
      const transfers = [
        { managerId: 1, outId: a.id, outCode: a.code ?? null, inId: b.id, inCode: b.code ?? null, gw: g, t, trade: 'tr-test-1' },
        { managerId: 2, outId: b.id, outCode: b.code ?? null, inId: a.id, inCode: a.code ?? null, gw: g, t, trade: 'tr-test-1' },
      ];
      window.onSharedSnapshot(JSON.parse(JSON.stringify({ ...window._snap, transfers })));
      await new Promise(r => setTimeout(r, 30));
      for (const [mid, inP, outP, partner] of [[1, b, a, 2], [2, a, b, 1]]) {
        const ctx = presserCtx(mid, g, 'pre');
        res.facts.push({ mid, g, trade: ctx.trade, want: { inName: inP.name, outName: outP.name, withTeam: teamName(partner) }, signed: ctx.signed, dropped: ctx.dropped });
        const q = Cunthanger.questions(ctx, 'pre').find(x => x.id === 'trade');
        if (!q) continue;
        if (q.q.includes(inP.name) || q.q.includes(outP.name)) { res.hits++; res.sample = res.sample || { mid, g, q: q.q }; } else res.bad.push({ mid, g, q: q.q });
      }
    }
    return res;
  }, last);
  chk('a trade is read from the server-shaped records, both sides, partner named', trade.facts.length === (last + 1) * 2 && trade.facts.every(f => J(f.trade) === J(f.want)), J(trade.facts.filter(f => J(f.trade) !== J(f.want)).slice(0, 2)));
  chk('and is never mistaken for a Trough signing', trade.facts.every(f => f.signed === null && f.dropped === null), J(trade.facts.filter(f => f.signed || f.dropped).slice(0, 2)));
  chk('the press ask about the trade by name', trade.hits > 0 && !trade.bad.length, J(trade.bad.length ? trade.bad : trade.sample));

  chk('no page loaded the live Firebase SDK', await noLiveFirebase(p));
  await browser.close();
  console.log(`\n[presser-facts] ${n - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
