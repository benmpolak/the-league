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
    out.push(`<div class="prog-sec">The Team-Sheet Audit</div><p class="prog-deck">Who delivered after being selected, who remained unused, and the attainable points each manager left behind.</p><div class="prog-team-sheet">${sheetRows.join('')}</div>`);

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
        <p>${esc('Jason Stein has been heavily linked with a sensational return to The League, and make no mistake: where there is smoke, the Gazette has been asked to report fire. Sources close to the player say his head has been turned. Sources closer still say he is keeping his cards close to his chest. The man himself could not be reached for comment, which insiders describe as "typical Stein".')}</p>
        <p>${esc('Any deal faces hurdles. The League seats twelve, every chair is taken, and the Committee\'s stance is clear: the register is closed, nobody is for sale at any price, and the integrity of the league must be protected. But football moves quickly, the window is technically never shut, and one thing is certain — this saga has legs.')}</p>
        <p>${esc('Fabrizio Marano: "Here we go soon, maybe. Not yet. But the feeling? The feeling is there."')} &#128680;</p>
      </div>`);
      // the want-away sagas (Ben, 16 Aug: Levy and Geller "leaving")
      out.push(`<div class="prog-story">
        <div class="prog-head">LEVY AND GELLER &ldquo;CONSIDERING THEIR FUTURES&rdquo;</div>
        <p>${esc('Ben Levy has stopped short of committing his future to Atlético Benfield, with those in the know saying he is weighing up his options and wants a new challenge. Asked to rule out a move, Levy ruled nothing in and nothing out, which the back pages have taken as a come-and-get-me plea to literally any other league.')}</p>
        <p>${esc('Daniel Geller is also understood to be unsettled. Geldog FC\'s stance is clear: not for sale at any price, no bids have been received, and none are expected — there being no other league, no transfer system and no fee structure. The fifty pounds remains non-refundable.')}</p>
        <p class="prog-match-detail">${esc('The Committee will not be drawn on speculation. The Gazette understands the speculation is ours.')}</p>
        <div class="prog-by">Henry Wanton</div>
      </div>`);
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
      // twelve lines for twelve clubs — dealt round-robin from a hashed start
      // so no two clubs share a verdict and the deal is stable between loads
      const moods = [
        'The board has demanded a top-eight finish and a calmer group chat. Neither is coming.',
        'Taking it one game at a time, starting several weeks before there are games.',
        'Quietly confident, which historically precedes the collapse.',
        'A summer of meticulous planning, none of which survives pick one.',
        'The ultras have painted a banner. It is already slightly wrong.',
        'All in on the draft. The draft has not agreed to this.',
        'Has read the rules PDF twice. It shows, worryingly.',
        'New crest, new domain, same problem at left-back.',
        'The gaffer has promised football played the right way. The board has priced in the wrong way.',
        'Bullish in public, refreshing the fixture list in private.',
        '"It\'s a results business," said a man yet to record a result.',
        'Promised the ultras a trophy. The ultras have long memories and a banner budget.',
      ];
      const dealFrom = hash('survey:2026');
      out.push(`<div class="prog-sec">The Twelve, Surveyed</div><div class="prog-nibs">${mids.map((mid, k) =>
        `<div class="prog-nib"><b>${esc(teamName(mid))}</b><span>${esc(`${managerName(mid)} — ${moods[(dealFrom + k) % moods.length]}`)}</span></div>`).join('')}</div>`);
      if (formers.length) out.push(`<div class="prog-sec">The Rumour Mill</div><p>${esc(`Also linked with returns this window: ${formers.join(', ')}. The Gazette has verified none of these and printed all of them.`)}</p>`);
      out.push(`<div class="prog-sec">The Gazette&rsquo;s Fearless Predictions</div><p>${esc('Too close to call, so the Gazette will call it. Champions: whoever wins the playoffs — that is the point of them. Top of the table: irrelevant, see previous. The Cup: last man standing, first man blamed. The Chumpionship: hotly contested by men who will insist they were rebuilding, for the oldest prize in the league — first choice at the randomiser.')}</p>`);
      out.push(`<div class="prog-sec">The Committee&rsquo;s Closing Remark</div><p class="muted" style="font-size:12px">${esc('The season starts when the draft ends. Sleep while you can.')}</p>`);
      return out.join('');
    } catch (e) { return ''; }
  }

  return { review, preview, _classify: classify, _facts: factsFor, _editionLineIds: editionLineIds };
})();
