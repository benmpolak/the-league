#!/usr/bin/env node
/* heal_ids.js — remap shifted FPL element ids by their immutable `code`.
 *
 * FPL ids are positional; a feed rebuild can renumber them. Every ledger
 * record written since 16 Aug 2026 carries `code`/`inCode`/`outCode`
 * (Chairman's Desk §3b), so when ids shift, this script maps old id → real
 * player via code, and rewrites the state: draft picks, transfers, claims,
 * lineups, bench orders, autolists, trade block, lobus, shirt numbers.
 *
 * DRY RUN by default — prints every change it would make and writes nothing.
 * Run against a league only with --live, and take a backup first
 * (scripts/backup_league.js).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=service-account.json \
 *     node scripts/heal_ids.js --league the-league-2627 [--live]
 *
 * Reads the CURRENT feed from data/data.json in this checkout — pull first.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LIVE = process.argv.includes('--live');
const leagueArg = process.argv.indexOf('--league');
const LEAGUE = leagueArg > -1 ? process.argv[leagueArg + 1] : null;
if (!LEAGUE) { console.error('usage: node scripts/heal_ids.js --league <id> [--live]'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'data.json'), 'utf8'));
const players = Array.isArray(data) ? data : data.players;
const byId = new Map(players.map(p => [p.id, p]));
const byCode = new Map(players.map(p => [p.code, p]));

// same auth model as backup/restore: service account for the real DB, or the
// emulator env var; firebase-admin borrowed from functions/ when not installed
// at the root (sol final-verdict P2 — the documented command must actually run)
function requireAdmin() {
  try { return require('firebase-admin'); }
  catch { return require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin')); }
}
const admin = requireAdmin();
admin.initializeApp({ databaseURL: process.env.FIREBASE_DATABASE_EMULATOR_HOST
  ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=calciopoli-wc26-default-rtdb`
  : 'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app' });
const db = admin.database();
const base = `v2/leagues/${LEAGUE}`;

const toArr = x => Array.isArray(x) ? x : x ? Object.values(x) : [];
let planned = 0;
const log = (where, from, to, name) => { planned++; console.log(`${LIVE ? 'FIX' : 'WOULD FIX'} ${where}: ${from} -> ${to} (${name})`); };

(async () => {
  const pub = (await db.ref(`${base}/public`).get()).val();
  if (!pub) { console.error('no public state at', base); process.exit(1); }

  // old id -> new id, learned from every code-carrying record whose id no
  // longer resolves (or resolves to a DIFFERENT player than the code says)
  const remap = new Map();
  const learn = (id, code, where) => {
    if (!id || !code) return;
    const cur = byId.get(id);
    if (cur && cur.code === code) return;               // id still right
    const real = byCode.get(code);
    if (!real) return;                                   // player left the league entirely — heal cannot invent him
    if (remap.has(id) && remap.get(id) !== real.id) {
      console.error(`CONFLICT at ${where}: id ${id} maps to both ${remap.get(id)} and ${real.id} — refusing to continue`);
      process.exit(1);
    }
    remap.set(id, real.id);
  };
  const priv = (await db.ref(`${base}/private`).get()).val() || {};
  for (const pk of toArr(pub.draft?.picks)) learn(pk?.playerId, pk?.code, `pick#${pk?.n}`);
  for (const t of toArr(pub.transfers)) { learn(t?.inId, t?.inCode, 'transfer.in'); learn(t?.outId, t?.outCode, 'transfer.out'); }
  // pending claims teach too (sol final-verdict P2): a free-agent claim target
  // may appear NOWHERE else — without this a lodged claim lapses or lands on
  // the wrong positional id after a rebuild
  for (const [uid, node] of Object.entries(priv)) for (const arr of Object.values(node?.claims || {})) {
    for (const c of toArr(arr)) { learn(c?.in, c?.inCode, `claim.in@${uid}`); learn(c?.out, c?.outCode, `claim.out@${uid}`); }
  }

  if (!remap.size) { console.log('Nothing to heal — every code-carrying id resolves to the right player.'); process.exit(0); }
  console.log(`Learned ${remap.size} id move(s):`, [...remap.entries()].map(([a, b]) => `${a}->${b} (${byId.get(b)?.name})`).join(', '));

  const upd = {};
  const heal = id => remap.get(id) ?? id;

  const picks = toArr(pub.draft?.picks);
  picks.forEach((pk, i) => {
    if (pk?.playerId && remap.has(pk.playerId)) {
      log(`draft/picks/${i}`, pk.playerId, heal(pk.playerId), byId.get(heal(pk.playerId))?.name);
      upd[`${base}/public/draft/picks/${i}/playerId`] = heal(pk.playerId);
    }
  });
  toArr(pub.transfers).forEach((t, i) => {
    for (const [k, ck] of [['inId', 'inCode'], ['outId', 'outCode']]) {
      if (t?.[k] && remap.has(t[k])) {
        log(`transfers/${i}/${k}`, t[k], heal(t[k]), byId.get(heal(t[k]))?.name);
        upd[`${base}/public/transfers/${i}/${k}`] = heal(t[k]);
      }
    }
  });
  // id-list structures: lineups, benchOrders, autolists (private), tradeBlock, lobus, shirtNums keys
  const healList = (node, where) => {
    const out = toArr(node).map(heal);
    if (JSON.stringify(out) !== JSON.stringify(toArr(node))) { log(where, 'list', 'list', `${out.length} ids`); return out; }
    return null;
  };
  for (const [mid, gws] of Object.entries(pub.lineups || {})) for (const [g, lu] of Object.entries(gws || {})) {
    const h = healList(lu, `lineups/${mid}/${g}`); if (h) upd[`${base}/public/lineups/${mid}/${g}`] = h;
  }
  for (const [mid, bo] of Object.entries(pub.benchOrders || {})) {
    const h = healList(bo, `benchOrders/${mid}`); if (h) upd[`${base}/public/benchOrders/${mid}`] = h;
  }
  for (const [mid, tb] of Object.entries(pub.tradeBlock || {})) {
    const h = healList(tb, `tradeBlock/${mid}`); if (h) upd[`${base}/public/tradeBlock/${mid}`] = h;
  }
  for (const [mid, pid] of Object.entries(pub.lobus || {})) {
    if (remap.has(Number(pid))) { log(`lobus/${mid}`, pid, heal(Number(pid)), byId.get(heal(Number(pid)))?.name); upd[`${base}/public/lobus/${mid}`] = heal(Number(pid)); }
  }
  // shirt numbers are keyed BY player id — move the value to the healed key
  // (sol final-verdict P3; cosmetic, but a healed league should be whole)
  for (const [mid, nums] of Object.entries(pub.shirtNums || {})) for (const [pid, num] of Object.entries(nums || {})) {
    if (remap.has(Number(pid))) {
      const to = heal(Number(pid));
      log(`shirtNums/${mid}/${pid}`, pid, to, `#${num}`);
      upd[`${base}/public/shirtNums/${mid}/${pid}`] = null;
      upd[`${base}/public/shirtNums/${mid}/${to}`] = num;
    }
  }
  // private trees: autolists + claims per uid (priv fetched above for learning)
  for (const [uid, node] of Object.entries(priv)) {
    const h = healList(node?.autolist, `private/${uid}/autolist`);
    if (h) upd[`${base}/private/${uid}/autolist`] = h;
    for (const [g, arr] of Object.entries(node?.claims || {})) {
      let changed = false;
      const healed = toArr(arr).map(c => {
        const nc = { ...c };
        if (c?.in && remap.has(c.in)) { nc.in = heal(c.in); changed = true; }
        if (c?.out && remap.has(c.out)) { nc.out = heal(c.out); changed = true; }
        return nc;
      });
      if (changed) { log(`private/${uid}/claims/${g}`, 'claims', 'claims', `${healed.length} entries`); upd[`${base}/private/${uid}/claims/${g}`] = healed; }
    }
  }

  console.log(`\n${planned} change(s) ${LIVE ? 'applying' : 'planned (dry run — re-run with --live to apply)'}`);
  if (LIVE && Object.keys(upd).length) {
    await db.ref().update(upd);
    console.log('Applied. Reload clients; the stale-save bar self-heals on next load.');
  }
  process.exit(0);
})();
