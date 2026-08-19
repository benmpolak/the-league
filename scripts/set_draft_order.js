#!/usr/bin/env node
// Set the live league's manager order to the randomiser result (16 Aug 2026)
// so draft night is "Start draft (ordered)" with zero dragging.
//
// The Chairman asked for this on 16 Aug ("just set the order it is set now").
// Safe because: commissioner on the live league is membership ROLE, not
// managers[0] (app.js:222); everything else keys on manager id, not index.
//
// Dry-run by default — prints current vs target and changes nothing.
// Run with --live to write. Requires GOOGLE_APPLICATION_CREDENTIALS.

const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const DB_URL = 'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app';
const LEAGUE = 'v2/leagues/the-league-2627';

// Pick 1 → 12, from the group chat (Marc relayed the randomiser result).
// Matched on manager name as it exists in the live league.
const TARGET = [
  'Toby Levy',      // 1
  'Lee Warner',     // 2
  'Daniel Geller',  // 3
  'Ben Levy',       // 4
  'Ben Polak',      // 5
  'Marc Conway',    // 6
  'Ric Blank',      // 7
  'Wilko Wilkowski',// 8
  'Adam Jackson',   // 9
  'Alex Singer',    // 10
  'Ian Tussie',     // 11
  'Alex Duckett',   // 12
];

const live = process.argv.includes('--live');

admin.initializeApp({ projectId: 'calciopoli-wc26', databaseURL: DB_URL });
const ref = admin.database().ref(`${LEAGUE}/public`);
setTimeout(() => { console.error('timed out talking to the database'); process.exit(1); }, 60000);

(async () => {
  const snap = await ref.child('phase').get();
  const phase = snap.val();
  if (phase !== 'setup') {
    console.error(`refusing: league phase is "${phase}", not "setup" — the order only matters pre-draft`);
    process.exit(1);
  }
  const mSnap = await ref.child('managers').get();
  const managers = mSnap.val();
  if (!Array.isArray(managers) || managers.length !== 12) {
    console.error(`refusing: managers is not a 12-entry array (got ${managers && managers.length})`);
    process.exit(1);
  }
  console.log('current order:');
  managers.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} (id ${m.id})`));

  const byName = new Map(managers.map(m => [m.name.trim().toLowerCase(), m]));
  const missing = TARGET.filter(n => !byName.has(n.toLowerCase()));
  if (missing.length) {
    console.error('refusing: these target names are not in the live league:', missing.join(', '));
    console.error('fix the TARGET list to match the names printed above.');
    process.exit(1);
  }
  const reordered = TARGET.map(n => byName.get(n.toLowerCase()));

  console.log('\ntarget order (randomiser, 16 Aug):');
  reordered.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} (id ${m.id})`));

  if (!live) {
    console.log('\ndry run — nothing written. Re-run with --live to apply.');
    process.exit(0);
  }

  // One transaction on the managers node. Admin-SDK gotcha (documented in
  // the project memory, bit heal_ids before): the FIRST pass runs on an empty
  // local cache, so cur is null — returning undefined there ABORTS with no
  // refetch. Seed that pass with the value computed from our fresh get(); the
  // SDK round-trips it, and if the server disagrees it re-runs the callback
  // with the real value, which we then reorder properly.
  const ids = managers.map(m => m.id).sort().join(',');
  const res = await ref.child('managers').transaction(cur => {
    if (cur === null) return reordered; // seed for the empty-cache first pass
    if (!Array.isArray(cur) || cur.length !== 12) return; // abort
    if (cur.map(m => m.id).sort().join(',') !== ids) return; // abort: changed under us
    const map = new Map(cur.map(m => [m.name.trim().toLowerCase(), m]));
    return TARGET.map(n => map.get(n.toLowerCase()));
  });
  if (!res.committed) {
    console.error('transaction aborted — managers changed while we worked; re-run');
    process.exit(1);
  }
  const after = res.snapshot.val();
  console.log('\nWRITTEN. Verified order now:');
  after.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} (id ${m.id})`));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
