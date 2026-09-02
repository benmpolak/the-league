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
  // bylines from the bootleg press corps (js/lore.js). Deterministic by hash,
  // never the shared RNG — every phone must print the same masthead.
  const press = (beats, key) => {
    const roster = typeof GAZETTE_PRESS !== 'undefined' ? GAZETTE_PRESS : [];
    const pool = roster.filter(p => beats.includes(p.beat));
    const use = pool.length ? pool : (roster.length ? roster : [{ n: 'the Gazette football desk' }]);
    return use[hash(key) % use.length];
  };

  /* ---------- fact desk (public state only) ---------- */

  function seasonAvg(mid, uptoGw) {
    let t = 0, n = 0;
    for (let i = 0; i < uptoGw; i++) if (gwStatus(i) === 'final') { t += gwManagerPoints(mid, i); n++; }
    return n ? t / n : null;
  }
  function streaks(mid, uptoGw) {
    let w = 0, l = 0, unbeaten = 0, winless = 0;
    let countW = true, countL = true, countUnbeaten = true, countWinless = true;
    for (let i = uptoGw; i >= 0; i--) {
      if (gwStatus(i) !== 'final') continue;
      const pr = pairingsFor(i).find(x => x.includes(mid));
      if (!pr) continue;
      const op = pr[0] === mid ? pr[1] : pr[0];
      const a = gwManagerPoints(mid, i), b = gwManagerPoints(op, i);
      const res = a > b ? 'W' : a < b ? 'L' : 'D';
      if (countW && res === 'W') w++; else countW = false;
      if (countL && res === 'L') l++; else countL = false;
      if (countUnbeaten && res !== 'L') unbeaten++; else countUnbeaten = false;
      if (countWinless && res !== 'W') winless++; else countWinless = false;
      if (!countW && !countL && !countUnbeaten && !countWinless) break;
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
  function provenance(mid, pid, uptoGw = REGULAR_GWS) {
    const pk = (state.draft.picks || []).find(x => x.managerId === mid && x.playerId === pid);
    if (pk && pk.n) return { kind: 'draft', round: Math.ceil(pk.n / state.managers.length), n: pk.n };
    const tr = [...state.transfers].reverse().find(t => t.managerId === mid && t.inId === pid && t.gw <= uptoGw);
    if (!tr) return null;
    return { kind: tr.trade ? 'trade' : tr.windowDraft ? 'window' : tr.waiver ? 'waiver' : 'trough' };
  }
  function provenanceLabel(prov, compact = false) {
    if (!prov) return compact ? 'SOURCE UNKNOWN' : '';
    if (prov.kind === 'draft') return compact ? `DRAFT R${prov.round} · PICK ${prov.n}` : `drafted in round ${prov.round} (No. ${prov.n} overall)`;
    if (prov.kind === 'trough') return compact ? 'TROUGH SIGNING' : 'plucked from the Trough for nothing';
    if (prov.kind === 'waiver') return compact ? 'ON WAIVERS' : 'taken on waivers';
    if (prov.kind === 'trade') return compact ? 'TRADE ARRIVAL' : 'landed in a trade';
    if (prov.kind === 'window') return compact ? 'WINDOW DRAFT' : 'taken in the Window Draft';
    return compact ? 'SOURCE UNKNOWN' : '';
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
    for (const pid of effectiveXI(mid, gwIdx).xi) {
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
    if (f.posL <= 2 && f.posW >= 9) return 'bottle-job';               // top side beaten by the basement
    if (f.posW - f.posL >= 5 && f.posW >= 7) return 'upset';           // lower-placed side wins big table gap
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
    'derby-head': [
      ['dh1', f => `BRAGGING RIGHTS: ${f.tw}`],
      ['dh2', f => `PERSONAL. LOUD. ${f.tw}.`],
      ['dh3', f => `${f.tw} WIN THE ONE THAT MATTERS`],
    ],
    'upset-head': [
      ['uh1', () => 'FORM BOOK? WHAT FORM BOOK?'],
      ['uh2', f => `${f.tw} TEAR UP THE SCRIPT`],
      ['uh3', () => 'NOBODY SAW THAT COMING'],
    ],
    'rout-head': [
      ['rh1', f => `${f.tw} RUN RIOT`],
      ['rh2', f => `${f.margin} POINTS OF PAIN`],
      ['rh3', f => `NO CONTEST AT ${f.ground}`],
    ],
    'bottle-head': [
      ['bh1', () => 'BOTTLED IT'],
      ['bh2', f => `${f.tl} LOSE THE PLOT`],
      ['bh3', () => 'TOP DOGS FALL APART'],
    ],
    'sixp-head': [
      ['sh1', () => 'PLAYOFF PANIC'],
      ['sh2', () => 'ABOVE THE LINE, BELOW THE BELT'],
      ['sh3', f => `${f.tw} WIN THE SIX-POINTER`],
    ],
    'bench-head': [
      ['xh1', () => 'BEATEN BY THEIR OWN BENCH'],
      ['xh2', f => `${f.benchL} POINTS LEFT TO ROT`],
      ['xh3', () => 'PICKED THE WRONG XI. PAID THE PRICE.'],
    ],
    'hsd-head': [
      ['hh1', () => 'ROBBED IN BROAD DAYLIGHT'],
      ['hh2', f => `${f.ls} POINTS. NO REWARD.`],
      ['hh3', () => 'RIGHT SCORE, WRONG WEEK'],
    ],
    'sng-head': [
      ['gh1', () => 'HOW DID THEY GET AWAY WITH THAT?'],
      ['gh2', () => 'WIN UGLY, GO HOME HAPPY'],
      ['gh3', f => `${f.tw} STEAL THE POINTS`],
    ],
    'title-head': [
      ['th1', f => `${f.tw} MARCH ON`],
      ['th2', () => 'CATCH THEM IF YOU CAN'],
      ['th3', () => 'TOP. AGAIN.'],
    ],
    'collapse-head': [
      ['ch1', () => 'FULL BACKING KLAXON'],
      ['ch2', () => 'CRISIS? WHAT CRISIS?'],
      ['ch3', f => `${f.tl} IN FREEFALL`],
    ],
    'draw-head': [
      ['nh1', () => 'A POINT EACH. JOY FOR NOBODY.'],
      ['nh2', f => `STALEMATE AT ${f.ground}`],
      ['nh3', () => 'ALL SQUARE, ALL GRUMPY'],
    ],
    'shootout-head': [
      ['qh1', () => 'THE SHOOTOUT NOBODY WON'],
      ['qh2', f => `${f.sa}–${f.sb}: BREATHLESS, POINTLESS`],
      ['qh3', () => 'BIG SCORES, SMALL REWARD'],
    ],
    'standard-head': [
      ['zh1', f => `${f.tw} GET THE JOB DONE`],
      ['zh2', () => 'NO DRAMA. THREE POINTS.'],
      ['zh3', f => `${f.tw} TAKE CARE OF BUSINESS`],
    ],
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
      ['cl2', f => `${f.stL.l} defeats in a row for ${f.tl}, the latest a ${f.ws}–${f.ls} loss to ${f.tw}. A CLUB STATEMENT is understood to be in preparation: the board, the gaffer and the group chat have been informed, in that order.`],
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
      ['sr5', f => `${f.tw} found a way; ${f.tl} found several reasons. ${f.ws}–${f.ls}, all three points, no public inquiry yet.`],
      ['sr6', f => `${f.tw} wanted it more, according to people who cannot explain what that means. ${f.ws}–${f.ls}.`],
      ['sr7', f => `${f.tw} take the points and ${f.tl} take the positives, presumably home in a carrier bag. ${f.ws}–${f.ls}.`],
      ['sr8', f => `A result for the purists, if the purists support ${f.tw}: ${f.ws}–${f.ls} over ${f.tl}.`],
    ],
    'closing': [
      ['cr1', () => 'The Committee reminds all twelve clubs that the deadline is the deadline. It has always been the deadline.'],
      ['cr2', () => 'The Committee notes rising standards of conduct in the group chat and expects the lapse to be temporary.'],
      ['cr3', () => 'The Committee has reviewed the week and, on balance, permits it.'],
      ['cr4', () => 'The Committee wishes the bottom four a speedy recovery and reminds them the Trough is open to all.'],
      ['cr5', () => 'It is a marathon, not a sprint, except for the managers currently winning, who reject the premise.'],
      ['cr6', () => 'There are no easy games at this level. There are, however, several easy managers.'],
      ['cr7', () => 'The table never lies, although it has retained excellent lawyers.'],
      ['cr8', () => 'Form is temporary. Screenshots in the group chat are permanent.'],
      /* the archive lines (Ben, 10 Aug: "100% sprinkle in all of the bits") —
         AOE, -gate, filth, dip, sons: eleven years of group-chat canon */
      ['cr9', () => 'The Committee continues to monitor the Axis of Evil, which continues to deny existing.'],
      ['cr10', () => 'The Committee thanks all clubs for their concern for the integrity of the league, expressed exclusively after defeats.'],
      ['cr11', () => 'The Gazette has a name ready for the next scandal. It ends in -gate. It always ends in -gate.'],
      ['cr12', () => 'The Committee confirms dip will be provided on draft night. The events of 2017 must never be repeated.'],
      ['cr13', () => 'Filth remains available in the Trough for any club bold enough to go wheeling and/or dealing.'],
      ['cr14', () => 'That is the paper. Goodnight, sons.'],
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
  function editionLineIds(gw) {
    build(gw, new Set()); // replay with empty memory — ids are what matter
    return [...usedThisEdition];
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
      gw: gwIdx, a, b, sa, sb, w, l, ws, ls, margin: ws - ls,
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

  const STORY_BANK = {
    derby: 'derby-lead', upset: 'upset-lead', rout: 'rout-lead', 'bottle-job': 'bottle-lead',
    'six-pointer': 'sixp-lead', 'bench-disaster': 'bench-lead', 'high-scoring-defeat': 'hsd-lead',
    'smash-and-grab': 'sng-lead', 'title-charge': 'title-lead', collapse: 'collapse-lead',
    stalemate: 'draw-lead', 'shootout-draw': 'shootout-lead',
  };
  const HEAD_BANK = {
    derby: 'derby-head', upset: 'upset-head', rout: 'rout-head', 'bottle-job': 'bottle-head',
    'six-pointer': 'sixp-head', 'bench-disaster': 'bench-head', 'high-scoring-defeat': 'hsd-head',
    'smash-and-grab': 'sng-head', 'title-charge': 'title-head', collapse: 'collapse-head',
    stalemate: 'draw-head', 'shootout-draw': 'shootout-head',
  };
  const STORY_LABEL = {
    derby: 'THE GRUDGE MATCH', upset: 'SHOCK OF THE WEEK', rout: 'THE BIG STORY',
    'bottle-job': 'BOTTLE WATCH', 'six-pointer': 'PLAYOFF RACE', 'bench-disaster': 'TACTICAL INQUEST',
    'high-scoring-defeat': 'HARD-LUCK STORY', 'smash-and-grab': 'THE GREAT ESCAPE',
    'title-charge': 'TITLE WATCH', collapse: 'CRISIS CLUB', stalemate: 'THE DRAW',
    'shootout-draw': 'GAME OF THE WEEK', standard: 'MATCH OF THE WEEK', 'mid-table-scrap': 'MID-TABLE THEATRE',
  };

  // The surviving Draft Fantasy archive gives the paper an actual memory.
  // Match current managers by name, then print only facts recovered from it.
  function groupChatFile(f) {
    if (typeof CHAT_ARCHIVE === 'undefined' || !CHAT_ARCHIVE.length) return '';
    // A callback should feel discovered, not compulsory: roughly one edition
    // in four opens the group-chat drawer.
    if (hash(`chat-gate:${f.gw}`) % 4 !== 0) return '';
    const exact = CHAT_ARCHIVE.filter(x => x.mids.length > 1 && x.mids.includes(f.a) && x.mids.includes(f.b));
    const candidates = exact.length ? exact : CHAT_ARCHIVE.filter(x => x.mids.includes(f.a) || x.mids.includes(f.b));
    if (!candidates.length) return '';
    const file = candidates[hash(`chat:${f.gw}:${f.a}:${f.b}`) % candidates.length];
    return `The group chat archive, ${file.year}: ${file.line}`;
  }
  function oldFiles(f) {
    const chat = groupChatFile(f);
    if (typeof LEAGUE_HISTORY === 'undefined' || !LEAGUE_HISTORY.length) return chat;
    const S = LEAGUE_HISTORY.at(-1);
    const ia = S.managers.findIndex(m => m.name === managerName(f.a));
    const ib = S.managers.findIndex(m => m.name === managerName(f.b));
    if (ia < 0 || ib < 0) return chat;
    let aw = 0, bw = 0, d = 0, latest = null;
    for (const m of S.matches) {
      const [, h, a, hs, as] = m;
      if (!((h === ia && a === ib) || (h === ib && a === ia))) continue;
      const aScore = h === ia ? hs : as, bScore = h === ib ? hs : as;
      if (aScore > bScore) aw++; else if (bScore > aScore) bw++; else d++;
      latest = { gw: m[0], aScore, bScore };
    }
    if (!latest) return chat;
    const champ = S.honours?.champion?.name;
    const crown = champ === managerName(f.a) ? `${managerName(f.a)} arrived as the reigning champion. `
      : champ === managerName(f.b) ? `${managerName(f.b)} arrived as the reigning champion. ` : '';
    const ledger = aw === bw
      ? `Last season's ledger finished level: ${aw} win${aw === 1 ? '' : 's'} each${d ? ` and ${d} draw${d === 1 ? '' : 's'}` : ''}.`
      : `${managerName(aw > bw ? f.a : f.b)} held last season's edge, ${Math.max(aw, bw)} win${Math.max(aw, bw) === 1 ? '' : 's'} to ${Math.min(aw, bw)}${d ? `, with ${d} draw${d === 1 ? '' : 's'}` : ''}.`;
    return `${crown}${ledger} Their last meeting ended ${latest.aScore}–${latest.bScore} in GW${latest.gw}. Old files, fresh ammunition.${chat ? ` ${chat}` : ''}`;
  }

  function dressingRoomQuote(f, gwIdx) {
    if (f.kind === 'bench-disaster') return `"We picked the right squad. Regrettably, several of them were sitting down."`;
    if (f.kind === 'rout') return `"The scoreline flattered them. It did not flatter us, which is the immediate concern."`;
    if (f.kind === 'bottle-job' || f.kind === 'collapse') return `"The gaffer has the full backing of everybody who has not yet checked the table."`;
    if (f.kind === 'high-scoring-defeat') return `"On another week that wins. Unfortunately the fixture was played on this one."`;
    const q = [
      `"We trained well, prepared well and then encountered the match itself."`,
      `"There were positives. The analyst is looking for them now."`,
      `"Fine margins. Very wide, extremely visible fine margins."`,
      `"We go again, mainly because the rules require another fixture."`,
      `"The result does not tell the whole story. We would prefer it told less of it."`,
    ];
    return q[hash(`quote:${gwIdx}:${f.a}:${f.b}`) % q.length];
  }

  // Footballese, used knowingly: the comedy is in treating the game's odd
  // dialect as a precise technical language. Gates stop a phrase claiming a
  // fact the score does not support.
  const FOOTBALLESE = [
    ['fe1', f => f.margin <= 5, () => 'Fine margins decided it — the traditional unit of measurement for something large enough to hurt and small enough to blame.'],
    ['fe2', f => f.margin >= 20, f => `By the business end, ${f.tw} were seeing the game out and ${f.tl} were seeing if it could end sooner.`],
    ['fe3', f => f.benchL >= 10, f => `${f.mgrL} had a selection headache and, with admirable commitment, selected the headache.`],
    ['fe4', f => f.starW?.pts >= 10, f => `${f.starW.p.name} was at the heart of everything, the exact location traditionally occupied by the player with the most points.`],
    ['fe5', f => f.cut, () => 'Questions were asked of both sides’ playoff credentials. One set of answers has been marked more generously.'],
    ['fe6', () => true, f => `${f.tw} did the basics right, an achievement football usually identifies only after somebody wins.`],
    ['fe7', () => true, f => `Game management entered the conversation shortly before ${f.tw} made the result look inevitable.`],
    ['fe8', () => true, f => `${f.tw} wanted it more — not measurable, not falsifiable, and therefore perfect for the post-match analysis.`],
    ['fe9', () => true, () => 'On paper it looked straightforward. Football keeps paper around mainly to make a fool of it.'],
  ];
  function footballese(f, gwIdx, used) {
    const eligible = FOOTBALLESE.filter(([id, gate]) => gate(f) && !used.has(id));
    const pool = eligible.length ? eligible : FOOTBALLESE.filter(([, gate]) => gate(f));
    const [id, , line] = pool[hash(`footballese:${gwIdx}:${f.a}:${f.b}`) % pool.length];
    used.add(id); usedThisEdition.push(id);
    return line(f);
  }

  function leadArticle(f, gwIdx, used) {
    const seed = `lead:${gwIdx}:${f.a}:${f.b}`;
    const bankKey = STORY_BANK[f.kind] || 'std-report';
    const head = pickLine(HEAD_BANK[f.kind] || 'standard-head', f, `${seed}:head`, used);
    const open = pickLine(bankKey, f, seed, used);
    const paras = [esc(open)];
    // second paragraph: the star men, with provenance and grudges — facts only
    const bits = [];
    if (f.starW && f.starW.pts > 0) {
      const sh = shiftLine(f.starW.p.id, gwIdx);
      const prov = provenance(f.w, f.starW.p.id, gwIdx);
      const provTxt = provenanceLabel(prov);
      const grudge = oldClubGrudge(f.starW.p.id, f.l, gwIdx) ? ` — and yes, against his old club, because football does this` : '';
      bits.push(`${f.starW.p.name} carried the winners with ${f.starW.pts}${sh ? ` (${sh})` : ''}${provTxt ? `, ${provTxt}` : ''}${grudge}.`);
    }
    if (f.revenge) bits.push(`Revenge, served at regulation temperature: ${f.tl} won the reverse fixture in GW${GAMEWEEKS[f.revenge.gw].n}.`);
    if (f.stW.w >= 3) bits.push(`That's ${f.stW.w} wins on the bounce for ${f.tw}.`);
    if (f.stL.winless >= 4) bits.push(`${f.tl} remain winless in ${f.stL.winless} — the beach beckons and it is August.`);
    if (bits.length) paras.push(esc(bits.join(' ')));
    paras.push(esc(footballese(f, gwIdx, used)));
    return `<div class="prog-story prog-lead-story">
      <div class="prog-story-kicker">${esc(STORY_LABEL[f.kind] || STORY_LABEL.standard)}</div>
      <div class="prog-head">${esc(head)}</div>
      <div class="prog-scoreline">${esc(f.tw)} ${f.ws} &nbsp; ${esc(f.tl)} ${f.ls}</div>
      <div class="prog-by">By ${esc(press(['match'], `lead:${gwIdx}:${f.a}:${f.b}`).n)}, at ${esc(f.ground)}</div>${paras.map(p => `<p>${p}</p>`).join('')}</div>`;
  }

  function report(f, gwIdx, used) {
    const seed = `rep:${gwIdx}:${f.a}:${f.b}`;
    if (f.sa === f.sb) {
      const open = pickLine(f.sa >= 55 ? 'shootout-lead' : 'draw-lead', f, seed, used);
      const star = !f.starW || (f.starL && f.starL.pts > f.starW.pts) ? f.starL : f.starW;
      const owner = star === f.starW ? f.w : f.l;
      const source = star ? provenanceLabel(provenance(owner, star.p.id, gwIdx)) : '';
      const detail = star && star.pts > 0 ? `${star.p.name} led the cast with ${star.pts}${source ? `, ${source}` : ''}.` : '';
      return `<div class="prog-story"><div class="prog-head">${esc(f.ta)} ${f.sa} &nbsp;${esc(f.tb)} ${f.sb}</div><p>${esc(open)}</p>${detail ? `<p class="prog-match-detail">${esc(detail)}</p>` : ''}<div class="prog-by">${esc(press(['match', 'colour'], `rep:${gwIdx}:${f.a}:${f.b}`).n)}</div></div>`;
    }
    const open = pickLine(STORY_BANK[f.kind] || 'std-report', f, seed, used);
    const details = [];
    if (f.starW && f.starW.pts > 0) {
      const source = provenanceLabel(provenance(f.w, f.starW.p.id, gwIdx));
      const shift = shiftLine(f.starW.p.id, gwIdx);
      details.push(`${f.starW.p.name} supplied ${f.starW.pts}${shift ? ` — ${shift}` : ''}${source ? `; ${source}` : ''}.`);
    }
    if (f.benchL > 0) details.push(`${f.tl} left ${f.benchL} attainable point${f.benchL === 1 ? '' : 's'} outside the final XI.`);
    if (f.stL.l >= 3) details.push(`${f.tl} have now lost ${f.stL.l} straight.`);
    return `<div class="prog-story"><div class="prog-head">${esc(f.tw)} ${f.ws} &nbsp;${esc(f.tl)} ${f.ls}</div><p>${esc(open)}</p>${details.length ? `<p class="prog-match-detail">${esc(details.join(' '))}</p>` : ''}<div class="prog-by">${esc(press(['match', 'colour'], `rep:${gwIdx}:${f.a}:${f.b}`).n)}</div></div>`;
  }

  function nib(f, gwIdx) {
    const tails = f.margin >= 18 ? ['No need for the highlights.', 'A long way home for the beaten.', 'Comfortable is doing some work.']
      : ['Job done; points banked.', 'Fine margins, loud consequences.', 'The sort of result managers call professional.'];
    const tail = tails[hash(`nib:${gwIdx}:${f.a}:${f.b}`) % tails.length];
    const source = f.starW ? provenanceLabel(provenance(f.w, f.starW.p.id, gwIdx), true) : '';
    return `<div class="prog-nib"><b>${esc(f.tw)} ${f.ws}–${f.ls} ${esc(f.tl)}</b><span>${f.starW && f.starW.pts > 0 ? `${esc(f.starW.p.name)} ${f.starW.pts}${source ? ` · ${esc(source)}` : ''}. ` : ''}${esc(tail)}</span></div>`;
  }

  /* ---------- departments (conditional; only when the facts support them) ---------- */

  function departments(gwIdx, allFacts, used) {
    const out = [];
    const lead = allFacts[0];

    // Back-page awards — every edition needs verdicts, not six score recaps.
    if (typeof weeklyAwards === 'function') {
      const aw = weeklyAwards(gwIdx);
      const cards = [];
      if (aw.hi) cards.push({ k: 'TEAM OF THE WEEK', v: teamName(aw.hi.id), d: `${aw.hi.s} points. Champagne football, or at least champagne arithmetic.` });
      if (aw.lo) cards.push({ k: 'WOODEN SPOON', v: teamName(aw.lo.id), d: `${aw.lo.s} points. One for the mantelpiece, preferably face-down.` });
      if (aw.jammy) cards.push({ k: 'GOT AWAY WITH IT', v: teamName(aw.jammy.w), d: `Won with ${aw.jammy.ws}. Do not ask how; do ask how often.` });
      if (aw.robbed) cards.push({ k: 'ROBBED', v: teamName(aw.robbed.l), d: `${aw.robbed.ls} points and nothing. Contact the authorities.` });
      // Marc's charge-sheet award closes the page (Ben, 10 Aug: "in the
      // gazette too") — the citation is the story, so it gets the d-slot
      if (aw.cotw) cards.push({ k: 'C*** OF THE WEEK', v: teamName(aw.cotw.id), d: `${aw.cotw.why[0].toUpperCase()}${aw.cotw.why.slice(1)}.${aw.cotw.proven ? '' : ' (A quiet week; the Committee drew lots.)'} No appeal.` });
      if (cards.length) out.push(`<div class="prog-sec">The Back Page Awards</div><div class="prog-awards">${cards.slice(0, 5).map(c => `<div class="prog-award"><span>${esc(c.k)}</span><b>${esc(c.v)}</b><p>${esc(c.d)}</p></div>`).join('')}</div>`);
    }

    // Every manager's consequential team-sheet calls, not merely the winner's
    // score. STARTED is the submitted XI; BENCHED excludes anyone rescued by
    // an auto-sub, so these really are points that stayed unused.
    const sheetRows = state.managers.map(m => {
      const selected = lineupFor(m.id, gwIdx).map(pid => ({ p: PLAYER_BY_ID[pid], pts: gwPlayerPoints(pid, gwIdx) })).filter(x => x.p)
        .sort((a, b) => b.pts - a.pts).slice(0, 2);
      const finalIds = new Set(effectiveXI(m.id, gwIdx).xi);
      const unused = squadAt(m.id, gwIdx).filter(p => !finalIds.has(p.id)).map(p => ({ p, pts: gwPlayerPoints(p.id, gwIdx) }))
        .sort((a, b) => b.pts - a.pts)[0];
      const waste = benchWasteOf(m.id, gwIdx);
      return `<div class="prog-sheet-row">
        <b>${esc(teamName(m.id))}</b>
        <span><em>STARTED</em> ${selected.map(x => `${esc(x.p.name)} ${x.pts}`).join(' &middot; ') || 'No returns'}</span>
        <span class="${unused?.pts > 0 ? 'prog-bench-hit' : ''}"><em>BENCHED</em> ${unused ? `${esc(unused.p.name)} ${unused.pts}` : 'Nobody'}${waste ? ` &middot; ${waste} point${waste === 1 ? '' : 's'} left` : ' &middot; nothing left unused'}</span>
      </div>`;
    });
    // Marc, 24 Aug 2026: "what does 4 points left mean?" — fair, since it sits
    // beside a benched man's score and is deliberately NOT that number. Say so
    // in the deck rather than leaving twelve managers to work it out.
    out.push(`<div class="prog-sec">The Team-Sheet Audit</div><p class="prog-deck">STARTED is the best of what each manager picked; BENCHED is the best man who never made the final eleven. The points left are the gap to the finest legal eleven that squad could have fielded &mdash; not the benched man's score, because bringing him in means leaving somebody else out. Nothing is charged for a player an auto-sub rescued: those points were collected.</p><div class="prog-team-sheet">${sheetRows.join('')}</div>`);

    // The week's best performers, with the receipt attached: draft round and
    // exact pick, or the route by which the player entered the squad.
    const performers = [];
    for (const m of state.managers) for (const pid of effectiveXI(m.id, gwIdx).xi) {
      const p = PLAYER_BY_ID[pid];
      if (p) performers.push({ mid: m.id, p, pts: gwPlayerPoints(pid, gwIdx), source: provenance(m.id, pid, gwIdx) });
    }
    performers.sort((a, b) => b.pts - a.pts || a.p.name.localeCompare(b.p.name));
    const receipts = performers.slice(0, 6).map(x => `<div class="prog-receipt">
      <strong>${esc(x.p.name)} <span>${x.pts}</span></strong>
      <b>${esc(teamName(x.mid))}</b>
      <small>${esc(provenanceLabel(x.source, true))}</small>
    </div>`).join('');
    if (receipts) out.push(`<div class="prog-sec">Draft Receipts</div><p class="prog-deck">The leading returns, traced back to the decision that put them there.</p><div class="prog-draft-receipts">${receipts}</div>`);

    // The archive turns fixtures into grudges from GW1, before current-season
    // form has had time to become a story of its own.
    const lore = lead ? oldFiles(lead) : '';
    if (lore) out.push(`<div class="prog-sec">From the Old Files</div><p>${esc(lore)}</p>`);

    // GW1 special: the conversion of the sceptics (Ben, GW1 night — "ric
    // blank who very nearly left the League" and "Iain who doesnt believe
    // in AI" both go in the paper). One edition only; the archive keeps it.
    if (gwIdx === 0) {
      const ric = (state.managers || []).find(x => /blank/i.test(managerName(x.id)));
      const ian = (state.managers || []).find(x => /tussie/i.test(managerName(x.id)));
      if (ric || ian) {
        out.push(`<div class="prog-story">
          <div class="prog-head">THE CONVERTS: SCEPTICS CLAIM CREDIT AS NEW ERA LANDS</div>
          ${ric ? `<p>${esc(`Remarkable scenes in the boardroom, where Ric Blank — a man who came within one strongly-worded message of leaving The League altogether this summer — has spent the opening weekend telling anyone who will listen that "we've built a new game using AI", and that he is "very happy to take credit for it". Sources describe the U-turn as "shameless" and "completely in character". The Committee has noted the word "we".`)}</p>` : ''}
          ${ian ? `<p>${esc(`Meanwhile Ian Tussie, the league's most decorated non-believer in artificial intelligence — on record that the machines will never take a football man's job — was seen refreshing the Gazette twice before breakfast and declaring himself "excited for the Sunday splash". The Gazette, which is written by the machines, thanks him for his readership.`)}</p>` : ''}
          <div class="prog-by">Henry Wanton, boardroom desk</div>
        </div>`);
      }
    }

    // Completed business only. Blind claims remain private; the paper judges
    // deals after they have happened, as God and the tabloids intended.
    const business = [...state.transfers].filter(t => t.gw <= gwIdx && PLAYER_BY_ID[t.inId])
      .sort((a, b) => (+b.t || 0) - (+a.t || 0)).slice(0, 3);
    if (business.length) {
      const lines = business.map(t => {
        const inn = PLAYER_BY_ID[t.inId], outP = PLAYER_BY_ID[t.outId];
        const inPts = gwPlayerPoints(t.inId, gwIdx), outPts = outP ? gwPlayerPoints(t.outId, gwIdx) : 0;
        const route = t.trade ? 'trade' : t.windowDraft ? 'Window Draft' : t.waiver ? 'waivers' : 'the Trough';
        const verdict = inPts > outPts ? 'Immediate returns; recruitment department seen nodding.'
          : inPts < outPts ? 'The outgoing man won round one. Awkward.' : 'No verdict yet. The jury has gone for refreshments.';
        // trades get the wire treatment (Ben, 16 Aug: an Ornstein/Romano line)
        const scoop = t.trade ? (hash(`scoop:${gwIdx}:${t.managerId}:${t.inId}`) % 2
          ? `David Ornberg understands both clubs consider this deal a triumph. One of them is wrong.`
          : `Fabrizio Marano: "Here we go — done deal, confirmed, sealed, all of the words." &#128680;`) : '';
        return `<div class="prog-deal"><b>${esc(teamName(t.managerId))}</b><span>IN ${esc(inn.name)} &middot; OUT ${esc(outP?.name || 'vacancy')}</span><small>${esc(route)} &middot; ${esc(verdict)}</small>${scoop ? `<small class="prog-scoop">${scoop}</small>` : ''}</div>`;
      }).join('');
      out.push(`<div class="prog-sec">Deals Desk</div><div class="prog-deals">${lines}</div>`);
    }

    // The Trough Watch — a recent pickup that actually scored this week
    const pickups = state.transfers.filter(t => !t.trade && !t.windowDraft && t.gw <= gwIdx && gwIdx - t.gw <= 2)
      .map(t => ({ t, pts: gwPlayerPoints(t.inId, gwIdx), p: PLAYER_BY_ID[t.inId] }))
      .filter(x => x.p && x.pts >= 6).sort((x, y) => y.pts - x.pts);
    if (pickups.length) {
      const x = pickups[0];
      out.push(`<div class="prog-sec">The Trough Watch</div><p>${esc(`${x.p.name} — ${x.t.waiver ? 'taken on waivers' : 'signed from the Trough'} by ${teamName(x.t.managerId)} — returned ${x.pts} this week. The market sees everything, eventually.`)}</p>`);
    }
    // Tactical Negligence — the week's worst bench, if it's actually bad
    const worstBench = state.managers.map(m => ({ mid: m.id, w: benchWasteOf(m.id, gwIdx) })).sort((a, b) => b.w - a.w)[0];
    if (worstBench && worstBench.w >= 10) {
      const run = benchLeaderStreak(worstBench.mid, gwIdx);
      out.push(`<div class="prog-sec">Tactical Negligence</div><p>${esc(`${teamName(worstBench.mid)} left ${worstBench.w} points on the bench${run >= 2 ? ` — the ${ord(run)} week running they have led this table, which is now a table` : ''}. The bench order is a queue, not a punishment.`)} <span class="prog-by" style="display:inline">&mdash; ${esc(press(['tactics'], `tac:${gwIdx}`).n)}, tactics desk</span></p>`);
    }
    // Assistant Manager's Notebook — the lead story's beaten No. 2 speaks
    if (lead && typeof assistantFor === 'function') {
      const asst = assistantFor(lead.l);
      if (asst) out.push(`<div class="prog-sec">From the Dressing Room</div><p><b>${esc(asst.t)} (${esc(teamName(lead.l))}):</b> ${esc(dressingRoomQuote(lead, gwIdx))}</p>`);
    }
    // The Treatment Table — owned players the feed flags, worst first
    const flagged = [];
    for (const m of state.managers) for (const p of squadAt(m.id, gwIdx)) if (p.status && p.status !== 'a' && flagged.length < 3 && !flagged.some(x => x.p.id === p.id)) flagged.push({ p, mid: m.id });
    if (flagged.length) {
      out.push(`<div class="prog-sec">The Treatment Table</div><p>${flagged.map(x => `${pname(x.p)} <span class="muted">(${esc(teamName(x.mid))}${x.p.news ? ` — ${esc(x.p.news)}` : ''})</span>`).join('; ')}</p>`);
    }
    // Corrections & Clarifications — an upset means somebody's form book lied,
    // and the odd edition carries a one-off notice the Committee owes the
    // readership (keyed by gameweek NUMBER so a back edition keeps its own)
    const corrections = [];
    const up = allFacts.find(f => f.kind === 'upset' || f.kind === 'bottle-job');
    if (up) {
      corrections.push(`In previous editions the Gazette may have described ${teamName(up.l)} as "in control of their own destiny". The Gazette regrets the error.`);
    }
    /* The podcast outage, GW2 (Ben, 1 Sept: "i think we put something in the
       gazette - clarification style"). Lee heard half a silent talkTROUGH;
       Ric accused the league-owned press of burying the story. Printed
       straight, which is the only way this paper knows. */
    const NOTICES = {
      2: 'Listeners to Monday night’s talkTROUGH will have noticed that Richard Keyes and Jamie O’Hara-Hara fell silent mid-broadcast. The Gazette can confirm the pair had not walked out, been sent to Dubai, or discovered the meaning of restraint: the League’s voice budget simply ran out, there being, in the Chairman’s words, not enough money in the League. The Committee has responded by permanently cancelling this newspaper’s own sister programme, Gazette Football Weekly, a decision the Gazette reports without comment and entirely without bitterness. talkTROUGH resumes when the account resets in mid-September. Readers suggesting that a state-run league would have working podcasts are reminded that a state-run league would also have a functioning letters page. The Gazette remains editorially independent, fully funded, and in print. It regrets the silence, though not whose it was.',
    };
    if (NOTICES[GAMEWEEKS[gwIdx]?.n]) corrections.push(NOTICES[GAMEWEEKS[gwIdx].n]);
    if (corrections.length) {
      out.push(`<div class="prog-sec">Corrections &amp; Clarifications</div>${corrections.map(c => `<p class="muted" style="font-size:12px">${esc(c)}</p>`).join('')}`);
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

  /* ---------- Meet the Managers ---------- */

  /* Ian's commission (25 Aug): the ten standard questions, one manager at a
     time. Data lives in GAZETTE_INTERVIEWS (js/lore.js), keyed to a gameweek:
     the issue prints in that week's matchday edition (app.js previewArticle)
     and is carried in the same week's review edition below, so the archive
     keeps it. Static copy, no shared RNG, everything through esc(). */
  function interview(gwIdx) {
    try {
      const roster = typeof GAZETTE_INTERVIEWS !== 'undefined' ? GAZETTE_INTERVIEWS : [];
      const ent = roster.find(e => e.gw === gwIdx);
      if (!ent) return '';
      const m = (state.managers || []).find(x => ent.who.test(managerName(x.id)));
      if (!m) return '';
      const notes = [...(ent.notes || [])];
      if (ent.tradeCheck) {
        // the ledger fact-checks "Trading, what's that?" at press time
        const traded = state.transfers.some(t => t.trade && t.managerId === m.id);
        notes.push(traded
          ? `‡ The ledger, consulted after going to press, records completed trade business involving ${teamName(m.id)} this season. “What’s that” is therefore a matter between the manager and the ledger.`
          : '‡ The ledger confirms it: no trades. The first entirely accurate answer in the history of this feature.');
      }
      return `<div class="prog-story prog-lead-story prog-interview">
        <div class="prog-story-kicker">${esc(ent.kicker)}</div>
        <div class="prog-head">${esc(ent.head)}</div>
        <div class="prog-by">${esc(ent.by)}</div>
        ${ent.paywall ? `<div class="prog-paywall">${esc(ent.paywall)}</div>` : ''}
        ${(ent.intro || []).map(p => `<p>${esc(p)}</p>`).join('')}
        ${ent.qa.map(([q, a]) => `<div class="prog-int-q">${esc(q)}</div><p class="prog-int-a">${esc(a)}</p>`).join('')}
        ${notes.length ? `<div class="prog-int-notes">${notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
        ${ent.tail ? `<p class="prog-match-detail">${esc(ent.tail)}</p>` : ''}
      </div>`;
    } catch (e) { return ''; }
  }

  /* ---------- the Chairman's commissions: the GW3 matchday edition ----------
     Ben, 2 Sept 2026, for the Friday 4 Sept paper: lead on Ian's lucky
     streak ("see the data on the site"), a story on the Window Waiver and
     "how bad every pick is after Barcola", and the group chat's petition for
     a my-fourteen stats page, which the Committee declined to build and the
     Gazette prints instead. Every figure is read from public state at print
     time and each sentence is gated on the fact it asserts, so the copy can
     never disagree with the Crystal Ball or the ledger. Keyed to the
     gameweek NUMBER so the archive keeps the issue. No shared RNG: bylines
     by hash, everything else static. All copy goes through esc(). */

  const listOf = (xs) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
  const signed = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  const nth = (n) => typeof ord === 'function' ? ord(n) : String(n);
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const word = k => WORDS[k] || String(k);
  const finalBefore = (uptoGw) => { const out = []; for (let i = 0; i < uptoGw; i++) if (gwStatus(i) === 'final') out.push(i); return out; };

  // all-play up to (not including) a gameweek — the Crystal Ball's maths,
  // re-derived here so a back edition keeps its own figures
  function allPlayTo(uptoGw) {
    const rows = Object.fromEntries(state.managers.map(m => [m.id, { w: 0, d: 0, l: 0 }]));
    for (const i of finalBefore(uptoGw)) {
      const sc = state.managers.map(m => [m.id, gwManagerPoints(m.id, i)]);
      for (const [id, s] of sc) for (const [oid, os] of sc) {
        if (id === oid) continue;
        if (s > os) rows[id].w++; else if (s < os) rows[id].l++; else rows[id].d++;
      }
    }
    return rows;
  }

  function luckStory(gwIdx) {
    const ian = state.managers.find(m => /tussie/i.test(managerName(m.id)));
    if (!ian) return '';
    const table = h2hStandings(false, gwIdx);
    const pos = table.findIndex(r => r.id === ian.id);
    const me = table[pos];
    if (!me || !me.p) return '';
    const n = state.managers.length;
    const T = teamName(ian.id), N = managerName(ian.id);
    const ap = allPlayTo(gwIdx);
    const luckOf = r => r.pts - (3 * ap[r.id].w + ap[r.id].d) / (n - 1);
    const luck = table.map(r => ({ id: r.id, v: luckOf(r) })).sort((a, b) => b.v - a.v);
    const myLuck = luck.find(x => x.id === ian.id).v;
    const luckRank = luck.findIndex(x => x.id === ian.id) + 1;
    const runnerUp = luck[1];
    const mine = ap[ian.id];
    const topHalf = table.slice(0, Math.ceil(n / 2));
    const fewestInTopHalf = pos < topHalf.length && topHalf.every(r => r.id === ian.id || r.pf > me.pf);
    const outscoredWinless = table.filter(r => r.w === 0 && r.p > 0 && r.pf > me.pf).sort((a, b) => b.pf - a.pf)[0];
    // week by week: score, rank in the round, opponent, the award desk's view
    const weeks = [];
    for (const i of finalBefore(gwIdx)) {
      const pr = pairingsFor(i).find(x => x.includes(ian.id));
      if (!pr) continue;
      const op = pr[0] === ian.id ? pr[1] : pr[0];
      const s = gwManagerPoints(ian.id, i), os = gwManagerPoints(op, i);
      const rank = state.managers.map(m => gwManagerPoints(m.id, i)).sort((a, b) => b - a).indexOf(s) + 1;
      let aw = null; try { aw = typeof weeklyAwards === 'function' ? weeklyAwards(i) : null; } catch (e) { aw = null; }
      weeks.push({ i, n: GAMEWEEKS[i].n, op, s, os, rank, res: s > os ? 'W' : s < os ? 'L' : 'D', jammy: aw?.jammy?.w === ian.id });
    }
    if (!weeks.length) return '';
    // the lowest winning score of the season so far, anyone's
    let lowWin = null;
    for (const i of finalBefore(gwIdx)) for (const [a, b] of pairingsFor(i)) {
      const sa = gwManagerPoints(a, i), sb = gwManagerPoints(b, i);
      if (sa !== sb && (lowWin == null || Math.max(sa, sb) < lowWin)) lowWin = Math.max(sa, sb);
    }
    // the ledger: transactions per club since draft night
    const moves = Object.fromEntries(state.managers.map(m => [m.id, 0]));
    const myByGw = {};
    for (const t of state.transfers) {
      if (t.gw > gwIdx || moves[t.managerId] == null) continue;
      moves[t.managerId]++;
      if (t.managerId === ian.id) myByGw[t.gw] = (myByGw[t.gw] || 0) + 1;
    }
    const myMoves = moves[ian.id];
    const busiest = myMoves > 0 && Object.entries(moves).every(([id, v]) => Number(id) === ian.id || v < myMoves);
    const busiestWeek = Object.entries(myByGw).map(([g, c]) => ({ n: GAMEWEEKS[Number(g)]?.n, c })).sort((a, b) => b.c - a.c)[0];
    const firstXI = lineupFor(ian.id, weeks[0].i);
    const nowIds = new Set(squadAt(ian.id, gwIdx).map(p => p.id));
    const gone = firstXI.filter(id => !nowIds.has(id)).length;
    // this weekend
    const pr = pairingsFor(gwIdx).find(x => x.includes(ian.id));
    const op = pr ? (pr[0] === ian.id ? pr[1] : pr[0]) : null;
    const opRow = op != null ? table.find(r => r.id === op) : null;
    const opPos = op != null ? table.findIndex(r => r.id === op) : -1;
    let proj = null;
    try {
      const d = typeof gwPreviewData === 'function' ? gwPreviewData(gwIdx) : null;
      const row = d?.rows?.find(r => r.a === ian.id || r.b === ian.id);
      if (row) proj = { mine: row.a === ian.id ? row.sa : row.sb, theirs: row.a === ian.id ? row.sb : row.sa, motw: d.motw === row };
    } catch (e) { proj = null; }

    const perfect = me.l === 0 && me.d === 0;
    const paras = [];
    paras.push(`${T} sit ${nth(pos + 1)} after ${word(me.p)} round${me.p === 1 ? '' : 's'} with ${perfect ? 'a perfect record' : `${word(me.w)} win${me.w === 1 ? '' : 's'} from ${word(me.p)}`}, and the Gazette's numbers desk has spent the week trying to work out how. ${N} has ${perfect ? 'won every match he has played' : `won ${word(me.w)} of ${word(me.p)}`}. He has also scored ${me.pf} points${fewestInTopHalf ? ', fewer than any other club in the top half' : ''}${outscoredWinless ? `, and ${outscoredWinless.pf - me.pf} fewer than ${teamName(outscoredWinless.id)}, who have ${outscoredWinless.l === outscoredWinless.p ? 'lost every match they have played' : 'yet to win'}` : ''}.`);
    paras.push(`The Crystal Ball's luck column, which sets the head-to-head points a club has banked against what its scores deserved, gives ${T} ${signed(myLuck)}: ${luckRank === 1 ? `the largest figure in the league${runnerUp && myLuck - runnerUp.v >= 0.3 ? `, ${(myLuck - runnerUp.v).toFixed(1)} clear of ${teamName(runnerUp.id)}` : ''}` : `${nth(luckRank)} in the league`}. Played against all ${word(n - 1)} rivals every week instead of one, his record reads ${mine.w} wins${mine.d ? `, ${mine.d} draw${mine.d === 1 ? '' : 's'}` : ''} and ${mine.l} defeats${mine.w === mine.l ? `: a coin, and it has come up heads ${me.w === 2 ? 'twice' : `${me.w} times`}` : ''}.`);
    const bits = weeks.map(w => {
      if (w.res === 'W' && w.rank > n * 2 / 3) return `Gameweek ${w.n} was the masterpiece: ${w.s} points, the ${nth(w.rank)}-best total of ${word(n)}, and a win, because ${teamName(w.op)} found ${w.os} beneath it.${w.jammy ? ` The back page called it the Jammiest Win of the week${lowWin === w.s ? ', and it remains the lowest winning score of the season' : ''}.` : lowWin === w.s ? ' It remains the lowest winning score of the season.' : ''}`;
      if (w.res === 'W') return `Gameweek ${w.n} was more respectable: ${w.s} against ${teamName(w.op)}'s ${w.os}, the ${nth(w.rank)}-highest score of the round, which the manager will cite in his defence and the Committee will admit into evidence.`;
      if (w.res === 'D') return `Gameweek ${w.n} was a ${w.s}–${w.os} draw with ${teamName(w.op)}, which the numbers desk regards as the universe clearing its throat.`;
      return `Gameweek ${w.n}: ${w.s}–${w.os} to ${teamName(w.op)}, which the numbers desk regards as the correction.`;
    });
    paras.push(bits.join(' '));
    if (myMoves) paras.push(`None of it has been achieved quietly. The ledger records ${myMoves} transactions in ${T}'s name since draft night${busiest ? ', more than any other club' : ''}${busiestWeek && busiestWeek.c >= 6 ? `, including a Gameweek ${busiestWeek.n} spell in which ${word(busiestWeek.c)} men came or went` : ''}.${gone ? ` ${word(gone)[0].toUpperCase()}${word(gone).slice(1)} of the eleven who started Gameweek ${weeks[0].n} ${gone === 1 ? 'is' : 'are'} no longer at the club.` : ''} Fortune, the Gazette is told, favours the brave. It has not previously been known to favour the restless.`);
    if (op != null) {
      const opDesc = opRow && opRow.p && opRow.l === 0 && opRow.d === 0 ? `, also unbeaten but with ${opRow.pf} points to show for it` : opPos >= 0 ? `, ${nth(opPos + 1)} in the table` : '';
      paras.push(`The reckoning is booked for this weekend against ${teamName(op)}${opDesc}${proj?.motw ? ', in the tie of the round' : ''}. ${proj ? `The projections make it ${proj.mine}–${proj.theirs}${Math.abs(proj.mine - proj.theirs) <= 2 ? ': a coin toss, and he has been winning those' : ''}. ` : ''}Somebody's luck runs out this weekend. The Gazette has stopped saying whose.`);
    }
    const by = press(['colour'], 'gw3-luck').n;
    return `<div class="prog-story prog-lead-story">
      <div class="prog-story-kicker">THE LUCK DESK · ${esc(perfect ? `${word(me.w).toUpperCase()} FROM ${word(me.p).toUpperCase()}` : 'FORM AND FORTUNE')}</div>
      <div class="prog-head">FORTUNE FAVOURS THE BRAVE, AND ALSO IAN</div>
      <div class="prog-by">${esc(by)}, luck correspondent</div>
      ${paras.map(p => `<p>${esc(p)}</p>`).join('')}
    </div>`;
  }

  function windowStory(gwIdx) {
    // the feed's season expectation (the Data Room number), not this week's
    // fixture-adjusted projection — the pen is judged as a signing, not a pick
    const xp = p => Number(p.xp) || 0;
    const verdict = v => v >= 2.5 ? 'a footballer' : v >= 2 ? 'a squad player' : v >= 1.5 ? 'a body' : v >= 1 ? 'a name' : 'a rumour';
    const by = press(['wire'], 'gw3-window').n;
    const done = state.transfers.filter(t => t.windowDraft && t.gw <= gwIdx).sort((a, b) => (a.n || 0) - (b.n || 0));
    if (done.length) {
      // the server signs at most one man per slot and pushes in slot order,
      // so walking the slots against the ledger recovers every pick number
      const slots = typeof windowSlots === 'function' ? windowSlots() : [];
      const picks = []; let k = 0;
      for (let s = 0; s < slots.length && k < done.length; s++) if (slots[s] === done[k].managerId) picks.push({ no: s + 1, t: done[k++] });
      while (k < done.length) picks.push({ no: null, t: done[k++] });
      const rows = picks.map(x => ({ ...x, p: PLAYER_BY_ID[x.t.inId], out: PLAYER_BY_ID[x.t.outId] })).filter(x => x.p);
      if (!rows.length) return '';
      const best = [...rows].sort((a, b) => xp(b.p) - xp(a.p) || (a.no ?? 99) - (b.no ?? 99))[0];
      const after = rows.filter(r => r !== best && (r.no ?? Infinity) > (best.no ?? -1));
      const afterAvg = after.length ? after.reduce((t, r) => t + xp(r.p), 0) / after.length : 0;
      const signedIds = new Set(rows.map(r => r.t.managerId));
      const passed = state.managers.filter(m => !signedIds.has(m.id)).map(m => teamName(m.id));
      const paras = [
        `The Window Waiver has run, the holding pen is empty, and the ledger reads like a car boot sale at which one man turned up with a Ferrari. ${teamName(best.t.managerId)}${best.no === 1 ? ', first up by right of being last on draft night,' : best.no ? ` at pick ${best.no}` : ''} took ${best.p.name} of ${best.p.team || best.p.club}: ${xp(best.p).toFixed(1)} expected points a week, and the only name in the pen the stats desk would have crossed a road for.`,
        after.length
          ? `Then the cliff. The ${word(after.length)} signing${after.length === 1 ? '' : 's'} that followed average ${afterAvg.toFixed(1)} expected points between them, a figure the stats desk describes as "a Championship loan with the lights off". ${passed.length ? `${listOf(passed)} signed nobody, having lodged no list or a list the pen had already eaten, which the Committee regards as the correct reading of the pen.` : 'Every club signed somebody, which says more about the clubs than about the pen.'}`
          : `Nobody followed. ${passed.length ? `${listOf(passed)} signed nobody, ` : ''}which the Committee regards as the correct reading of the pen.`,
        'The leftovers have spilled into the Trough, where they are priced at nothing and, on the numbers, fairly.',
      ];
      const nibs = rows.map(r => `<div class="prog-nib"><b>${r.no ? `PICK ${r.no} · ` : ''}${esc(teamName(r.t.managerId))}</b><span>${esc(`${r.p.name} (${r.p.club}, ${xp(r.p).toFixed(1)} expected) in; ${r.out ? r.out.name : 'a squad place'} out. ${r === best ? 'The pen’s one footballer.' : `On the numbers, ${verdict(xp(r.p))}.`}`)}</span></div>`).join('');
      return `<div class="prog-story">
        <div class="prog-story-kicker">THE HOLDING PEN · THE WINDOW WAIVER</div>
        <div class="prog-head">ONE FOOTBALLER AND A CLIFF: THE WINDOW WAIVER IN FULL</div>
        <div class="prog-by">${esc(by)}, transfer wire</div>
        ${paras.map(p => `<p>${esc(p)}</p>`).join('')}
        <div class="prog-nibs">${nibs}</div>
      </div>`;
    }
    // not yet run: the pen as it stands, and the order it will be picked over
    const pen = typeof lockedArrivals === 'function' ? lockedArrivals() : [];
    if (pen.length < 2) return '';
    const sorted = [...pen].sort((a, b) => xp(b) - xp(a) || a.name.localeCompare(b.name));
    const best = sorted[0], rest = sorted.slice(1);
    const restAvg = rest.reduce((t, p) => t + xp(p), 0) / rest.length;
    const slots = typeof windowSlots === 'function' ? windowSlots() : [];
    const n = state.managers.length;
    const when = typeof WINDOW_WAIVER_AT !== 'undefined' && typeof windowWaiverHour === 'function'
      ? `${new Date(WINDOW_WAIVER_AT).toLocaleDateString('en-GB', { weekday: 'long' })} at ${windowWaiverHour()}` : 'this week';
    const twelfth = sorted[n - 1];
    const paras = [
      `The Window Waiver runs ${when}: one pass over the holding pen, two rounds, snaking, in the reverse of draft-night order, nobody required to be awake.${slots.length >= 2 * n ? ` ${teamName(slots[0])} pick first and ${nth(slots.length)}; ${teamName(slots[n - 1])} ${nth(n)} and ${nth(n + 1)}.` : ''}`,
      `The pen holds ${pen.length} men. One of them is ${best.name} of ${best.team || best.club}, ${xp(best).toFixed(1)} expected points a week. The other ${rest.length} average ${restAvg.toFixed(1)}, a figure the stats desk describes as "a Championship loan with the lights off".${twelfth ? ` In this pen the difference between the first pick and the ${nth(n)} is the difference between ${best.name} and ${twelfth.name}.` : ''}`,
    ];
    const nibs = sorted.slice(0, 6).map(p => `<div class="prog-nib"><b>${esc(`${p.name} (${p.club})`)}</b><span>${esc(`${xp(p).toFixed(1)} expected. On the numbers, ${verdict(xp(p))}.`)}</span></div>`).join('');
    return `<div class="prog-story">
      <div class="prog-story-kicker">THE HOLDING PEN · THE WINDOW WAIVER</div>
      <div class="prog-head">${esc(best.name.toUpperCase())}, AND THEN THE CLIFF</div>
      <div class="prog-by">${esc(by)}, transfer wire</div>
      ${paras.map(p => `<p>${esc(p)}</p>`).join('')}
      <div class="prog-nibs">${nibs}</div>
    </div>`;
  }

  /* the group chat, 2 Sept 2026, printed straight: Ian wants his fourteen's
     xG on one page; Marc says watchlist; the Chairman will not spend the
     League's usage on it; Ric's contribution is unprintable */
  function lettersPage(gwIdx) {
    const ian = state.managers.find(m => /tussie/i.test(managerName(m.id)));
    if (!ian) return '';
    const marc = state.managers.find(m => /conway/i.test(managerName(m.id)));
    const ric = state.managers.find(m => /blank/i.test(managerName(m.id)));
    const table = h2hStandings(false, gwIdx);
    const pos = table.findIndex(r => r.id === ian.id);
    const sig = `${managerName(ian.id)}, ${teamName(ian.id)}${pos >= 0 && table[pos].p ? `, ${nth(pos + 1)} in the table` : ''}`;
    const intro = 'The Gazette does not have a letters page. It has said so in print, twice. It publishes the following in full because the correspondent asked, repeatedly, and because it arrived through the Committee’s official complaints procedure, which is the group chat.';
    const letter = 'Sir, — How does a manager look at the statistics of his own players? The expected goals, the expected assists, that sort of thing. I press the little i on a player and the information is not there. I am told the Data Room has everything, and it does: it has every player in the country. It does not have my fourteen on their own. I just want to see my fourteen. That is the bit I cannot crack. It is hardly too much to ask, to see the statistics of one’s own team. Can somebody not prompt the developers?';
    const reply = [
      `The Data Room has everything. So does the Trough, if the filter is changed. A manager who wants his fourteen on one page may put his fourteen on his watchlist, a solution the Committee’s spokesman${marc ? ` (${managerName(marc.id)})` : ''} said he liked “because I don’t have to do anything”, and which he calculated would take the correspondent less time to do than it would take the Committee to build. Asked whether he could prompt the developers, he said: “I can, but I don’t really want to.”`,
      `The Chairman, petitioned directly, declined to spend any of the League’s usage on the matter and likened the request to a peasant asking the squire to have a word with Zeus. He referred to the correspondent throughout as “Iain the peasant”, a spelling the Gazette reproduces without endorsing. The spokesman agreed that it “seems a waste”.${ric ? ` ${managerName(ric.id)}’s contribution to the debate was received, considered, and is not printable in a family newspaper.` : ''}`,
      'The Gazette notes for the record that the correspondent is the League’s most decorated sceptic of artificial intelligence, on record that the machines will never take a football man’s job, and that “prompt the developers” is a sentence he has now typed of his own free will. The developers, for their part, have read the letter, which is more than the Committee did. The letters page, which does not exist, is now closed.',
    ];
    return `<div class="prog-story prog-letters">
      <div class="prog-story-kicker">LETTERS TO THE EDITOR · A PAGE WHICH DOES NOT EXIST</div>
      <div class="prog-head">SIR, I JUST WANT TO SEE MY FOURTEEN</div>
      <div class="prog-by">Correspondence desk</div>
      <p class="muted" style="font-size:12px">${esc(intro)}</p>
      <p><i>${esc(letter)}</i></p>
      <p class="prog-match-detail">${esc(`— ${sig}`)}</p>
      <div class="prog-int-q">The Committee replies</div>
      ${reply.map(p => `<p>${esc(p)}</p>`).join('')}
    </div>`;
  }

  /* ---------- the Window Waiver special (Ben, 2 Sept: "a preview of the pen
     tonight actually? special edition") ----------
     On the front step from Wednesday evening until the GW3 deadline prints
     the matchday edition over it; the archive keeps it under its own slot.
     Before Thursday's run it is the pen, the running order and the rules;
     once the ledger carries windowDraft records the same edition becomes
     the result, pick by pick. Everything from public state, nothing from
     the lodged lists, which are private by rule. */
  const WINDOW_SPECIAL_FROM = Date.parse('2026-09-02T16:30:00Z'); // 17:30 London, Wed 2 Sept
  const windowGwIdx = () => GAMEWEEKS.findIndex(g => g.n === 3);
  const windowRun = () => state.transfers.some(t => t.windowDraft);
  function windowSpecialLive() {
    const i = windowGwIdx();
    if (i < 0 || !GAMEWEEKS[i]) return false;
    return Date.now() >= WINDOW_SPECIAL_FROM && Date.now() < new Date(GAMEWEEKS[i].from).getTime();
  }
  function windowSpecial() {
    try {
      const gwIdx = windowGwIdx();
      if (gwIdx < 0) return '';
      const story = windowStory(gwIdx);
      if (!story) return '';
      const xp = p => Number(p.xp) || 0;
      const tier = v => v >= 2.5 ? 'Footballers' : v >= 2 ? 'Squad players' : v >= 1.5 ? 'Bodies' : v >= 1 ? 'Names' : 'Rumours';
      const out = [story];
      const pen = typeof lockedArrivals === 'function' ? lockedArrivals() : [];
      const n = state.managers.length;
      if (!windowRun()) {
        // the pen in full, sorted into the stats desk's tiers
        if (pen.length) {
          const groups = {};
          for (const p of [...pen].sort((a, b) => xp(b) - xp(a) || a.name.localeCompare(b.name))) (groups[tier(xp(p))] = groups[tier(xp(p))] || []).push(p);
          const order = ['Footballers', 'Squad players', 'Bodies', 'Names', 'Rumours'];
          out.push(`<div class="prog-sec">The Pen in Full</div><p class="prog-deck">Every man in the holding pen by the feed's expected points a week, sorted into the stats desk's tiers. Injured men are marked; the tiers are not medical advice.</p>${order.filter(k => groups[k]).map(k => `<div class="prog-nib"><b>${esc(k)} (${groups[k].length})</b><span>${esc(groups[k].map(p => `${p.name} ${p.pos} ${p.club} ${xp(p).toFixed(1)}${p.status && p.status !== 'a' ? ' †' : ''}`).join(' · '))}</span></div>`).join('')}`);
        }
        // the running order: each club's two slots, in first-round order
        const slots = typeof windowSlots === 'function' ? windowSlots() : [];
        if (slots.length >= 2 * n) {
          const firstRound = slots.slice(0, n);
          const picksOf = mid => slots.map((m, k) => (m === mid ? k + 1 : 0)).filter(Boolean);
          const line = firstRound.map(mid => `${teamName(mid)} ${picksOf(mid).join(' & ')}`).join('; ');
          const mid12 = firstRound[n - 1];
          out.push(`<div class="prog-sec">The Running Order</div><p>${esc(`The reverse of draft night, twice, snaking: ${line}. ${teamName(mid12)} pick back to back, which in this pen means two rumours in a row.`)}</p>`);
        }
        const hour = typeof windowWaiverHour === 'function' ? windowWaiverHour() : '8pm';
        out.push(`<div class="prog-sec">How It Works</div><p class="prog-deck">${esc(`A manager lodges a list of pairs — a man in from the pen, a man out from his squad — in order of preference. At ${hour} on Thursday the Committee walks the running order once: at each slot the first live line on that club's list is signed, one signing per slot, and the rest of the list waits for the club's second slot. A line is dead if the man is gone, the man out is gone, or the squad would break shape; a list with no live line passes the slot. Nobody needs to be awake. Whatever is left afterwards spills into the Trough, free to a good home, or any home.`)}</p>`);
        out.push(`<div class="prog-sec">The Committee&rsquo;s Closing Remark</div><p class="muted" style="font-size:12px">${esc('A list lodged is a list run; a list not lodged is a slot passed. Both are legal. One of them is wise, and the Committee declines to say which.')}</p>`);
      } else {
        // the leftovers, now in the Trough
        const left = [...pen].sort((a, b) => xp(b) - xp(a) || a.name.localeCompare(b.name)).slice(0, 6);
        if (left.length) out.push(`<div class="prog-sec">Left in the Trough</div><p>${esc(`The best of what nobody wanted, by the feed's expected points: ${left.map(p => `${p.name} (${p.club}, ${xp(p).toFixed(1)})`).join(', ')}. Free to a good home, or any home.`)}</p>`);
        const lodged = new Set(state.transfers.filter(t => t.windowDraft).map(t => t.managerId)).size;
        out.push(`<div class="prog-sec">The Committee&rsquo;s Closing Remark</div><p class="muted" style="font-size:12px">${esc(`The Committee thanks all twelve clubs for their lists, and the ${word(lodged)} of them that lodged one. The pen is closed. The Trough, as ever, is not.`)}</p>`);
      }
      return `<div class="prog-art">${out.join('')}</div>`;
    } catch (e) { return ''; }
  }

  const COMMISSIONS = {
    3: gwIdx => luckStory(gwIdx) + lettersPage(gwIdx),
  };
  /* the commissioned front page for a matchday edition, or '' — app.js
     previewArticle prints it above the fixtures, so its .prog-head is the
     dashboard splash */
  function frontPage(gwIdx) {
    try {
      const fn = COMMISSIONS[GAMEWEEKS[gwIdx]?.n];
      return fn ? fn(gwIdx) : '';
    } catch (e) { return ''; }
  }

  /* ---------- the edition ---------- */

  function build(gwIdx, used) {
    usedThisEdition = [];
    // A back edition is a historical document: later results must not move
    // its table, reclassify its matches or reshuffle its lead stories.
    const table = h2hStandings(false, gwIdx + 1);
    const posOf = Object.fromEntries(table.map((r, k) => [r.id, k]));
    const facts = pairingsFor(gwIdx).map(([a, b]) => factsFor(a, b, gwIdx, table, posOf))
      .sort((x, y) => y.weight - x.weight);
    if (!facts.length) return '';
    const lead = leadArticle(facts[0], gwIdx, used);
    const second = facts.slice(1, 3).map(f => report(f, gwIdx, used)).join('');
    const nibs = facts.slice(3);
    const nibBlock = nibs.length ? `<div class="prog-sec">Around the Grounds</div><div class="prog-nibs">${nibs.map(f => nib(f, gwIdx)).join('')}</div>` : '';
    // Always give the reader the consequence of the weekend. Scores without
    // a table are weather; the paper needs a developing plot.
    const stakes = table.some(r => r.p > 0)
      ? `<div class="prog-sec">The State of the Table</div><p>${esc(`${teamName(table[0].id)} have the early bragging rights${table[0].pts > table[1].pts ? `, ${table[0].pts - table[1].pts} point${table[0].pts - table[1].pts === 1 ? '' : 's'} clear` : ' on tiebreak'}. The playoff line cuts between ${teamName(table[7].id)} and ${teamName(table[8].id)}; ${teamName(table.at(-1).id)} are holding the rest of it up. The table never lies, but it does enjoy a wind-up.`)}</p>` : '';
    return `<div class="prog-art">
      <div class="prog-cols">${lead}${second}</div>
      ${nibBlock}
      ${stakes}
      ${interview(gwIdx)}
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

  /* The Season Preview — edition zero, printed before a ball is kicked (Ben,
     16 Aug: "there are rumours of Jason Stein making a comeback, surely that
     should be headline news"). Same furniture as the review edition, fully
     deterministic, safe with zero clubs founded. Retires itself the moment a
     real edition exists (progTodays prefers settled gameweeks). */
  function preview() {
    try {
      const mids = (state.managers || []).map(m => m.id);
      if (!mids.length) return '';
      const formers = (typeof FORMER_MANAGERS !== 'undefined' ? FORMER_MANAGERS : []).filter(n => n !== 'Jason Stein');
      const out = [];
      out.push(`<div class="prog-story prog-lead-story">
        <div class="prog-story-kicker">EXCLUSIVE</div>
        <div class="prog-head">STEIN LINKED WITH SENSATIONAL LEAGUE RETURN</div>
        <div class="prog-by">By David Ornberg, wire desk</div>
        <p>${esc('Jason Stein — remembered, where he is remembered fondly at all, as the Snake of the League, a man mired in more controversies than the rest of the register combined — has been heavily linked with a sensational return. And make no mistake: where there is smoke, the Gazette has been asked to report fire. Sources close to the player say his head has been turned. Sources closer still say he is keeping his cards close to his chest, an instinct the controversies did nothing to soften. The man himself could not be reached for comment, which insiders describe as "typical Stein".')}</p>
        <p>${esc('Any deal faces hurdles. The League seats twelve, every chair is taken, and the Committee\'s stance is clear: the register is closed, nobody is for sale at any price, and the integrity of the league must be protected. But football moves quickly, the window is technically never shut, and one thing is certain — this saga has legs.')}</p>
        <p>${esc('Fabrizio Marano: "Here we go soon, maybe. Not yet. But the feeling? The feeling is there."')} &#128680;</p>
        <p class="prog-match-detail">${esc('The draft, it should be noted, is a snake format. The Committee insists this is a coincidence.')}</p>
      </div>`);
      // the want-away saga (Ben, 16 Aug; Geller pardoned same day — he logged
      // in. Levy is the last of the twelve yet to report for pre-season)
      out.push(`<div class="prog-story">
        <div class="prog-head">LEVY &ldquo;CONSIDERING HIS FUTURE&rdquo;</div>
        <p>${esc('Ben Levy has stopped short of committing his future to Atlético Benfield, with those in the know saying he is weighing up his options and wants a new challenge. Asked to rule out a move, Levy ruled nothing in and nothing out, which the back pages have taken as a come-and-get-me plea to literally any other league.')}</p>
        <p>${esc('The detail doing the damage: eleven of the twelve have reported for pre-season at the new ground. Levy has not. Those close to the dressing room say the silence is being read the only way silence can be read. Atlético Benfield\'s stance is clear — he is going nowhere, not least because there is nowhere to go and the fifty pounds is non-refundable.')}</p>
        <p class="prog-match-detail">${esc('The Committee will not be drawn on speculation. The Gazette understands the speculation is ours.')}</p>
        <div class="prog-by">Henry Wanton</div>
      </div>`);
      // Geller backed by the owners (Ben, 16 Aug) — sponsor read live so the
      // story survives a rebrand at the Revolut Arena
      const geller = state.managers.find(x => /geller/i.test(managerName(x.id)));
      const backers = geller && typeof sponsorFor === 'function' ? sponsorFor(geller.id) : null;
      if (geller && backers) {
        out.push(`<div class="prog-story">
          <div class="prog-head">${esc(backers.toUpperCase())} BACK GELLER IN THE MARKET</div>
          <p>${esc(`Better news at ${teamName(geller.id)}, where principal partners ${backers} have moved to back Daniel Geller in the transfer market. The owners are understood to have made significant funds available — a war chest, in the traditional denomination — and told Geller to go and get his targets.`)}</p>
          <p>${esc('That every player in the draft is free, and that no fee has ever been paid for anything, is regarded inside the club as a technicality. "It is about the statement," said a source close to the board. The statement is that there is money, and that it will not be spent, because it cannot be.')}</p>
          <div class="prog-by">David Ornberg, wire desk</div>
        </div>`);
      }
      // last season, as the record book has it (the title is the playoffs)
      out.push(`<div class="prog-story">
        <div class="prog-head">CHAMPIONS UNTIL PROVEN OTHERWISE</div>
        <p>${esc('Interjacksonale go again, and the question on everyone\'s lips is the oldest in football: can they do it again on a cold Tuesday night in the playoffs? Adam Jackson has reminded his rivals that form is temporary and class is permanent, and last season he had both when it mattered most.')}</p>
        <p>${esc('WA Wanderers topped the table, and nobody remembers who topped the table. §1 of the constitution remains in force: the title is the playoffs. The table is for arguing.')}</p>
        <div class="prog-by">Harold Summer</div>
      </div>`);
      // the new ground
      out.push(`<div class="prog-story">
        <div class="prog-head">LEAGUE MOVES INTO PURPOSE-BUILT NEW HOME</div>
        <p>${esc('You can\'t fault the ambition. After a decade in rented accommodation, The League has completed its move to a purpose-built new home at theleaguehq.co.uk — its own Gazette, a crest from the College of Arms, and a waiver wire that runs on time. The old landlord took £145 a season and the fixtures were somebody else\'s. Enough said.')}</p>
        <p>${esc('Those inside the club say the new facilities speak for themselves, before going on to speak for them at considerable length. Season tickets are free; the fifty pounds is for the pot; the group chat remains, regrettably, unmoderated. No comment has been received from Eli, who for years took £10 a head to have the points on time and, in fairness, had the points on time.')}</p>
        <div class="prog-by">Alyson Unrudd</div>
      </div>`);
      // the draft market (Ben, 16 Aug: Haaland clear pick one, then nobody
      // has a clue; and the snake-slot argument). Names come off the board's
      // own rating so the shortlist tracks the live data, not a hunch.
      const rated = (typeof PLAYERS !== 'undefined' && typeof rating === 'function')
        ? [...PLAYERS].sort((a, b) => rating(b) - rating(a)).slice(0, 6) : [];
      if (rated.length >= 4) {
        const one = rated[0], chase = rated.slice(1, 5).map(p => p.name);
        out.push(`<div class="prog-story">
          <div class="prog-head">${esc(one.name.toUpperCase())} ONE. THEN THE ARGUMENTS.</div>
          <p>${esc(`${one.name} goes first.${/haaland/i.test(one.name) ? ' The league\'s own proverb settles it: he who holds Haaland has won every year.' : ''} It's a no-brainer — you simply do not turn down a player of that quality, and at this level quality is everything. After that it is anyone's game: the chasing pack reads ${chase.join(', ')}, in an order nobody will commit to in writing, because writing is evidence.`)}</p>
          <p>${esc(`Then there is the slot. Pick one takes ${one.name} and sits out twenty-three selections — an eternity in football. Pick twelve gets nothing famous and goes back-to-back at the turn, and the smart money says that is where the value is. The purists back the middle of the snake. On paper, every slot can be defended; football, famously, is not played on paper.`)}</p>
          <p class="prog-match-detail">${esc('Asked to rank the twelve slots in order, the room produced fourteen answers, one walkout, and a man asking what "snake" means. Draft night will settle nothing.')}</p>
          <div class="prog-by">Martin Said, chief football writer</div>
        </div>`);
      }
      // the pretentious tactics essay (Marc, 16 Aug; headline Ian's)
      out.push(`<div class="prog-story">
        <div class="prog-head">INVERTING THE PYRAMID SCHEME</div>
        <p>${esc('All fantasy football is a conversation with space, and space, as Bielsa understood before it was fashionable to understand it, does not exist until somebody runs into it. The draft is not a queue; it is a pressing trap. The manager who takes a full-back in round three is not filling a position — he is making an argument about territory, and the room, if it is listening, should be worried.')}</p>
        <p>${esc('Consider the bench — which is to say, consider absence. The English bench is transactional; the continental bench is a philosophical position, a held breath. Auto-substitution, properly understood, is gegenpressing applied to regret. And the snake format itself is a rondo: the ball comes back around, but never to the same man in the same space. He who fails to grasp this has already lost, probably in round two, probably to a goalkeeper reach.')}</p>
        <p class="prog-match-detail">${esc('Donathan Bilson\'s twelve-part series on the geometry of the Trough continues midweek.')}</p>
        <div class="prog-by">Donathan Bilson</div>
      </div>`);
      // the GAIL's essay (Marc's other commission, 16 Aug)
      out.push(`<div class="prog-story">
        <div class="prog-head">WHAT GAIL&rsquo;S TELLS US ABOUT THE MODERN LEAGUE</div>
        <p>${esc('There is a GAIL\'s now where the chip shop used to be, and there is a lesson in that, if you are the sort of person who looks for lessons in laminated pastry — which, this being a season preview, you are. The League has gentrified too. Once it was a WhatsApp thread and somebody else\'s spreadsheet; now it has a crest from the College of Arms and a waiver wire that runs to a timetable, and nobody can say exactly when that happened, in the way nobody can say when the £4.20 cinnamon bun became infrastructure.')}</p>
        <p>${esc('Progress, then, of a kind. Though one notes the pot is still fifty pounds, the arguments are still the arguments, and somewhere beneath the sourdough this remains a league that would trade the lot for one good Tuesday night. The flat white cools. The window, as ever, closes.')}</p>
        <div class="prog-by">Yonni Liu</div>
      </div>`);
      // "The Twelve, Surveyed" was CUT (Ben, 16 Aug: "not into this") — dealt
      // one-liners read as mad-libs next to the specific stories. Pre-draft
      // there is no real per-club material; per-club colour returns when the
      // weekly editions have actual squads and results to bite on.
      // real data seams (Ben, 16 Aug): the deals done and the wars declared
      // before a ball is kicked — read live from the club records
      const sponsored = state.managers
        .map(x => ({ t: teamName(x.id), s: typeof sponsorFor === 'function' ? sponsorFor(x.id) : null }))
        .filter(x => x.s);
      if (sponsored.length >= 2) {
        out.push(`<div class="prog-sec">The Commercial Register</div><p>${esc(`The commercial department reports a record window. Principal partnerships agreed to date: ${sponsored.map(x => `${x.s} at ${x.t}`).join('; ')}. Terms undisclosed, chiefly because there are none. The Committee takes its usual cut of nothing.`)}</p>`);
      }
      const seen = new Set();
      const mutual = [], oneway = [];
      for (const x of state.managers) {
        for (const r of rivalsOf(x.id)) {
          const key = [Math.min(x.id, r), Math.max(x.id, r)].join(':');
          if (rivalsOf(r).includes(x.id)) {
            if (!seen.has(key)) { seen.add(key); mutual.push(`${teamName(x.id)} v ${teamName(r)}`); }
          } else oneway.push(`${teamName(x.id)} have papers on ${teamName(r)}, who remain officially unaware`);
        }
      }
      if (mutual.length || oneway.length) {
        const bits = [];
        if (mutual.length) bits.push(`Fully reciprocated and constitutionally binding: ${mutual.join('; ')} — clásicos, the lot.`);
        if (oneway.length) bits.push(`Declared unilaterally: ${oneway.join('; ')}.`);
        out.push(`<div class="prog-sec">The Rivalry Register</div><p>${esc(`War has been declared before a ball has been kicked. ${bits.join(' ')} The Committee notes that rivalry declarations cannot be withdrawn, only regretted.`)}</p>`);
      }
      if (formers.length) out.push(`<div class="prog-sec">The Rumour Mill</div><p>${esc(`Also linked with returns this window: ${formers.join(', ')}. The Gazette has verified none of these and printed all of them.`)}</p>`);
      // midweek listings (Ian's commission, 16 Aug)
      out.push(`<div class="prog-sec">Midweek on the Overcunt</div><p>${esc('Tuesday: the panel names its combined XI of players they sold. Wednesday: forty minutes on whether 44–40 is a bad result (it is not — it is a great result). Thursday: emergency pod if anybody\'s waiver request is processed. All episodes recorded in a garage the production team continue to describe as "iconic".')}</p>`);
      out.push(`<div class="prog-sec">The Gazette&rsquo;s Fearless Predictions</div><p>${esc('Too close to call, so the Gazette will call it. Champions: whoever wins the playoffs — that is the point of them. Top of the table: irrelevant, see previous. The Cup: last man standing, first man blamed. The Chumpionship: hotly contested by men who will insist they were rebuilding, for the oldest prize in the league — first choice at the randomiser.')}</p>`);
      out.push(`<div class="prog-sec">The Committee&rsquo;s Closing Remark</div><p class="muted" style="font-size:12px">${esc('The season starts when the draft ends. Sleep while you can.')}</p>`);
      return out.join('');
    } catch (e) { return ''; }
  }

  /* The Post-Draft Special (Ben, draft night: "read all about it") — printed
     the morning after the board fills, retired the moment GW1 kicks off and
     the matchday edition takes the stands. Facts only from public state:
     the picks array, the archive, and nothing anybody whispered. */
  function draftSpecial() {
    try {
      const picks = (state.draft.picks || []);
      const mgrs = (state.managers || []);
      if (!picks.length || !mgrs.length) return '';
      const P = id => (typeof PLAYER_BY_ID !== 'undefined' ? PLAYER_BY_ID[id] : null);
      const mname = mid => (mgrs.find(m => m.id === mid) || {}).name || '?';
      const lsPts = p => { const ls = p && typeof lastSeasonOf === 'function' ? lastSeasonOf(p) : null; return ls ? (ls.pts || 0) : 0; };
      const rounds = Math.ceil(picks.length / mgrs.length);
      const out = [];

      /* Warner's draft night, from the group chat (Ben, 21 Aug). The skip
         control is labelled "Ian's button" in the source and reserved for
         Tussie by long tradition — Warner pressing it is where it starts. */
      out.push(`<div class="prog-story prog-lead-story">
        <div class="prog-story-kicker">POST-DRAFT SPECIAL &middot; DRAFT NIGHT SHAME</div>
        <div class="prog-head">&ldquo;POMP-OUS PRICKS&rdquo;: THE LONG NIGHT OF LEE WARNER</div>
        <div class="prog-by">By ${esc(press(['colour'], 'ds-warner').n)}, at the ground</div>
        <p>${esc('The opening ceremony of the 2026 draft — the anthem, the pomp, the solemn roll call of twelve clubs — was observed in full by eleven managers and abandoned by one. "I\u2019m in the room," reported Lee Warner. "Skipped the bollocks." The Gazette notes, because somebody must, that the skip control is reserved by long tradition for Ian Tussie and labelled as such. Warner did not merely skip the ceremony; he skipped it using another man\u2019s button. "You missed the best bit," said Ric Blank.')}</p>
        <p>${esc('Ninety seconds later, the man who could not sit through the anthem became the conscience of the league. It was Warner who caught the clock running at thirty seconds when sixty had been promised — "I thought it was 60 secs???? 30 is a joke" — Warner who demanded the pause, Warner who demanded the restart, and Warner who at 20:10 delivered the verdict the technical staff will have framed: "Fixed!! Devs!!!"')}</p>
        <p>${esc('The performance did not soften. Over the following hour the assembled Committee were designated "fucking nerds". The evening was revealed to have cost him a holiday — "I\u2019m literally missing a holiday for this shit" — during which, he wished it known, he was "definitely not living on a prayer". He called for the restoration of the old regime: "Bring back Draft Fantasy." The Chairman observed that Warner must have hated the World Cup. Toby Levy counselled hydration.')}</p>
        <p>${esc('Then, at 20:59, the reckoning. "You\u2019ll all be pleased to know my laptop has been doing this for 5 mins — thank god for my assistant." The man who skipped the ceremony was saved by the assistant manager he had installed as a joke that afternoon. Harris Rodden-Kersh drafted through the outage and holds, on the only evidence available, a better in-game record than his senior partner.')}</p>
        <p class="prog-match-detail">${esc('Warner drafted second overall and finished the night with a squad and a grievance. The Committee wishes him a restful remainder of his holiday and reminds him that the ceremony is optional; the judgment is not.')}</p>
      </div>`);
      const one = P(picks[0].playerId);
      const oneMid = picks[0].managerId;
      out.push(`<div class="prog-story">
        <div class="prog-head">${esc(((one && (one.full || one.name)) || 'PICK ONE').toUpperCase())} GOES FIRST</div>
        <div class="prog-by">By ${esc(press(['match'], 'ds-lead').n)}, in the draft room</div>
        <p>${esc(`With the first pick of the draft, ${teamName(oneMid)} selected ${(one && (one.full || one.name)) || 'a player'}${one ? ` of ${one.team}` : ''}, and the season officially had a face. ${picks.length} picks later the board stood full: twelve squads, ${rounds} rounds, no tears that anyone will admit to. The Gazette was in the room and can report that the snake format did what snake formats do — flattered the ends, punished the middle, and gave every manager somebody to blame that isn't themselves.`)}</p>
        <p class="prog-match-detail">${esc(`The first ball of the season is kicked with the ink still wet. The Gazette's advice, as ever: set your team.`)}</p>
      </div>`);

      const r1 = picks.slice(0, mgrs.length);
      out.push(`<div class="prog-story">
        <div class="prog-head">ROUND ONE, IN FULL</div>
        <div class="prog-by">By ${esc(press(['match'], 'ds-r1').n)}</div>
        <p>${esc(r1.map((pk, i) => { const p = P(pk.playerId); return `${i + 1}. ${teamName(pk.managerId)} — ${p ? p.name : '?'}${p ? ` (${p.club})` : ''}`; }).join('. '))}.</p>
      </div>`);

      // the bargain: the biggest last-season haul left on the board past
      // halfway. The reach: the first round's lightest archive. Both judged
      // on evidence, which is the only way the Gazette judges anything.
      const half = Math.floor(picks.length / 2);
      let steal = null;
      for (const pk of picks.slice(half)) { const p = P(pk.playerId); if (p && (!steal || lsPts(p) > lsPts(P(steal.playerId)))) if (lsPts(p) > 0) steal = pk; }
      let reach = null;
      for (const pk of r1) { const p = P(pk.playerId); if (p && lsPts(p) > 0 && (!reach || lsPts(p) < lsPts(P(reach.playerId)))) reach = pk; }
      if (steal || reach) {
        const sp = steal && P(steal.playerId), rp = reach && P(reach.playerId);
        out.push(`<div class="prog-story">
          <div class="prog-head">THE BARGAIN AND THE EYEBROW</div>
          <div class="prog-by">By ${esc(press(['tactics'], 'ds-value').n)}</div>
          ${sp ? `<p>${esc(`Bargain of the board: ${sp.full || sp.name} (${sp.club}), ${lsPts(sp)} points last season, still sitting there at pick ${steal.n} when ${teamName(steal.managerId)} strolled up. Either eleven managers know something, or one does.`)}</p>` : ''}
          ${rp ? `<p>${esc(`And the eyebrow: ${rp.full || rp.name} (${rp.club}) went at pick ${reach.n} — a first-round conviction pick from ${teamName(reach.managerId)} that last season's ${lsPts(rp)} points do not entirely explain. ${mname(reach.managerId)} is understood to be extremely relaxed about it, which is what everyone says.`)}</p>` : ''}
        </div>`);
      }

      /* the Gazette grades the twelve — squads ranked on the only evidence in
         existence (last season's archive points), graded on the curve, each
         verdict picked deterministically so every phone prints the same
         libel. An A means nothing and an F means slightly less. */
      const boards = mgrs.map(m => {
        const sq = picks.filter(pk => pk.managerId === m.id).map(pk => P(pk.playerId)).filter(Boolean);
        const total = sq.reduce((t, p) => t + lsPts(p), 0);
        const star = sq.slice().sort((a, b) => lsPts(b) - lsPts(a))[0];
        return { mid: m.id, total, star };
      }).sort((a, b) => b.total - a.total);
      const GRADES = ['A', 'A−', 'B+', 'B', 'B', 'B−', 'C+', 'C', 'C', 'C−', 'D', 'F'];
      const VERDICT_TOP = [
        (b) => `Bookmakers' favourites, which in this league is a curse with a rosette on it.`,
        (b) => `${b.star ? b.star.name : 'The star man'} headlines a squad assembled with actual planning, an accusation the manager denies.`,
        (b) => `The archive says title challenge. The archive said that about somebody last year too, and he finished seventh.`,
      ];
      const VERDICT_MID = [
        (b) => `Perfectly balanced, in the sense that it is equally likely to finish fourth or tenth.`,
        (b) => `A squad the Gazette can only describe as "there". ${b.star ? b.star.name : 'The best player'} deserves better and will be told so weekly.`,
        (b) => `Drafted like a man doing his big shop from memory. Most of the essentials, one inexplicable luxury.`,
        (b) => `The word for this squad is "solid", which is what you call a squad when you cannot think of anything.`,
        (b) => `A draft the manager will describe as "value-based" right up until October, and "transitional" thereafter.`,
        (b) => `Strong spine, questionable limbs. ${b.star ? b.star.name : 'The star man'} carries it; the physio has been briefed.`,
      ];
      const VERDICT_BOTTOM = [
        (b) => `The archive points total is best read sitting down. Already described by its own manager as "a project".`,
        (b) => `A bold rebuild, in the sense that demolition is technically the first phase of one.`,
        (b) => `${b.star ? b.star.name : 'One player'} will do a great deal of heavy lifting here, much of it emotional.`,
        (b) => `The randomiser's first-choice slot for next season is hotly contested, and this board is contesting it early.`,
      ];
      out.push(`<div class="prog-story">
        <div class="prog-head">THE GAZETTE GRADES THE TWELVE</div>
        <div class="prog-by">By ${esc(press(['tactics'], 'ds-grades').n)}, with a red pen</div>
        <p class="muted" style="font-size:12px">${esc('Method: last season’s archive points, totted up per squad, graded on the curve. Complaints to the letters page, which does not exist.')}</p>
        ${(() => {
          // no verdict repeats within the edition — a paper that copies its
          // own jokes two lines apart gets letters (Ben, first printing)
          const used = new Set();
          const verdict = (bank, key, b) => {
            const start = hash(key) % bank.length;
            for (let t = 0; t < bank.length; t++) { const c = bank[(start + t) % bank.length]; if (!used.has(c)) { used.add(c); return c(b); } }
            return bank[start](b);
          };
          return boards.map((b, i) => {
            const bank = i < 3 ? VERDICT_TOP : i >= boards.length - 3 ? VERDICT_BOTTOM : VERDICT_MID;
            const line = verdict(bank, 'ds-grade-' + b.mid, b);
            return `<p><b>${esc(GRADES[i])}</b> &mdash; ${esc(`${teamName(b.mid)} (${b.total} archive pts). ${line}`)}</p>`;
          }).join('');
        })()}
      </div>`);

      // the stampede: the longest run of consecutive picks in one position —
      // the moment the room looked up, saw everyone else reaching for the
      // same shelf, and panicked as one organism
      let run = null, cur = null;
      for (const pk of picks) {
        const p = P(pk.playerId); if (!p) { cur = null; continue; }
        if (cur && cur.pos === p.pos) { cur.to = pk.n; cur.len++; } else cur = { pos: p.pos, from: pk.n, to: pk.n, len: 1 };
        if (!run || cur.len > run.len) run = { ...cur };
      }
      if (run && run.len >= 4) {
        const POS_WORD = { GK: 'goalkeepers', DF: 'defenders', MF: 'midfielders', FW: 'forwards' };
        out.push(`<div class="prog-story">
          <div class="prog-head">THE STAMPEDE</div>
          <div class="prog-by">By ${esc(press(['colour'], 'ds-run').n)}</div>
          <p>${esc(`Between picks ${run.from} and ${run.to} the room took ${run.len} consecutive ${POS_WORD[run.pos]}, a chain reaction the Gazette's behavioural desk classifies as "herd event, mid-severity". No individual manager will admit to starting it. All of them finished it.`)}</p>
        </div>`);
      }

      // left at the altar: the best archive hauls nobody wanted, 168 times over
      const takenIds = new Set(picks.map(pk => pk.playerId));
      const spurned = (typeof PLAYERS !== 'undefined' ? PLAYERS : [])
        .filter(p => !takenIds.has(p.id) && p.status !== 'u' && lsPts(p) > 0)
        .sort((a, b) => lsPts(b) - lsPts(a)).slice(0, 3);
      if (spurned.length) {
        out.push(`<div class="prog-story">
          <div class="prog-head">LEFT AT THE ALTAR</div>
          <div class="prog-by">By ${esc(press(['colour'], 'ds-altar').n)}</div>
          <p>${esc(`One hundred and sixty-eight picks, and still nobody rang: ${spurned.map(p => `${p.full || p.name} (${p.club}, ${lsPts(p)} pts last season)`).join('; ')}. Between them, ${spurned.reduce((t, p) => t + lsPts(p), 0)} archive points now sit in the Trough wearing their best suit. The waiver wire opens shortly, at which point every manager who ignored them will claim to have "always liked the profile".`)}</p>
        </div>`);
      }

      /* the dugout desk — pre-draft canon, hand-written like the preview's
         sagas. Celta Leigh-Go announced a joint-managerial structure on the
         eve of the draft (the group chat is a public record and the Gazette
         reads it in the bath) */
      out.push(`<div class="prog-story">
        <div class="prog-head">TWO MEN, ONE DUGOUT: CELTA CONFIRM JOINT REGIME</div>
        <div class="prog-by">By ${esc(press(['wire'], 'ds-celta').n)}</div>
        <p>${esc('Celta Leigh-Go entered the draft under a joint-managerial structure, with assistant manager Harris Rodden-Kersh installed alongside the incumbent in an arrangement the club itself compared to Evans and Houllier. The Gazette notes, purely as a matter of record, that the Evans–Houllier era produced four months of confusion, one tearful resignation, and a cup run nobody remembers. The club was approached for comment and provided two, which is the problem in miniature.')}</p>
      </div>`);

      // hoarders' corner: the heaviest single-club concentration on any board
      let hoard = null;
      for (const m of mgrs) {
        const counts = {};
        for (const pk of picks) if (pk.managerId === m.id) { const p = P(pk.playerId); if (p) counts[p.team] = (counts[p.team] || 0) + 1; }
        for (const [club, n] of Object.entries(counts)) if (!hoard || n > hoard.n) hoard = { mid: m.id, club, n };
      }
      const gkPick = picks.find(pk => { const p = P(pk.playerId); return p && p.pos === 'GK'; });
      out.push(`<div class="prog-story">
        <div class="prog-head">NOTES FROM THE FLOOR</div>
        <div class="prog-by">By ${esc(press(['colour'], 'ds-floor').n)}</div>
        ${hoard && hoard.n >= 3 ? `<p>${esc(`${teamName(hoard.mid)} left the room with ${hoard.n} players from ${hoard.club}, a strategy known in the trade as "putting your eggs where your mouth is". ${mname(hoard.mid)} calls it conviction. The other eleven call it a ${hoard.club} supporters' club with a fantasy team attached.`)}</p>` : ''}
        ${gkPick ? `<p>${esc(`The first goalkeeper off the board was ${(P(gkPick.playerId) || {}).name || '?'} at pick ${gkPick.n}, taken by ${teamName(gkPick.managerId)} — ${gkPick.n <= mgrs.length * 2 ? 'early, by the standards of a position the league traditionally treats as an afterthought with gloves' : 'which tells you exactly what this league thinks of goalkeepers'}.`)}</p>` : ''}
        <p>${esc((() => { const tw = Object.keys(state.draft.timewastes || {}).filter(k => (state.draft.timewastes || {})[k] >= 1); if (!tw.length) return 'Remarkably, not a single timewaste was burned all night. The Committee had budgeted for scenes.'; return `Timewastes burned: ${tw.map(k => teamName(+k)).join(', ')} — each taking it to the corner flag under no pressure whatsoever. The unused ones expire worthless, like most of the picks.`; })())}</p>
      </div>`);

      /* Dev & Dev (Ben's commission, 21 Aug). AJ was told the developers were
         called Dev and Dev, believed it, and asked whether they were being
         paid. Played entirely straight, which is both funnier and, in every
         particular the Gazette can verify, true. */
      out.push(`<div class="prog-story">
        <div class="prog-story-kicker">GAZETTE INVESTIGATION</div>
        <div class="prog-head">DEV &amp; DEV: THE MEN BEHIND THE MACHINE</div>
        <div class="prog-by">By ${esc(press(['wire'], 'ds-devs').n)}, investigations</div>
        <p>${esc('The League\u2019s technical department consists of two men. Both are called Dev. Between them they have no surname, no photograph and no confirmed address. Neither has been seen at the ground. Neither attended the ceremony, though in fairness neither did Warner.')}</p>
        <p>${esc('Their existence entered the public record this week when Adam Jackson, on being told the developers were called Dev and Dev, accepted this without difficulty and moved straight to the follow-up nobody else had thought to ask: "but what about all those developers?" He then enquired whether the pair were being paid. The Gazette can confirm that they are not.')}</p>
        <p>${esc('Marc Conway, who has worked alongside them, knows the pair only as "the two lads", and during Thursday\u2019s clock crisis counselled the room to "do whatever the robots say" — a characterisation Toby Levy moved swiftly to correct. "Harsh on Devs calling them robots," he said, of two colleagues who had just repaired a live draft in under six minutes without once mentioning a babysitter.')}</p>
        <p>${esc('Working conditions could not be established. Hours are understood to be all of them. They are summoned in English, they do not eat, and they have never asked for anything. The only public acknowledgement of their labour came at 20:10 on Thursday from Lee Warner — "Fixed!! Devs!!!" — an outburst the Gazette understands was not accompanied by a payment, a contract, or a drink.')}</p>
        <p>${esc('Asked to clarify the pair\u2019s employment status, the Committee said the matter was under review. Asked whether they exist, the Committee said the matter was under review.')}</p>
        <p class="prog-match-detail">${esc('Dev and Dev were approached for comment and responded immediately, at length, and in flawless English. This too was unpaid.')}</p>
      </div>`);
      out.push(`<div class="prog-sec">Corrections &amp; Clarifications</div>
        <p class="muted" style="font-size:12px">${esc('In the hours before the draft, one manager conducted a sustained public campaign on the position that the autopick list "doesn’t autopick". The autopick list does, in fact, autopick. The Gazette thanks the eleven readers who wrote in to confirm this, and notes that the manager in question then drafted first overall with time to spare, describing the matter as "closed". The Gazette regrets nothing.')}</p>`);

      const last = picks[picks.length - 1];
      const lp = P(last.playerId);
      out.push(`<div class="prog-sec">And Finally</div>
        <p class="muted" style="font-size:12px">${esc(`Pick ${last.n}, the final selection of the night, was ${lp ? `${lp.name} (${lp.club})` : 'made'}, by ${teamName(last.managerId)}. Somebody has to be, and the Gazette wishes him a season of spiteful excellence. The paper returns with the GW1 matchday edition. Set. Your. Team.`)}</p>`);
      return out.join('');
    } catch (e) { return ''; }
  }

  return { review, preview, draftSpecial, interview, frontPage, windowSpecial, windowSpecialLive, windowRun, WINDOW_SPECIAL_FROM, _classify: classify, _facts: factsFor, _editionLineIds: editionLineIds };
})();
