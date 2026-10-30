# Preseason sources: draft grades and projected standings

Issue: rikhin99/lazy-pundit#22. Researched 2026-10-30. Not legal advice. Items marked **UNVERIFIED** could not be confirmed from a primary source. Web pages were read through a summarizing fetch tool, so quotes are as that tool relayed them.

No authenticated endpoint was called and nothing was scraped. Sleeper shapes come from the docs and from the raw fixtures already saved on the local branch `fixtures/raw`. Yahoo and ESPN shapes come from official sample responses and from open-source client source code.

## Summary

| Platform | Team-level post-draft assessment | Where it lives | Readable by a local tool under the map's rules? |
|---|---|---|---|
| Yahoo | Draft grade per team (`A+` … `F-`), plus a link to a draft recap page | Documented API: team metadata fields `has_draft_grade`, `draft_grade`, `draft_recap_url` | Yes. Official API, read-only, OAuth, personal use. The recap page itself is app/web only. |
| ESPN | Draft-day projected rank per team; current projected rank; playoff odds | Undocumented `lm-api-reads` JSON, `mTeam` view: `draftDayProjectedRank`, `currentProjectedRank`, `currentSimulationResults.playoffPct` | Gray. No official API; Disney terms bar automated access. Needs user-supplied cookies for private leagues. |
| Sleeper | None found | Not in the documented API. No help article found. Only player-level projections exist, on an undocumented endpoint. | No team-level source. A week-0 order would have to be computed by the tool from player projections. |

No platform exposes projected standings as a W-L record, or projected season points per team, through a documented API.

## 1. Yahoo

### What exists
- **Draft grade (documented API).** The official API docs [Y1] show these fields on the Team resource sample and in several other samples (matchups, team season stats, roster):
  - `<has_draft_grade>1</has_draft_grade>`
  - `<draft_grade>B-</draft_grade>`
  - `<draft_recap_url>https://football.fantasysports.yahoo.com/2019/f1/1000/1/draftrecap</draft_recap_url>`
  - `<draft_position>` sits beside them.
- The docs prose never explains the grade; it appears only as tags in sample XML [Y1]. How Yahoo computes it is **UNVERIFIED** (no Yahoo help page found; third-party claims about ADP or projected points are not primary).
- Value range: `yfpy` documents `draft_grade` as a letter "A+", "A", ..., "F-" and `has_draft_grade` as 0/1 [Y3]. `yfpy` examples show values `A`, `B`, `C+` [Y3]. `yahoo_fantasy_api` lists `has_draft_grade` among the keys returned by league standings/teams [Y4].
- **Where to read it.** Team metadata is the default team sub-resource: `/fantasy/v2/team/{team_key}/metadata` [Y1]. `yfpy` also gets it from `/league/{league_key}/standings` and `/users;use_login=1/games;codes=.../teams` [Y3]. One call to league standings or league teams returns every team's grade.
- **Draft recap (app/web only).** Yahoo says the recap holds "Your draft grade, top picks, reaches, roster strengths and overall strategy analysis" [Y2]. The API returns only the URL. Reading that page would be scraping, which the map bans.
- **Projected standings / projected season points.** Not found in the API docs. The only projected value in the docs is `team_projected_points` per week (sample: week 5, `coverage_type` week, total 107.83) in matchup and scoreboard samples [Y1]. No sample shows a season-level projected total, projected rank or projected record [Y1]. Whether `/team/{key}/stats` with no `type` returns a season `team_projected_points`: **UNVERIFIED**. Yahoo's app is said by third parties to show projected standings after the draft; that is **UNVERIFIED** from a Yahoo source and in any case is not in the API.

### Shape (per team)
```
draft_position: int
has_draft_grade: 0 | 1
draft_grade: "A+" | "A" | ... | "F-"   (string; absent or empty when has_draft_grade is 0, per yfpy defaults)
draft_recap_url: string (web page)
```

### Sports
- Docs samples are NFL [Y1]. Whether Yahoo NBA and MLB leagues carry `draft_grade`: **UNVERIFIED**. The user's Yahoo leagues are NBA and MLB (league inventory ticket), so check this on the first real pull.
- Whether the grade is kept for past seasons: the `yfpy` standings example is a 2014 NFL league with a grade and a 2014 recap URL [Y3], which suggests it is retained.

