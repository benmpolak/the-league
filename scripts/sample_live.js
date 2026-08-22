/* Matchday acceptance sampler (HANDOFF-GW1 item 0, acceptance #2): read-only.
 * Samples public/liveStats every minute and prints the overlay's age; the
 * target is that during a live fixture the age never exceeds ~90s.
 * Usage: node scripts/sample_live.js [samples=10] [intervalSec=60] */
'use strict';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, '..', 'service-account.json'))),
  databaseURL: 'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app',
});
const N = +process.argv[2] || 10, EVERY = (+process.argv[3] || 60) * 1000;
(async () => {
  const ref = admin.database().ref('v2/leagues/the-league-2627/public/liveStats');
  let worst = 0;
  for (let i = 1; i <= N; i++) {
    const v = (await ref.get()).val();
    const now = new Date().toISOString().slice(11, 19);
    if (!v) console.log(`[${now}] sample ${i}/${N}: node is CLEAR (no live overlay)`);
    else {
      const age = (Date.now() - v.t) / 1000;
      worst = Math.max(worst, age);
      console.log(`[${now}] sample ${i}/${N}: gw${v.n} age=${age.toFixed(1)}s players=${Object.keys(v.playerStats || {}).length}`);
    }
    if (i < N) await new Promise(r => setTimeout(r, EVERY));
  }
  console.log(`worst observed age: ${worst.toFixed(1)}s ${worst <= 90 ? '— PASS (≤90s)' : '— OVER the 90s target'}`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
