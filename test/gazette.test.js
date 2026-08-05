/* The Gazette writing engine + Transfer Report Cards + Record Book.
 * Pins: archetype selection, factual accuracy, determinism, repetition
 * cooldown, privacy (no private claims), escaping, verdict thresholds,
 * incomplete-window honesty, record tie-safety. Needs the 8125 server. */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); ok ? pass++ : fail++; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto('http://localhost:8125/?demo', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof Gazette !== 'undefined' && state.managers?.length);

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
    const table = h2hStandings();
    const posOf = Object.fromEntries(table.map((r, k) => [r.id, k]));
    const all = pairingsFor(0).map(([a, b]) => Gazette._facts(a, b, 0, table, posOf)).sort((x, y) => y.weight - x.weight);
    const scoresOk = all.every(f => txt.includes(String(f.ws)) && txt.includes(String(f.ls)));
    return { deterministic: Gazette.review(0) === html, scoresOk, stories: (html.match(/prog-story/g) || []).length };
  });
  chk('every scoreline printed matches the computed results; output deterministic',
    facts.deterministic && facts.scoresOk && facts.stories >= 3, JSON.stringify(facts));

  /* repetition cooldown: consecutive editions share no distinctive line ids */
  const cool = await page.evaluate(() => {
    // craft a second settled edition so there are two papers to compare
    state.matchStats.gw2 = { ...state.matchStats.gw1, gw: 1, label: 'GW2', final: true };
    const a = Gazette._editionLineIds(0);
    const b = Gazette._editionLineIds(1);
    const overlap = a.filter(id => b.includes(id) && !id.startsWith('sr') && !id.startsWith('cr'));
    // std-report + closing banks are small; DISTINCTIVE leads must not repeat
    const leadOverlap = a.filter(id => b.includes(id) && /l\d/.test(id) && !id.startsWith('sr'));
    return { a: a.length, b: b.length, leadOverlap };
  });
  chk('cooldown: consecutive editions reuse no distinctive lead lines',
    cool.a > 0 && cool.b > 0 && cool.leadOverlap.length === 0, JSON.stringify(cool));

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