### Terms
- Same as the Yahoo API research ticket: access by application, read-only, OAuth 2.0, personal license, no automated access outside the API. `draft_grade` is an ordinary API field, so reading it falls under that license. No extra terms apply to it.

## 2. ESPN

### What exists
- **Draft-day projected rank, current projected rank, playoff odds (undocumented).** ESPN's league JSON (`https://lm-api-reads.fantasy.espn.com/apis/v3/games/{ffl|fba|flb}/...`) returns team objects with these keys [E1, E2]:
  - `draftDayProjectedRank` (int). `espn-api` football maps it to `Team.draft_projected_rank` [E1].
  - `currentProjectedRank` (int). `espn-api` baseball maps it to `Team.current_projected_rank` [E1].
  - `currentSimulationResults.playoffPct` (fraction). `espn-api` football maps it to `Team.playoff_pct` (×100) [E1].
- `espn-api` requests these with `view=mTeam` (together with `mRoster`, `mMatchup`, `mSettings`, `mStandings`) [E1].
- In `espn-api`'s own test fixtures (2015 and 2018 football, hockey), every `draftDayProjectedRank` is `0`. `currentProjectedRank` is `0` in most fixtures and 1–10 in the 2018 football fixture [E2]. So 0 likely means "not set". Whether ESPN fills `draftDayProjectedRank` for current seasons, and for basketball: **UNVERIFIED**. The basketball `Team` class in `espn-api` does not map any of the three fields [E1], but the raw JSON may still carry them.
- **Draft Report Card (app).** ESPN's help centre has an article titled "Draft Report Card" (id 28419028885780) [E3]. Its body is behind a sign-in (HTTP 401), so its contents (grades? projected standings?) are **UNVERIFIED**. No draft-grade field was found in `espn-api` source or fixtures [E1, E2].
- **Projected season points per team.** Not found as a team field. `espn-api` exposes per-player season projections (`projected_total_points`, `projected_avg_points`) and per-matchup `totalProjectedPointsLive` [E1]. A team total would have to be summed by the tool.

### Shape (per team, raw JSON)
```
draftDayProjectedRank: int   (0 = not set, inferred from fixtures)
currentProjectedRank: int
currentSimulationResults: { playoffPct: float 0..1, ... }   (other keys UNVERIFIED)
playoffSeed: int
```

### Terms
- As found in the Sleeper/ESPN terms ticket: ESPN has no official public fantasy API; Disney terms bar "a robot, spider, script, or other automated means" and commercial use. The `lm-api-reads` host is undocumented. Private leagues need the user's `espn_s2` and `SWID` cookies.
- The map allows user-supplied cookies and treats ESPN as never a promised feature. So these fields are usable only as a best-effort, opt-in read, never as a dependency.

## 3. Sleeper

### What exists
- **No team-level post-draft assessment in the documented API.** The docs [S1] list user, league, rosters, users, matchups, brackets, transactions, traded picks, state, drafts, draft picks and players endpoints. The words "projection", "projected", "grade" and "standings" do not appear [S1]. The draft object's `metadata` holds only `scoring_type`, `name`, `description` [S1].
- Real payloads from the user's league confirm this. On `fixtures/raw` (`sleeper/fantasy-g-league-2026`), `league`, `drafts`, `rosters`, `draft_picks`, `users` and `matchups` contain no grade or projection keys. Roster `metadata` has `record` and `streak`; roster `settings` has `fpts` and `fpts_against`. Those are results, not projections.
- **Help centre.** Searching support.sleeper.com for "draft grade", "projections" and "power rankings" returned no article about draft grades, projected standings or power rankings [S2]. Projections appear only for player cards and Sleeper Picks. Whether the Sleeper app shows a post-draft grade or projected standings: **UNVERIFIED** (no primary source found either way).
- **Player-level projections (undocumented).** Well-known open-source clients call endpoints outside `/v1`:
  - `https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=...&order_by=ppr` (`nmelhado/league-page`, MIT) [S3].
  - `https://api.sleeper.com/projections/nfl/player/{player_id}?season_type=regular&season={year}[&grouping=week]` (`kt474/fantasy-football-wrapped`, Apache-2.0) [S4].
  - These return projected stat lines per player; `league-page` turns them into points using the league's scoring settings [S3]. They are not documented by Sleeper and were not called for this research.

