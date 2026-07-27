# Draft Fantasy — historical data recovery report

Recovered 26 July 2026, using only public/documented routes, the user's own
mailbox, and files already in this repo. No access controls were bypassed.

## What we hold, by season

| Season  | League ID                   | Platform        | Recovered |
|---------|-----------------------------|-----------------|-----------|
| 2019/20 | 5ggcsQwn8Bqsiqxgn           | old (Meteor)    | Nothing from DF. Champion known (Ben Polak). |
| 2020/21 | udtJqYsYkW959hNxu           | old (Meteor)    | Nothing from DF. Champion known (Alex Singer). |
| 2021/22 | DWwzaGpJ9JNnBikwH           | old (Meteor)    | Nothing from DF. Champion known (Alex Singer). |
| 2022/23 | fJq4z658JWxQexczK           | old (Meteor)    | Nothing from DF. Champion known (Alex Duckett). |
| 2023/24 | p7RKdANyacRjK3QbG           | old (Meteor)    | Nothing from DF. Champion known (Ian Tussie). |
| 2024/25 | clyt0rmlc000712rmazinhymy   | new (epl24)     | **Partial**: team list (12 names), full custom scoring rules → `raw/2024-25_*.json`. Champion known (Richard Blank). |
| 2025/26 | cmdgga0kd00aejs04ev1880sg   | new (epl25)     | **Complete**: managers, final table, all 228 H2H results, 4 cup ties, full 168-pick draft, scoring rules, player-stats CSV → `2025-26.json` + `raw/2025-26_*` + `epl25.json`/`players25.json`/`stats25.json`. |

Honours 2015–2026 were already recorded in the app (`HONOURS_BOARD`, js/app.js).

## Where the walls are

- **Old platform (2019–2024, draftfantasyfootball.co.uk)**: retired. League
  routes 404, nothing in the Wayback Machine beyond app source files (league
  pages were behind login, never archived). Only Draft Fantasy themselves can
  export these — see SUPPORT-REQUEST.md.
- **2024/25 (epl24 schema)**: the API database is still up, but every endpoint
  that joins user-profile data returns 500 — `/league`, `/draft`, `/matches`,
  `/table` all crash; `/teams` and `/scoring` (no user join) work. The archived
  frontend `epl24.draftfantasy.com` throws a client-side exception on every
  page, logged in or not. The match/draft rows likely still exist server-side —
  flagged as a bug in the support request.
- **`/cup` and `/stats`** require authentication (Bearer token, not cookies) on
  every schema; out of bounds for this exercise.

## Recoverable later, if wanted

- **2024/25 transfer history**: ~100+ "There were new trades in your league!"
  emails from updates@notifications.draftfantasy.com (Aug 2024–May 2025) in
  Ben's Gmail carry full player-level trade detail. Scriptable harvest.
- **Season welcome packs** in Gmail with attachments the connector can't pull
  (download manually if wanted): "The League 2019/2020" (Jul 2019, includes
  `Draft Fantasy review 2018-2019.csv`), "Draft Fantasy 2020-2021" (Sep 2020),
  "Draft Fantasy 2023 - 2024" (Aug 2023, rules PDF).

## File layout

- `data/history/2025-26.json` — cleaned season archive (no account IDs).
- `data/history/raw/` — verbatim API responses (contain DF user/team UUIDs;
  kept for provenance, not shipped to the app).
- `data/history/epl25.json` — app-facing source for `scripts/build_history.py`
  → `js/history25.js` (Record Book: table, draft board, cup, H2H ledger).
