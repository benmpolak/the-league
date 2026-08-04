#!/usr/bin/env node
/* One-shot sandbox repair (UAT night, 4 Aug): the pre-fix transferGw let two
 * post-waiver-run moves land at gw 0 INSIDE the settled mock GW1 —
 * including a second, illegal Donnarumma trade (Toby had already traded him
 * to Wilko). Removes the illegal pair, restamps the one legal move to gw 1,
 * renumbers. Sandbox ONLY. Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/calciopoli-wc26-sa.json node scripts/repair_sandbox_donnarumma.js
 */
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ databaseURL: 'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app' });
const db = admin.database();
(async () => {
  const ref = db.ref('v2/leagues/the-league-sandbox/public/transfers');
  const res = await ref.transaction(cur => {
    if (!cur) return cur;
    let arr = Object.values(cur);
    const bad = t => t.gw === 0 && ((t.managerId === 2 && t.inId === 497 && t.outId === 384) || (t.managerId === 8 && t.inId === 384 && t.outId === 497));
    arr = arr.filter(t => !bad(t));
    arr = arr.map(t => (t.gw === 0 && t.managerId === 2 && t.inId === 472 && t.outId === 503) ? { ...t, gw: 1 } : t);
    return arr.map((t, i) => ({ ...t, n: i + 1 }));
  });
  console.log('committed:', res.committed, '| records now:', Object.values(res.snapshot.val() || {}).length);
  const pub = (await db.ref('v2/leagues/the-league-sandbox/public').get()).val();
  for (const mid of [2, 8, 12]) {
    const ids = new Set(pub.draft.picks.filter(p => p.managerId === mid).map(p => p.playerId));
    for (const t of Object.values(pub.transfers)) { if (t.managerId !== mid || t.gw > 1) continue; ids.delete(t.outId); ids.add(t.inId); }
    console.log('mgr', mid, 'squad at gw1:', ids.size, ids.has(384) ? '(has Donnarumma)' : '');
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
