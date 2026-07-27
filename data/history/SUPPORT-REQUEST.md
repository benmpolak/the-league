# Support request — send to Draft Fantasy

Via the in-app Feedback button on app.draftfantasy.com (fastest), or their
support email. Sent from the account that paid: benmpolak@gmail.com /
benmpolak@googlemail.com.

---

**Subject: Data export request — paid private league, 7 seasons (2019/20–2025/26)**

Hi,

Our 12-man private league has played (and paid for) Draft Fantasy every season
since 2019/20. We're building a private archive of our own league history and
would like an export of our league records for the seasons below. JSON or CSV,
whatever is easiest for you.

Old platform (draftfantasyfootball.co.uk):

- 2019/20 — league `5ggcsQwn8Bqsiqxgn`
- 2020/21 — league `udtJqYsYkW959hNxu`
- 2021/22 — league `DWwzaGpJ9JNnBikwH`
- 2022/23 — league `fJq4z658JWxQexczK`
- 2023/24 — league `p7RKdANyacRjK3QbG`

Current platform:

- 2024/25 — league `clyt0rmlc000712rmazinhymy` (epl24)

Per season, whatever you still hold of: teams and managers, draft picks, weekly
head-to-head results, final standings, and transfers/waivers/trades. We already
have 2025/26 (`cmdgga0kd00aejs04ev1880sg`) via the public API, so no need for
that one.

One bug report that may help you as much as us: on the epl24 archive,
`GET api.draftfantasy.com/epl24/league/<id>` (and `/draft`, `/matches`,
`/table`) return 500 for our league, while `/teams` and `/scoring` work fine —
and epl24.draftfantasy.com throws a client-side exception on every page. If
that's a broken join rather than deleted data, fixing it would let us pull
2024/25 ourselves through the same public routes we used for 2025/26.

Happy to verify league ownership however suits (commissioner email, payment
reference).

Thanks — the product's been a big part of our group for years.

Ben Polak
