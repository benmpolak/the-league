/* Live-match fast lane: push the CURRENT live gameweek's player stats from the
 * freshly-fetched feed straight into RTDB, where every client already holds an
 * open connection — sub-minute goal landings instead of the cron→commit→Pages
 * pipeline's ~5-10min. DISPLAY-ONLY: the canonical feed (data/stats.json on
 * Pages) remains the sole truth for settlement, waivers and the server engine;
 * clients treat liveStats as a freshness overlay and ignore it when stale.
 * Exit codes: 0 = pushed, 3 = no live fixture (caller should stop looping). */
'use strict';
const fs = require('fs');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const LEAGUE = 'the-league-2627'; // the sandbox fakes its own matchdays (the Chamber)

(async () => {
  const root = path.join(__dirname, '..');
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'data', 'fixtures.json'), 'utf8'));
  const stats = JSON.parse(fs.readFileSync(path.join(root, 'data', 'stats.json'), 'utf8'));

  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT missing'); process.exit(1); }
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(sa)),
    databaseURL: 'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app',
  });
  const ref = admin.database().ref(`v2/leagues/${LEAGUE}/public/liveStats`);

  // fp = finished_provisional: the whistle has gone even if FPL's slow
  // `finished` flag hasn't — without it this loop ran all night on GW1
  const live = fixtures.find(f => f && f.started && !f.finished && !f.fp);
  if (!live) {
    // nothing in play — clear a leftover overlay exactly once, then stand down
    if ((await ref.get()).val() != null) { await ref.set(null); console.log('cleared stale liveStats'); }
    else console.log('no live fixtures');
    process.exit(3);
  }
  const gwN = live.gw;
  const gw = (stats.gws || {})[gwN];
  const playerStats = (gw && gw.stats) || {};
  await ref.set({ n: gwN, t: Date.now(), playerStats });
  console.log(`pushed GW${gwN} liveStats: ${Object.keys(playerStats).length} players`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
