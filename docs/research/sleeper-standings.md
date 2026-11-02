# Sleeper standings: order, seeds and points

Issue: rikhin99/lazy-pundit#67. Researched 2026-11-01 from one league, the 2025 season on local branch `fixtures/raw` (`fear-the-turtle-2025`: 12 teams, 6 playoff spots, no divisions, no median). Items marked **UNVERIFIED** could not be confirmed. Items marked **INFERENCE** are my reading, not a stated fact. Sleeper doesn't document any of this.

Code: `src/standings.ts`. Tests: `test/standings.test.ts`.

## Summary

- Sleeper orders the standings by win percentage, then points for. The 2025 bracket rules out head-to-head as the tiebreak.
- What Sleeper does when points for is also level is **UNVERIFIED**. The code falls back to team ID and calls the tie `unbroken`.
- Rosters report W-L-T and points, but no rank or seed. Both are derived.
- Sleeper's points are sums of unrounded scores, so a recount from the two-decimal matchup scores can be a cent off.

## 1. What the rosters report

`/league/<id>/rosters`, `settings`: `wins`, `losses`, `ties`, `fpts` + `fpts_decimal`, `fpts_against` + `fpts_against_decimal`, `ppts` + `ppts_decimal` (max points), `total_moves`, `waiver_*`. There is no rank, seed or division rank. They are the standings as of the fetch, never as of an earlier week.

These numbers cover the regular season only. The end-of-season fetch (after week 17) has the same W-L-T as a recount of weeks 1–14, so playoff games don't count. **INFERENCE** from one league.

## 2. Order and tiebreak

Verified against the week-15 winners bracket (round 1: seeds 3 v 6 and 4 v 5, with seeds 1 and 2 on byes). Through week 14:

| Team | Record | Points for | Seed |
| --- | --- | --- | --- |
| sleeper:5 | 7-7 | 1580.99 | 4 |
| sleeper:7 | 7-7 | 1556.49 | 5 |
| sleeper:8 | 7-7 | 1474.65 | 6 |
| sleeper:12 | 7-7 | 1462.31 | none |

sleeper:12 went 4-0 against the other 7-7 teams, so head-to-head would have seeded it. Points for explains every seed, including the two 9-5 teams (sleeper:11 over sleeper:4).

A tie counts as half a win. **UNVERIFIED**: no ties in this league.

### Not known

- The tiebreak after points for. **UNVERIFIED**.
- League setting `playoff_seed_type` is `0` here. Other values (perhaps re-seeding or division winners first) are unseen. **UNVERIFIED**.
- Division seeding (`settings.divisions`, roster `settings.division`). No league with divisions has been fetched, so `standingsThrough` takes the standings as reported and gives no rank or seed.
- Median scoring (`league_average_match: 1`) adds a result a week that the matchups don't hold, so the reported record can't be rebuilt. `standingsThrough` takes it as reported.

## 3. Points drift

`fpts` sums unrounded player points. Matchup `points` are rounded to two decimals. Summing those rounded scores over 14 weeks gave a one-cent gap for 2 of 24 totals:

- sleeper:10 points against: 1402.89 reported, 1402.88 recounted.
- sleeper:12 points for: 1462.31 reported, 1462.30 recounted.

The scrubber keeps Sleeper's reported standings in snapshots from the end of the regular season on (weeks 14 and 15), so tests compare against the real table. Earlier snapshots get a recount, because Sleeper only reports the current standings.