### Shape
- Nothing at team level. A week-0 order on Sleeper would be a derived stat: sum each roster's projected starters from player projections. That is the tool's own projection, not the platform's.

### Terms
- Documented API: free for non-commercial use, no auth, under 1000 calls/min [S1]. The undocumented projections endpoints are not covered by the docs. Calling them is outside "official APIs preferred", and the map's scraping ban covers anything beyond documented APIs. Treat them as out of bounds for Stage 1 unless the map's rules change.

## What this means for a week-0 starting order

- **Yahoo:** the platform's own post-draft assessment is the letter `draft_grade` per team. It gives a coarse order with many ties (letters only). No projected rank or record via the API.
- **ESPN:** `draftDayProjectedRank` gives a full 1..N order if ESPN fills it. Best-effort only (undocumented, cookies, terms).
- **Sleeper:** nothing from the platform. Either no week-0 order, or a tool-computed one, which needs a projections source the map does not yet allow.

## Open items
1. Check `draft_grade` on the first real Yahoo NBA and MLB pull (sports other than NFL are unverified).
2. Check whether ESPN fills `draftDayProjectedRank` in a current private NFL league (needs the user's cookies; done by a fixtures ticket, not research).
3. Whether Yahoo returns a season-level `team_projected_points` from `/team/{key}/stats`.
4. Whether the Sleeper app shows any post-draft grade or projected standings (app only; would not be readable anyway).

## Sources
- [Y1] Yahoo Fantasy Sports API docs, https://sports.yahoo.com/developer/docs/ (full page read in two parts).
- [Y2] Yahoo Sports Fantasy Staff, "Draft Recaps just got a major upgrade", 2025-08-07, syndicated at https://www.aol.com/draft-recaps-just-got-major-130401722.html
- [Y3] `uberfastman/yfpy` (GPL-3.0), commit 5287b2d: `yfpy/models.py` (Team, TeamProjectedPoints), `yfpy/query.py` (examples for get_user_teams, get_league_standings, get_team_stats_by_week). https://github.com/uberfastman/yfpy
- [Y4] `spilchen/yahoo_fantasy_api` (MIT), commit c9f4fef: `yahoo_fantasy_api/league.py` (teams() docstring). https://github.com/spilchen/yahoo_fantasy_api
- [E1] `cwendt94/espn-api` (MIT), commit 700e15d: `espn_api/football/team.py`, `espn_api/baseball/team.py`, `espn_api/basketball/team.py`, `espn_api/requests/espn_requests.py`, `espn_api/requests/constant.py`. https://github.com/cwendt94/espn-api
- [E2] Same repo, test fixtures `tests/football/unit/data/league_2015_data.json`, `league_2018_data.json`, `tests/hockey/unit/data/league_data.json`.
- [E3] ESPN help centre public search API, `https://support.espn.com/api/v2/help_center/articles/search.json`; article "Draft Report Card", https://support.espn.com/hc/en-us/articles/28419028885780-Draft-Report-Card (returns 401 / sign-in redirect).
- [S1] Sleeper API docs, https://docs.sleeper.com/
- [S2] Sleeper support centre search, https://support.sleeper.com/en/?q=draft+grade, `?q=projections`, `?q=power+rankings`.
- [S3] `nmelhado/league-page` (MIT): `src/routes/api/fetch_players_info/+server.js`. https://github.com/nmelhado/league-page
- [S4] `kt474/fantasy-football-wrapped` (Apache-2.0): `src/api/sleeperApi.ts`. https://github.com/kt474/fantasy-football-wrapped
- Terms context: `docs/research/yahoo-fantasy-api.md` (branch `research/yahoo-fantasy-api`) and `docs/research/sleeper-espn.md` (branch `research/sleeper-espn`).
