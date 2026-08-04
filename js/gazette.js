/* The League Gazette — the writing engine.
 *
 * Rebuilt per sol's product review + the Chairman's brief (UAT week): every
 * match is CLASSIFIED into a factual story archetype before a word is
 * written, each archetype gets its own article shape and phrase bank, the
 * clichés are gated on facts actually in evidence, and the lore desk mines
 * ONLY public state (streaks, reverse fixtures, rivalries, provenance,
 * dealings between clubs, bench form, the table, the honours board). Private
 * subtrees — waiver claims, autolists — are never read here, by rule.
 *
 * Determinism: everything derives from settled state plus (gw, matchup)
 * seeds. The repetition cooldown does NOT use device storage — usage is
 * re-derived by replaying earlier editions' selections, so every phone
 * prints the same paper and no distinctive line repeats within
 * COOLDOWN_EDITIONS editions.
 *
 * Voice targets: Ceefax, Football365, the local paper, and a slightly drunk
 * Sunday-league chairman. Never generic. All manager-controlled text goes
 * through esc() at the point of use.
 */
'use strict';
window.Gazette = (() => {

  const COOLDOWN_EDITIONS = 3;

  /* deterministic pick: seed → index, avoiding ids used in recent editions */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ---------- fact desk (public state only) ---------- */

  function seasonAvg(mid, uptoGw) {
    let t = 0, n = 0;
    for (let i = 0; i < uptoGw; i++) if (gwStatus(i) === 'final') { t += gwManagerPoints(mid, i); n++; }
    return n ? t / n : null;
  }
  function streaks(mid, uptoGw) {
    let w = 0, l = 0, unbeaten = 0, winless = 0;
    for (let i = uptoGw; i >= 0; i--) {
      if (gwStatus(i) !== 'final') continue;
      const pr = pairingsFor(i).find(x => x.includes(mid));
      if (!pr) continue;
      const op = pr[0] === mid ? pr[1] : pr[0];
      const a = gwManagerPoints(mid, i), b = gwManagerPoints(op, i);
      const res = a > b ? 'W' : a < b ? 'L' : 'D';
      if (res === 'W' && l === 0 && winless === 0) w++; else if (w > 0) break;
      if (res === 'L' && w === 0 && unbeaten === 0) l++; else if (l > 0) break;
      if (res !== 'L') unbeaten++; else if (unbeaten > 0) break;
      if (res !== 'W') winless++; else if (winless > 0) break;
    }
    return { w, l, unbeaten, winless };
  }
  function reverseMeeting(a, b, uptoGw) {
    for (let i = uptoGw - 1; i >= 0; i--) {
      if (gwStatus(i) !== 'final') continue;
      const pr = pairingsFor(i).find(x => x.includes(a) && x.includes(b));
      if (!pr) continue;
      const sa = gwManagerPoints(a, i), sb = gwManagerPoints(b, i);
      if (sa === sb) return null;
      return { gw: i, winner: sa > sb ? a : b, sa, sb };
    }
    return null;
  }
  function provenance(mid, pid) {
    const pk = (state.draft.picks || []).find(x => x.managerId === mid && x.playerId === pid);
    if (pk && pk.n) return { kind: 'draft', round: Math.ceil(pk.n / state.managers.length), n: pk.n };
    const tr = [...state.transfers].reverse().find(t => t.managerId === mid && t.inId === pid);
    if (!tr) return null;
    return { kind: tr.trade ? 'trade' : tr.windowDraft ? 'window' : tr.waiver ? 'waiver' : 'trough' };
  }
  // a player scoring against a fantasy club that used to own him
  function oldClubGrudge(pid, oppMid, gwIdx) {
    return state.transfers.some(t => t.managerId === oppMid && t.outId === pid && t.gw <= gwIdx)
      || (state.draft.picks || []).some(pk => pk.managerId === oppMid && pk.playerId === pid)
      && state.transfers.some(t => t.managerId === oppMid && t.outId === pid);
  }
  function dealingsBetween(a, b) {
    return state.transfers.filter(t => t.trade && (t.managerId === a || t.managerId === b))
      .filter(t => {
        const twin = state.transfers.find(u => u.trade && u.managerId === (t.managerId === a ? b : a) && u.inId === t.outId && u.outId === t.inId && u.gw === t.gw);
        return !!twin && t.managerId === a;
      });
  }
  function benchWasteOf(mid, gwIdx) {
    return Math.max(0, optimalXI(mid, gwIdx) - gwManagerPoints(mid, gwIdx));
  }
  function benchLeaderStreak(mid, uptoGw) {
    let run = 0;
    for (let i = uptoGw; i >= 0; i--) {
      if (gwStatus(i) !== 'final') continue;
      const worst = state.managers.reduce((best, m) => {
        const w = benchWasteOf(m.id, i);
        return !best || w > best.w ? { id: m.id, w } : best;
      }, null);
      if (worst && worst.id === mid && worst.w > 0) run++; else break;
    }
    return run;
  }
  function topScorer(mid, gwIdx) {
    let best = null;
    for (const pid of lineupFor(mid, gwIdx)) {
      const pts = gwPlayerPoints(pid, gwIdx);
      if (!best || pts > best.pts) best = { p: PLAYER_BY_ID[pid], pts };
    }
    return best && best.p ? best : null;
  }
  function shiftLine(pid, gwIdx) {
    const s = gwEvent(gwIdx)?.playerStats?.[pid];
    if (!s) return '';
    const bits = [];
    if ((s.g || 0) >= 3) bits.push('a hat-trick'); else if (s.g === 2) bits.push('a brace'); else if (s.g === 1) bits.push('a goal');
    if ((s.a || 0) === 1) bits.push('an assist'); else if ((s.a || 0) >= 2) bits.push(`${s.a} assists`);
    if (s.cs && ['GK', 'DF'].includes(PLAYER_BY_ID[pid]?.pos)) bits.push('a clean sheet');
    if (s.ps) bits.push('a penalty saved');
    if (s.rc) bits.push('a red card');
    return bits.length <= 2 ? bits.join(' and ') : `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}`;
  }

  /* ---------- the classification desk ---------- */

  function classify(f) {
    // f: {a, b, sa, sb, w, l, ws, ls, margin, posW, posL, stW, stL, derby, revenge, benchL, avgW, avgL, cut}
    if (f.sa === f.sb) return f.sa >= 55 ? 'shootout-draw' : 'stalemate';
    if (f.derby) return 'derby';
    if (f.posW - f.posL >= 5 && f.posW >= 7) return 'upset';           // lower-placed side wins big table gap
    if (f.posL <= 2 && f.posW >= 9) return 'bottle-job';               // top side beaten by the basement
    if (f.margin >= 25) return 'rout';
    if (f.cut) return 'six-pointer';
    if (f.benchL >= 12 && f.benchL > f.margin) return 'bench-disaster'; // the bench would have turned it
    if (f.ls >= 55) return 'high-scoring-defeat';
    if (f.avgW != null && f.ws < f.avgW - 5 && f.margin <= 8) return 'smash-and-grab';
    if (f.posW <= 2 && f.stW.w >= 3) return 'title-charge';
    if (f.posL >= 10 && f.stL.l >= 3) return 'collapse';
    if (f.posW >= 5 && f.posW <= 8 && f.posL >= 5 && f.posL <= 8) return 'mid-table-scrap';
    return 'standard';
  }
  const WEIGHT = { derby: 90, upset: 80, 'bottle-job': 78, rout: 70, 'six-pointer': 66, 'bench-disaster': 60, 'high-scoring-defeat': 56, 'smash-and-grab': 52, 'title-charge': 50, collapse: 46, 'shootout-draw': 40, 'mid-table-scrap': 30, stalemate: 24, standard: 20 };

  /* ---------- phrase banks (id'd for the cooldown ledger) ---------- */
  /* Each entry: [id, builder(f, L) => string]. Builders only state facts
     already established in f/L. Clichés live where their gate is true. */

  const B = {
    'derby-lead': [
      ['dl1', f => `Form book, meet window. ${f.tw} ${f.ws}, ${f.tl} ${f.ls}, and the bragging rights are not up for discussion until the reverse fixture.`],
      ['dl2', f => `They say derbies are never won on paper, and this one wasn't: it was won by ${f.tw}, ${f.ws}–${f.ls}, in an atmosphere ${f.gaffW ? `${f.gaffW} described as "hostile, mostly from our own supporters"` : 'best described as personal'}.`],
      ['dl3', f => `El Clásico came to ${f.ground} and ${f.tw} sent ${f.tl} home with nothing but a long think. ${f.ws}–${f.ls}, and it was not as close as that sounds.`],
    ],
    'upset-lead': [
      ['ul1', f => `The form book went out the window at ${f.ground}: ${f.tw}, ${ord(f.posW + 1)} in the table, put ${ord(f.posL + 1)}-placed ${f.tl} to the sword, ${f.ws}–${f.ls}.`],
      ['ul2', f => `Nobody gave ${f.tw} a prayer. ${f.tw} did not require one — ${f.ws}–${f.ls} against ${f.tl}, and the league's punditocracy has some explaining to do.`],
      ['ul3', f => `Against the run of the season, if not the run of play: ${f.tw} ${f.ws}, ${f.tl} ${f.ls}. Fine margins, they say. This wasn't one of them.`],
    ],
    'rout-lead': [
      ['rl1', f => `${f.tw} did not so much beat ${f.tl} as dismantle them for parts: ${f.ws}–${f.ls}, a margin of ${f.margin} that flatters nobody involved except the winners.`],
      ['rl2', f => `Men against boys at ${f.ground}. ${f.tw} put ${f.tl} to the sword ${f.ws}–${f.ls}, and by the end the only question was whether the Committee licenses mercy rules.`],
      ['rl3', f => `A ${f.margin}-point hiding. ${f.tw} ${f.ws}, ${f.tl} ${f.ls}, and ${f.mgrL}'s post-match interview was conducted entirely in sighs.`],
    ],
    'bottle-lead': [
      ['bl1', f => `A bottle job for the ages: ${f.tl}, ${ord(f.posL + 1)} in the table and cruising, beaten ${f.ws}–${f.ls} by ${ord(f.posW + 1)}-placed ${f.tw}. Squeaky-bum time starts early this year.`],
      ['bl2', f => `The league leaders lost the dressing room, the plot, and the match: ${f.tw} ${f.ws}, ${f.tl} ${f.ls}. Goals change games. Not having any changes them more.`],
    ],
    'sixp-lead': [
      ['sl1', f => `A proper six-pointer either side of the dashed line, and it was ${f.tw} who asked the serious questions: ${f.ws}–${f.ls}, with ${f.tl} left staring at the cut.`],
      ['sl2', f => `Both camps called it "just another gameweek". Both camps lied. ${f.tw} ${f.ws}, ${f.tl} ${f.ls}, and the playoff line moved underneath them while they played.`],
    ],
    'bench-lead': [
      ['xl1', f => `Tactical negligence at ${f.ground}: ${f.tl} left ${f.benchL} points rotting on the bench and lost by ${f.margin}. The Committee records the arithmetic without comment. The Gazette is not the Committee.`],
      ['xl2', f => `${f.tl} lost this match in team selection on Friday, not on the pitch: ${f.benchL} points benched, beaten by ${f.margin}. ${f.asstL ? `${f.asstL} was seen gesturing at a laminated sheet.` : ''}`],
    ],
    'hsd-lead': [
      ['hl1', f => `Spare a thought for ${f.tl}: ${f.ls} points, a total that wins most weeks, and nothing to show for it because ${f.tw} chose the same afternoon to post ${f.ws}. Goals change games; timing changes seasons.`],
      ['hl2', f => `${f.ls} points and a defeat — robbed in broad daylight, in front of witnesses. ${f.tw}'s ${f.ws} takes the points; ${f.tl} take the moral high ground and nothing else.`],
    ],
    'sng-lead': [
      ['gl1', f => `A smash-and-grab at ${f.ground}: ${f.tw} were poor by their own standards and took all three points anyway, ${f.ws}–${f.ls}. Champagne football it was not. Champagne result.`],
      ['gl2', f => `${f.tw} won ugly — ${f.ws} plays ${f.ls}, well short of their season's par — and ${f.mgrW} will not care one bit. Winners write the match report. This is it.`],
    ],
    'title-lead': [
      ['tl1', f => `${f.tw} are top${f.stW.w >= 4 ? ` and ${f.stW.w} wins running` : ''} and starting to look inevitable: ${f.ws}–${f.ls} over ${f.tl}, professional as a tax return.`],
    ],
    'collapse-lead': [
      ['cl1', f => `Crisis club watch: ${f.tl} have now lost ${f.stL.l} on the spin after going down ${f.ws}–${f.ls} to ${f.tw}. ${f.gaffL ? `The board has given ${f.gaffL} its dreaded full backing.` : 'The board is understood to be monitoring the situation.'}`],
    ],
    'draw-lead': [
      ['nl1', f => `${f.ta} ${f.sa}, ${f.tb} ${f.sb}. A game of two halves, both of them cagey. Nobody enjoyed it, least of all the neutrals, of which this league contains none.`],
      ['nl2', f => `A ${f.sa}–${f.sb} draw at ${f.ground} — the kind of afternoon that has supporters checking the fixture list for something to look forward to.`],
    ],
    'shootout-lead': [
      ['ql1', f => `A ${f.sa}–${f.sb} draw that felt like a cup final: two big scores, one point each, and both dressing rooms claiming it felt like a defeat. Correctly.`],
    ],
    'std-report': [
      ['sr1', f => `${f.tw} ${f.verb} ${f.tl} ${f.ws}–${f.ls}${f.starW ? `, ${f.starW.p.name} the difference with ${f.starW.pts}` : ''}.`],
      ['sr2', f => `Routine for ${f.tw}, ${f.ws}–${f.ls}${f.starL ? `; in defeat ${f.starL.p.name}'s ${f.starL.pts} deserved better company` : ''}.`],
      ['sr3', f => `${f.tl} showed character, which is what the beaten say: ${f.tw} took it ${f.ws}–${f.ls}.`],
      ['sr4', f => `${f.tw} ${f.ws}, ${f.tl} ${f.ls}. Job done, nothing filmed for the montage.`],
    ],
    'closing': [
      ['cr1', () => 'The Committee reminds all twelve clubs that the deadline is the deadline. It has always been the deadline.'],
      ['cr2', () => 'The Committee notes rising standards of conduct in the group chat and expects the lapse to be temporary.'],
      ['cr3', () => 'The Committee has reviewed the week and, on balance, permits it.'],
      ['cr4', () => 'The Committee wishes the bottom four a speedy recovery and reminds them the Trough is open to all.'],
    ],
  };

  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) === 1 ? 1 : n % 10 === 2 ? 2 : n % 10 === 3 ? 3 : 0]);
  const VERBS = ['saw off', 'edged', 'beat', 'dispatched', 'got past', 'held off'];

  /* ---------- the cooldown ledger (derived, deviceless, deterministic) ---------- */

  function pickLine(bankKey, f, seed, used) {
    const bank = B[bankKey];
    const fresh = bank.filter(([id]) => !used.has(id));
    const pool = fresh.length ? fresh : bank; // bank exhausted → oldest wisdom returns
    const [id, fn] = pool[hash(seed) % pool.length];
    used.add(id);
    usedThisEdition.push(id);
    return fn(f);
  }
  let usedThisEdition = [];

  // replay editions (gw < target) to learn which line ids are inside the cooldown window
  function usedRecently(targetGw) {
    const settled = [];
    for (let i = 0; i < targetGw && i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') settled.push(i);
    const window = settled.slice(-COOLDOWN_EDITIONS);
    const used = new Set();
    for (const g of window) {
      const ids = editionLineIds(g);
      for (const id of ids) used.add(id);
    }
    return used;
  }
  const _idsCache = new Map();
  function editionLineIds(gw) {
    const key = `${gw}:${state.transfers.length}`;
    if (_idsCache.has(key)) return _idsCache.get(key);
    build(gw, new Set()); // replay with empty memory — ids are what matter
    const ids = [...usedThisEdition];
    _idsCache.set(key, ids);
    return ids;
  }

  /* ---------- fact assembly per match ---------- */

  function factsFor(a, b, gwIdx, table, posOf) {
    const sa = gwManagerPoints(a, gwIdx), sb = gwManagerPoints(b, gwIdx);
    const w = sa >= sb ? a : b, l = w === a ? b : a;
    const ws = Math.max(sa, sb), ls = Math.min(sa, sb);
    const posW = posOf[w], posL = posOf[l];
    const rivals = (typeof rivalsOf === 'function') ? (rivalsOf(a).includes(b) || rivalsOf(b).includes(a)) : false;
    const rev = reverseMeeting(a, b, gwIdx);
    const stW = streaks(w, gwIdx), stL = streaks(l, gwIdx);
    const cutBand = pos => pos >= 5 && pos <= 10; // both within sniffing distance of the dashed line
    const f = {
      a, b, sa, sb, w, l, ws, ls, margin: ws - ls,
      ta: teamName(a), tb: teamName(b), tw: teamName(w), tl: teamName(l),
      mgrW: managerName(w), mgrL: managerName(l),
      posW, posL, stW, stL,
      derby: rivals, revenge: rev && rev.winner === l ? rev : null, // last time, today's loser won
      benchL: benchWasteOf(l, gwIdx),
      avgW: seasonAvg(w, gwIdx), avgL: seasonAvg(l, gwIdx),
      cut: cutBand(posW) && cutBand(posL) && Math.abs(posW - posL) <= 3,
      ground: stadium(a),
      gaffW: gafferFor(w)?.t, gaffL: gafferFor(l)?.t,
      asstL: (typeof assistantFor === 'function') ? assistantFor(l)?.t : null,
      starW: topScorer(w, gwIdx), starL: topScorer(l, gwIdx),
      verb: VERBS[hash(`v${gwIdx}:${a}:${b}`) % VERBS.length],
    };
    f.kind = classify(f);
    f.weight = WEIGHT[f.kind] + Math.min(20, f.margin / 2) + (f.revenge ? 8 : 0);
    return f;
  }

  /* ---------- article shapes ---------- */

  function leadArticle(f, gwIdx, used) {
    const seed = `lead:${gwIdx}:${f.a}:${f.b}`;
    const bankKey = { derby: 'derby-lead', upset: 'upset-lead', rout: 'rout-lead', 'bottle-job': 'bottle-lead', 'six-pointer': 'sixp-lead', 'bench-disaster': 'bench-lead', 'high-scoring-defeat': 'hsd-lead', 'smash-and-grab': 'sng-lead', 'title-charge': 'title-lead', collapse: 'collapse-lead', stalemate: 'draw-lead', 'shootout-draw': 'shootout-lead' }[f.kind] || 'std-report';
    const open = pickLine(bankKey, f, seed, used);
    const paras = [esc(open)];
    // second paragraph: the star men, with provenance and grudges — facts only
    const bits = [];
    if (f.starW && f.starW.pts > 0) {
      const sh = shiftLine(f.starW.p.id, gwIdx);
      const prov = provenance(f.w, f.starW.p.id);
      const provTxt = prov?.kind === 'draft' ? `a round-${prov.round} pick doing top-of-the-board work`
        : prov?.kind === 'trough' ? 'plucked from the Trough for nothing'
        : prov?.kind === 'waiver' ? 'a waiver-wire signing'
        : prov?.kind === 'trade' ? 'landed in a trade' : '';
      const grudge = oldClubGrudge(f.starW.p.id, f.l, gwIdx) ? ` — and yes, against his old club, because football does this` : '';
      bits.push(`${f.starW.p.name} carried the winners with ${f.starW.pts}${sh ? ` (${sh})` : ''}${provTxt ? `, ${provTxt}` : ''}${grudge}.`);
    }
    if (f.revenge) bits.push(`Revenge, served at regulation temperature: ${f.tl} won the reverse fixture in GW${GAMEWEEKS[f.revenge.gw].n}.`);
    if (f.stW.w >= 3) bits.push(`That's ${f.stW.w} wins on the bounce for ${f.tw}.`);
    if (f.stL.winless >= 4) bits.push(`${f.tl} remain winless in ${f.stL.winless} — the beach beckons and it is August.`);
    if (bits.length) paras.push(esc(bits.join(' ')));
    return `<div class="prog-story"><div class="prog-head">${esc(f.tw)} ${f.ws} &nbsp;${esc(f.tl)} ${f.ls}</div><div class="prog-by">From our man at ${esc(f.ground)}</div>${paras.map(p => `<p>${p}</p>`).join('')}</div>`;
  }

  function report(f, gwIdx, used) {
    const seed = `rep:${gwIdx}:${f.a}:${f.b}`;
    if (f.sa === f.sb) {
      const open = pickLine(f.sa >= 55 ? 'shootout-lead' : 'draw-lead', f, seed, used);
      return `<div class="prog-story"><div class="prog-head">${esc(f.ta)} ${f.sa} &nbsp;${esc(f.tb)} ${f.sb}</div><p>${esc(open)}</p></div>`;
    }
    const open = pickLine('std-report', f, seed, used);
    const extra = f.stL.l >= 3 ? ` ${esc(`${f.tl} have now lost ${f.stL.l} straight.`)}` : '';
    return `<div class="prog-story"><div class="prog-head">${esc(f.tw)} ${f.ws} &nbsp;${esc(f.tl)} ${f.ls}</div><p>${esc(open)}${extra}</p></div>`;
  }

  function nib(f) {
    return `<div class="lrow" style="font-size:12.5px"><b>${esc(f.tw)} ${f.ws}–${f.ls} ${esc(f.tl)}</b>${f.starW && f.starW.pts > 0 ? ` <span class="muted">— ${esc(f.starW.p.name)} ${f.starW.pts}</span>` : ''}</div>`;
  }

  /* ---------- departments (conditional; only when the facts support them) ---------- */

  function departments(gwIdx, allFacts, used) {
    const out = [];
    // The Trough Watch — a recent pickup that actually scored this week
    const pickups = state.transfers.filter(t => !t.trade && !t.windowDraft && t.gw <= gwIdx && gwIdx - t.gw <= 2)
      .map(t => ({ t, pts: gwPlayerPoints(t.inId, gwIdx), p: PLAYER_BY_ID[t.inId] }))
      .filter(x => x.p && x.pts >= 6).sort((x, y) => y.pts - x.pts);
    if (pickups.length) {
      const x = pickups[0];
      out.push(`<div class="prog-sec">The Trough Watch</div><p>${esc(`${x.p.name} — ${x.t.waiver ? 'claimed off waivers' : 'signed from the Trough'} by ${teamName(x.t.managerId)} — returned ${x.pts} this week. The market sees everything, eventually.`)}</p>`);
    }
    // Tactical Negligence — the week's worst bench, if it's actually bad
    const worstBench = state.managers.map(m => ({ mid: m.id, w: benchWasteOf(m.id, gwIdx) })).sort((a, b) => b.w - a.w)[0];
    if (worstBench && worstBench.w >= 10) {
      const run = benchLeaderStreak(worstBench.mid, gwIdx);
      out.push(`<div class="prog-sec">Tactical Negligence</div><p>${esc(`${teamName(worstBench.mid)} left ${worstBench.w} points on the bench${run >= 2 ? ` — the ${ord(run)} week running they have led this table, which is now a table` : ''}. The bench order is a queue, not a punishment.`)}</p>`);
    }
    // Assistant Manager's Notebook — the lead story's beaten No. 2 speaks
    const lead = allFacts[0];
    if (lead && typeof assistantFor === 'function') {
      const asst = assistantFor(lead.l);
      if (asst) out.push(`<div class="prog-sec">Assistant Manager&rsquo;s Notebook</div><p>${esc(`${asst.t} (${teamName(lead.l)}): "We go again. The gaffer has asked me to say that we go again."`)}</p>`);
    }
    // The Treatment Table — owned players the feed flags, worst first
    const flagged = [];
    for (const m of state.managers) for (const p of squadAt(m.id, gwIdx)) if (p.status && p.status !== 'a' && flagged.length < 3 && !flagged.some(x => x.p.id === p.id)) flagged.push({ p, mid: m.id });
    if (flagged.length) {
      out.push(`<div class="prog-sec">The Treatment Table</div><p>${flagged.map(x => `${pname(x.p)} <span class="muted">(${esc(teamName(x.mid))}${x.p.news ? ` — ${esc(x.p.news)}` : ''})</span>`).join('; ')}</p>`);
    }
    // Corrections & Clarifications — an upset means somebody's form book lied
    const up = allFacts.find(f => f.kind === 'upset' || f.kind === 'bottle-job');
    if (up) {
      out.push(`<div class="prog-sec">Corrections &amp; Clarifications</div><p class="muted" style="font-size:12px">${esc(`In previous editions the Gazette may have described ${teamName(up.l)} as "in control of their own destiny". The Gazette regrets the error.`)}</p>`);
    }
    // For the Record — marks set, broken or tied at THIS edition
    if (typeof seasonRecordsNow === 'function') {
      const settled = [];
      for (let i = 0; i <= gwIdx && i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') settled.push(i);
      if (settled.length) {
        const prev = settled.length > 1 ? seasonRecordsNow(settled.at(-2)) : [];
        const marks = recordStatus(seasonRecordsNow(gwIdx), prev, gwIdx).filter(r => r.status);
        if (marks.length) {
          out.push(`<div class="prog-sec">For the Record</div><p>${marks.slice(0, 3).map(r => esc(`${r.label.toLowerCase()}: ${r.holders.map(h => h.mid != null ? teamName(h.mid) : PLAYER_BY_ID[h.pid]?.name || '?').join(' & ')}, ${r.fmt(r.value)} — a mark ${r.status === 'tied' ? 'equalled' : 'set'} this week`)).join('; ')}.</p>`);
        }
      }
    }
    // Transfer Report Cards — moves whose 3-GW review window closed this week
    if (typeof transferWindowFacts === 'function') {
      const due = state.transfers.filter(t => (!t.trade || tradeBatchOf(t)[0] === t)).map(t => {
        const wf = transferWindowFacts(t, 3);
        return wf && wf.gws.at(-1) === gwIdx ? { t, wf } : null;
      }).filter(Boolean).sort((a, b) => Math.abs(b.wf.diff) - Math.abs(a.wf.diff)).slice(0, 2);
      for (const { t, wf } of due) {
        out.push(`<div class="prog-sec">Transfer Report Card</div><p>${esc(`Three gameweeks on: ${teamName(t.managerId)}'s ${wf.inn.map(x => x.p.name).join(' + ')} deal reads ${wf.inPts} in, ${wf.outPts} shipped — ${transferVerdict(wf, 3)}.`)}</p>`);
      }
    }
    // The Committee's Closing Remark — always
    out.push(`<div class="prog-sec">The Committee&rsquo;s Closing Remark</div><p class="muted" style="font-size:12px">${esc(pickLine('closing', {}, `close:${gwIdx}`, used))}</p>`);
    return out.join('');
  }

  /* ---------- the edition ---------- */

  function build(gwIdx, used) {
    usedThisEdition = [];
    const table = h2hStandings();
    const posOf = Object.fromEntries(table.map((r, k) => [r.id, k]));
    const facts = pairingsFor(gwIdx).map(([a, b]) => factsFor(a, b, gwIdx, table, posOf))
      .sort((x, y) => y.weight - x.weight);
    if (!facts.length) return '';
    const lead = leadArticle(facts[0], gwIdx, used);
    const second = facts.slice(1, 3).map(f => report(f, gwIdx, used)).join('');
    const nibs = facts.slice(3);
    const nibBlock = nibs.length ? `<div class="prog-sec">Around the grounds, briefly</div>${nibs.map(nib).join('')}` : '';
    // the table stakes line — movement across the dashed line this week
    const crossers = facts.filter(f => (posOf[f.w] <= 7 && posOf[f.l] === 8) || posOf[f.l] === 7);
    const stakes = crossers.length && table.some(r => r.p > 0)
      ? `<div class="prog-sec">The state of the table</div><p>${esc(`${teamName(table[0].id)} lead. The dashed line currently cuts between ${teamName(table[7].id)} and ${teamName(table[8].id)}, and it is not sentimental.`)}</p>` : '';
    return `<div class="prog-art">
      <div class="prog-cols">${lead}${second}</div>
      ${nibBlock}
      ${stakes}
      ${departments(gwIdx, facts, used)}
    </div>`;
  }

  function review(gwIdx) {
    try {
      const used = usedRecently(gwIdx);
      return build(gwIdx, used);
    } catch (e) {
      return ''; // the paper never takes the site down; app.js falls back
    }
  }

  return { review, _classify: classify, _facts: factsFor, _editionLineIds: editionLineIds };
})();
