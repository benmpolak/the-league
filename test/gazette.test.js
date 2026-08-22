/* The Gazette writing engine + Transfer Report Cards + Record Book.
 * Pins: archetype selection, factual accuracy, determinism, repetition
 * cooldown, privacy (no private claims), escaping, verdict thresholds,
 * incomplete-window honesty, record tie-safety. */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); ok ? pass++ : fail++; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/?demo`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof Gazette !== 'undefined' && state.managers?.length);
  // craft one SETTLED gameweek before anything else. A fresh demo has no
  // finished gameweeks until the real calendar does, so from GW1 morning
  // (22 Aug) the paper led on the matchday preview — which has no headline by
  // design — and the record book had no records: two pins failing because the
  // scenario they assume ("a review edition exists") had expired, not because
  // the writing engine broke. Three score tiers keep results non-degenerate.
  await page.evaluate(() => {
    const ps = {};
    state.managers.forEach((m, k) => {
      for (const pid of effectiveXI(m.id, 0).xi) ps[pid] = { min: 90, st: 1, g: k % 3 };
    });
    state.matchStats['gw' + GAMEWEEKS[0].n] = { gw: 0, label: GAMEWEEKS[0].label, final: true, playerStats: ps };
  });

  /* archetype selection on crafted facts */
  const arch = await page.evaluate(() => {
    const base = { sa: 50, sb: 40, derby: false, posW: 4, posL: 5, margin: 10, cut: false, benchL: 0, ls: 40, ws: 50, avgW: 50, stW: { w: 1, l: 0 }, stL: { l: 1, w: 0 } };
    const c = f => Gazette._classify({ ...base, ...f });
    return {
      rout: c({ margin: 30 }),
      derby: c({ derby: true, margin: 30 }),                      // derby outranks rout
      upset: c({ posW: 10, posL: 4, margin: 12 }),
      bottle: c({ posW: 10, posL: 1, margin: 12 }),
      stalemate: c({ sa: 40, sb: 40, ws: 40, ls: 40, margin: 0 }),
      shootout: c({ sa: 60, sb: 60, ws: 60, ls: 60, margin: 0 }),
      hsd: c({ ls: 58, ws: 62, margin: 4, avgW: 55 }),
      sixp: c({ cut: true, posW: 7, posL: 8, margin: 6 }),
      snb: c({ ws: 40, ls: 34, margin: 6, avgW: 50 }),
      bench: c({ benchL: 15, margin: 6 }),
    };
  });
  chk('archetypes classify from facts (derby outranks rout; gates hold)',
    arch.rout === 'rout' && arch.derby === 'derby' && arch.upset === 'upset' && arch.bottle === 'bottle-job' && arch.stalemate === 'stalemate'
    && arch.shootout === 'shootout-draw' && arch.hsd === 'high-scoring-defeat' && arch.sixp === 'six-pointer'
    && arch.snb === 'smash-and-grab' && arch.bench === 'bench-disaster', JSON.stringify(arch));

  /* factual accuracy + determinism */
  const facts = await page.evaluate(() => {
    const html = Gazette.review(0);
    const txt = html.replace(/<[^>]+>/g, ' ');
    const doc = document.createElement('div'); doc.innerHTML = html;
    const table = h2hStandings();
    const posOf = Object.fromEntries(table.map((r, k) => [r.id, k]));
    const all = pairingsFor(0).map(([a, b]) => Gazette._facts(a, b, 0, table, posOf)).sort((x, y) => y.weight - x.weight);
    const scoresOk = all.every(f => txt.includes(String(f.ws)) && txt.includes(String(f.ls)));
    const headline = doc.querySelector('.prog-lead-story .prog-head')?.textContent || '';
    state.view = 'dash'; render();
    const frontHeadline = document.querySelector('.prog-card .prog-head-lead')?.textContent || '';
    return {
      deterministic: Gazette.review(0) === html, scoresOk, stories: doc.querySelectorAll('.prog-story').length,
      headline, frontHeadline, scoreline: !!doc.querySelector('.prog-lead-story .prog-scoreline'),
      awards: !!doc.querySelector('.prog-awards'), oldFiles: [...doc.querySelectorAll('.prog-sec')].some(x => /Old Files/.test(x.textContent)),
      dressingRoom: [...doc.querySelectorAll('.prog-sec')].some(x => /Dressing Room/.test(x.textContent)),
      sheetRows: doc.querySelectorAll('.prog-team-sheet .prog-sheet-row').length,
      receiptRows: doc.querySelectorAll('.prog-draft-receipts .prog-receipt').length,
      selectionDetail: /STARTED/.test(doc.querySelector('.prog-team-sheet')?.textContent || '') && /BENCHED/.test(doc.querySelector('.prog-team-sheet')?.textContent || ''),
      draftSources: /DRAFT R\d+\s*·\s*PICK \d+/.test(doc.querySelector('.prog-draft-receipts')?.textContent || ''),
      words: txt.trim().split(/\s+/).length,
      footballese: /form book|fine margins|full backing|three points|job done|bragging rights|dressing room|got away with it/i.test(txt),
    };
  });
  chk('every scoreline printed matches the computed results; output deterministic',
    facts.deterministic && facts.scoresOk && facts.stories >= 3, JSON.stringify(facts));
  chk('front page leads on an editorial headline; the edition has lore, verdicts and football language',
    facts.headline && facts.frontHeadline === facts.headline && facts.scoreline && facts.awards && facts.oldFiles
      && facts.dressingRoom && facts.sheetRows === 12 && facts.receiptRows === 6 && facts.selectionDetail && facts.draftSources
      && facts.words >= 280 && facts.footballese, JSON.stringify(facts));

  /* repetition cooldown: consecutive editions share no distinctive line ids */
  const cool = await page.evaluate(() => {
    // craft a second settled edition so there are two papers to compare
    state.matchStats.gw2 = { ...state.matchStats.gw1, gw: 1, label: 'GW2', final: true };
    const a = Gazette._editionLineIds(0);
    const b = Gazette._editionLineIds(1);
    const extract = html => {
      const d = document.createElement('div'); d.innerHTML = html;
      return { head: d.querySelector('.prog-lead-story .prog-head')?.textContent, lead: d.querySelector('.prog-lead-story p')?.textContent };
    };
    return { a: a.length, b: b.length, first: extract(Gazette.review(0)), second: extract(Gazette.review(1)) };
  });
  chk('cooldown: consecutive editions reuse no distinctive headlines or lead lines',
    cool.a > 0 && cool.b > 0 && cool.first.head && cool.second.head
      && cool.first.head !== cool.second.head && cool.first.lead !== cool.second.lead, JSON.stringify(cool));

  /* privacy: pending claims never surface in the paper */
  const priv = await page.evaluate(() => {
    const mid = state.managers[0].id;
    const target = PLAYERS.find(p => !ownedIdsAt(0).has(p.id));
    state.claims[currentGwIndex()] = { [mid]: [{ in: target.id, out: squadAt(mid, 0)[0].id }] };
    const txt = Gazette.review(0).replace(/<[^>]+>/g, ' ');
    delete state.claims[currentGwIndex()];
    return { leak: txt.includes(target.name) && !state.transfers.some(t => t.inId === target.id), name: target.name };
  });
  chk('privacy: a pending blind claim never appears in print', priv.leak === false, JSON.stringify(priv));

  /* escaping: hostile team name in the headline renders inert */
  const xss = await page.evaluate(() => {
    const orig = state.managers[0].team;
    state.managers[0].team = '<img data-gz-xss src=x>';
    state.view = 'dash'; progView.gw = null; render();
    const injected = !!document.querySelector('[data-gz-xss]');
    state.managers[0].team = orig; render();
    return { injected };
  });
  chk('escaping: hostile club name cannot inject markup through the paper', xss.injected === false, JSON.stringify(xss));

  /* report cards: thresholds + incomplete-window honesty */
  const rc = await page.evaluate(() => {
    const v = (diff, h) => transferVerdict({ diff }, h);
    const t = state.transfers.find(x => x.gw === 0) || state.transfers[0];
    const incomplete = transferWindowFacts({ ...t, gw: 30 }, 3); // window runs past settled play
    return {
      robbery: v(25, 3), inspired: v(12, 3), promising: v(5, 3), sideways: v(0, 6), jury: v(-5, 3), mistake: v(-15, 6),
      incomplete,
    };
  });
  chk('verdict ladder is deterministic and the incomplete window refuses to judge',
    rc.robbery === 'daylight robbery' && rc.inspired === 'inspired business' && rc.promising === 'a promising start'
    && rc.sideways === 'a sideways move' && rc.jury === 'jury still out' && rc.mistake === 'an expensive mistake'
    && rc.incomplete === null, JSON.stringify(rc));

  /* the week's back pages + permanent archive slots (Ben, GW1 night: "keep
     stories for a week... old news moves down the page... then move out").
     The Post-Draft Special must survive GW1 settling — it vanished before. */
  const week = await page.evaluate(async () => {
    const out = {};
    document.querySelectorAll('.overlay').forEach(o => o.remove());
    gazetteSheet();
    const room = () => document.querySelector('.gazette-room');
    const rules = () => [...(room()?.querySelectorAll('.prog-backpage-rule') || [])].map(x => x.textContent.trim());
    const nav = () => [...(room()?.querySelectorAll('[data-progw]') || [])].map(b => b.dataset.progw);
    out.backRules = rules(); out.navVals = nav();
    const sp = [...room().querySelectorAll('[data-progw]')].find(b => b.dataset.progw === 'special');
    sp?.click(); await new Promise(r => setTimeout(r, 80));
    out.specialPlate = room()?.querySelector('.prog-date')?.textContent || '';
    const back = [...room().querySelectorAll('[data-progw]')].find(b => b.dataset.progw === 'today');
    back?.click(); await new Promise(r => setTimeout(r, 80));
    out.backPlate = room()?.querySelector('.prog-date')?.textContent || '';
    // eight days on: the special has aged out of the week stack but keeps
    // its archive slot forever
    const realNow = Date.now;
    Date.now = () => realNow() + 8 * 864e5;
    try { gazetteSheet(); out.agedRules = rules(); out.agedNav = nav(); }
    finally { Date.now = realNow; }
    room()?.closest('.overlay')?.remove();
    return out;
  });
  chk('reading room stacks the week\'s back pages beneath the lead',
    week.backRules.length >= 1 && week.backRules.some(r => /post-draft special/i.test(r)), JSON.stringify(week.backRules));
  chk('archive offers permanent Draft Special and Season Preview slots',
    week.navVals.includes('special') && week.navVals.includes('preview'), JSON.stringify(week.navVals));
  chk('Draft Special opens from the archive and Today returns',
    /post-draft special/i.test(week.specialPlate) && /from the archive/i.test(week.specialPlate) && !/from the archive/i.test(week.backPlate),
    JSON.stringify({ sp: week.specialPlate, back: week.backPlate }));
  chk('after a week the special leaves the stack but keeps its archive slot',
    !week.agedRules.some(r => /post-draft special/i.test(r)) && week.agedNav.includes('special'),
    JSON.stringify({ agedRules: week.agedRules, agedNav: week.agedNav }));

  /* record book: computed, tie-safe, renders */
  const rb = await page.evaluate(() => {
    const recs = seasonRecordsNow(0);
    const hi = recs.find(r => r.key === 'hi');
    const table = h2hStandings();
    // independent recompute of the top weekly score
    let best = -1; const holders = [];
    for (const [a, b] of pairingsFor(0)) for (const m of [a, b]) {
      const s = gwManagerPoints(m, 0);
      if (s > best) { best = s; holders.length = 0; holders.push(m); }
      else if (s === best) holders.push(m);
    }
    state.view = 'data'; render();
    const cardTxt = [...document.querySelectorAll('.card h2')].find(h => /Record Book/.test(h.textContent))?.closest('.card')?.innerText || '';
    return { hiOk: hi && hi.value === best && hi.holders.length === holders.length,
      renders: /Highest weekly score/.test(cardTxt) && /this season/.test(cardTxt),
      overflow: document.documentElement.scrollWidth <= 391 };
  });
  chk('record book agrees with an independent recompute, is tie-safe, and renders at 390px',
    rb.hiOk === true && rb.renders === true && rb.overflow === true, JSON.stringify(rb));

  await browser.close();
  console.log(`\n[gazette] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Error', e); process.exit(1); });
