# Sleeper and ESPN: terms, API health, NBA support

Issue: rikhin99/lazy-pundit#4. Researched 2026-10-29. Not legal advice. Items marked **UNVERIFIED** could not be confirmed from a primary source.

## Summary

- Sleeper has a public, read-only, unauthenticated API, free for non-commercial use, with a 1000 calls/minute guideline. Its docs say league/draft/user endpoints support only NFL, but live probing shows NBA data comes back for some endpoints. No NBA league ID was available to test, so league-by-ID for NBA is **UNVERIFIED**.
- ESPN has no official public fantasy API or developer terms that I found. Its general (Disney) terms prohibit automated access and commercial use. The main community wrapper, `cwendt94/espn-api`, is actively maintained and supports basketball.

## 1. Sleeper

### Docs and terms
- Docs: https://docs.sleeper.com/
  - "stay under 1000 API calls per minute, otherwise, you risk being IP-blocked".
  - The API is "free to use for non-commercial purposes"; commercial users must contact Sleeper for licensing.
  - "No API Token is necessary, as you cannot modify contents via this API"; it is read-only with no authentication.
  - Trending data requires attribution to Sleeper.
  - The players endpoint should be called at most once a day and the result stored on your own servers.
- General Terms of Use (last updated October 6, 2026), https://support.sleeper.com/en/articles/5486620-terms-of-use (reached via redirect from https://sleeper.com/terms):
  - Section 9.2 grants a license "for your personal and non-commercial use" and prohibits reverse engineering.
  - The terms text I read does not mention the API. I read only the first ~100k of ~153k characters, so later sections are **UNVERIFIED**.
  - The API docs' non-commercial wording is the operative statement for API use.

### NBA support
- Docs say of `GET /v1/user/<user_id>/leagues/<sport>/<season>`: "We only support "nfl" right now." Docs also list sport examples "nfl, nba, lcs, etc..." for the state endpoint. (https://docs.sleeper.com/)
- Live probes against https://api.sleeper.app/v1 on 2026-10-29:
  - `/state/nba` returned HTTP 200 with NBA season data (season 2026, week 2).
  - `/players/nba` returned HTTP 200 with player records.
  - `/user/<sleeper bot id>/leagues/nba/2026` returned HTTP 200 with `[]` (that user has no NBA leagues, so inconclusive).
  - `/league/1` returned HTTP 404 with body `null`.
- Does Sleeper answer for an NBA league ID: **UNVERIFIED.** `/v1/league/<league_id>` takes no sport parameter in the docs, so it is likely sport-agnostic, but I had no real NBA league ID to test. Next step: obtain a known NBA league ID and call `/league/<id>`, `/rosters`, `/users`, `/matchups/<week>`.
- The undocumented NBA behavior may change without notice, since the docs say NFL only.

## 2. ESPN

### Terms
- ESPN has no official public fantasy API docs that I found; a web search surfaced only third-party material (**UNVERIFIED** that none exists).
- Disney Terms of Use (last updated May 24, 2024), https://disneytermsofuse.com/english/ (the page that ESPN-branded terms are expected to point to; the ESPN-specific terms page was not retrieved, **UNVERIFIED**):
  - Section 2.B prohibits using "a robot, spider, script, or other automated means" to "access, monitor, copy or extract" products, including "data mining or web scraping".
  - Section 2.A licenses "personal, noncommercial use only"; Section 2.B.viii bars "any commercial or business-related use".
  - The page does not mention APIs.
- https://www.espn.com/robots.txt disallows several AI crawlers (including GPTBot, anthropic-ai) site-wide. The `*` rules I saw did not mention fantasy API hosts; I read only the top ~50 lines.
- Implication: the unofficial fantasy API is a gray area under these terms. Treat as personal, non-commercial, at your own risk.

### Community wrapper health (GitHub API, 2026-10-29)
- `cwendt94/espn-api` (https://github.com/cwendt94/espn-api): MIT, not archived, ~997 stars, last push 2026-10-26, releases v1.0.0 (2026-10-02) and v1.0.1 (2026-10-09), 65 open issues/PRs. Recent activity is mostly dependency bumps and feature PRs; open bug reports include "League Not Found" (#650) and "SlotPosition for each day - Basketball" (#671).
  - README: supports "Fantasy Football and Basketball (NHL, MLB, and WNBA are in development)".
  - Source (`espn_api/requests/constant.py`) hits `https://lm-api-reads.fantasy.espn.com/apis/v3/games/` with sport code `fba` for NBA; maps also include nhl, mlb, wnba.
  - Private leagues need cookies (`espn_s2`, `SWID`); issue #549 is about these credentials. (README not read in full; cookie requirement from issue titles only, **UNVERIFIED** in detail.)
- `mkreiser/ESPN-Fantasy-Football-API` (https://github.com/mkreiser/ESPN-Fantasy-Football-API): LGPL-3.0, last push 2025-01-04, 10 open issues. Football-focused JS wrapper; lower activity.

## Open items
1. Test Sleeper `/league/<id>` with a real NBA league ID.
2. Read the remainder of Sleeper's terms and ESPN's own terms page.
3. Verify ESPN private-league auth requirements from the wrapper README.
