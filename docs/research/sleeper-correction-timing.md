# Sleeper scoring and stat-correction timing

Issue: rikhin99/lazy-pundit#27. Researched 2026-10-30. Items marked **UNVERIFIED** could not be confirmed from a primary source. Items marked **INFERENCE** are my reading, not a stated fact.

## Summary

- Sleeper documents no timing for `last_scored_leg`. The field is not in the API docs at all. When it advances after Monday night is **UNVERIFIED**.
- Sleeper's help center says stat corrections can land "up to and including Thursdays", with most by Monday and Tuesday. It also says a matchup is not final just because the weekly report has posted.
- Sleeper exposes no "corrections done" signal in the API. The only end point is Sleeper's own "Thursday" wording.
- Whether a correction flips a win or loss automatically is **UNVERIFIED**. A commissioner help page lists "a late-stat correction" as a reason to recalculate a week's matchup records, so a flip may need a commissioner action.

## 1. When `last_scored_leg` advances

### Verified
- The Sleeper API docs (https://docs.sleeper.com/) do not mention `last_scored_leg`. The league object's `settings` is shown only as a `{ settings object }` placeholder.
- The docs describe `/state/<sport>` fields as: `week`, `leg` ("week of regular season"), `season_type`, `season`, `previous_season`, `season_start_date`, `league_season`, `league_create_season` ("flips in December"), and `display_week` ("Which week to display in UI, can be different than week"). None of them is documented as a scoring or finality signal.
- The live `state/nfl` response on 2026-10-30 has one extra, undocumented field: `season_has_scores: true`. This is a season-level flag, not a per-week one.
- Fixtures on `fixtures/raw` were committed Friday 2026-10-30 at 10:00 -0600. (The ticket calls this Thursday of week 8. 2026-10-30 is a Friday; Thursday Night Football had already been played.)
  - `fixtures/raw/sleeper/state_nfl.json`: `week: 8`, `leg: 8`, `display_week: 8`.
  - `fixtures/raw/sleeper/fantasy-g-league-2026/league.json`: `settings.last_scored_leg: 7`, `settings.leg: 8`, `status: in_season`.
  - `matchups/week_08.json` already has non-zero `points` (for example 47.92, 22.9) from the Thursday game, while `last_scored_leg` is still 7. So matchup points move live during a week, and `last_scored_leg` lags them.
  - `fixtures/raw/sleeper/fear-the-turtle-2025/league.json` (finished season): `last_scored_leg: 17`, `leg: 17`, `status: complete`.

### Not found
- No Sleeper doc or help article says when `last_scored_leg` moves (Monday night, Tuesday morning, or later). A single snapshot cannot show it either. Week 7's last game was Monday 2026-10-26, and by Friday the field read 7. That is all the fixtures prove.
- Next step, if it matters: poll `/league/<id>` hourly from Monday night to Wednesday of one week and log when `last_scored_leg` changes.

### Inference
- `last_scored_leg` probably advances once the week's last game ends and Sleeper's scoring pass runs, not after corrections finish. Sleeper's own help says corrections continue to Thursday, and nothing suggests the field waits for them.

## 2. NFL stat corrections

### Verified
- Sleeper, "Stat Corrections" (https://support.sleeper.com/en/articles/2441282-stat-corrections):
  - The article opens with "When is a matchup considered final?"
  - "Our data provider will update stats throughout live games", then runs corrections over the following days.
  - "Corrections can occur up to and including Thursdays, although most are likely to happen by Monday and Tuesday."
  - The weekly report "does not imply that your matchup is final and corrections can occur after that is posted."
  - Sleeper's corrections do not always match the NFL's public correction list. When its provider pauses or misses something, it makes its own corrections to match official NFL stats.
  - In the app: league tab, settings, "Stat Corrections". "We only display stat corrections specific to the starters in your league." No API endpoint for this list is documented.
- Sleeper, "Recalculate matchup records" (https://support.sleeper.com/en/articles/12076832-recalculate-matchup-records): commissioners can apply "a scoring change such as a late-stat correction" by recalculating the week's matchup scores (Commish, Edit Matchup Scores, "Recalculate all matchup records for week ___").
- Sleeper, "Adjusting weekly lineups/scores" (https://support.sleeper.com/en/articles/9786258-adjusting-weekly-lineups-scores): for the current week, commissioners must wait "until the final game of the week has been completed". After an edit, records "may not reflect this change immediately" and "will update on their own when they re-sync automatically overnight."
- Sleeper API docs: matchup `points` is "total points for team based on league settings". `custom_points` is set "if commissioner overrides points manually".
- Elias Sports Bureau, the NFL's official statistician (https://www.esb.com/contact-us): "We do not field NFL stat correction inquiries via this contact form." It points to NFL Fantasy's stat corrections page for past corrections. That page (https://fantasy.nfl.com/research/statcorrections) now 301-redirects to a general NFL fantasy news page.
- For comparison, Yahoo (https://help.yahoo.com/kb/SLN6137.html): in public leagues, "we must receive the stat corrections by Thursday morning" for them to count in the previous week.

### Not found
- An official NFL or Elias statement of the weekly correction schedule. Search snippets and forum posts say Elias reviews plays with the NFL on Wednesdays and corrections go out Wednesday or Thursday. The Elias page I fetched does not say this, so the weekday is **UNVERIFIED**.
- Whether Sleeper recomputes wins and losses on its own when a correction changes matchup points. The help pages say neither yes nor no.

### Inference
- Corrections change player stats, so they change `players_points`, `starters_points` and matchup `points`. A correction can therefore change who scored more in a matchup. The "matchup is not final" wording points the same way. The week-7 Fear The Turtle correction recorded in #17, which flipped the high score, shows points do move after the week is scored.
- Whether the win/loss record follows is the open part. The recalculate page suggests a late correction may need a commissioner recalculation, or at least the overnight re-sync, before records change. Lazy Pundit computes results from `points`, so it would see a flip as soon as points change, even if Sleeper's standings lag.

## 3. A "corrections done" signal

### Verified
- None in the documented API. No field in `state/nfl`, the league object or matchups says corrections are finished. `last_scored_leg` is not documented as one.
- The only stated end point is Sleeper's help text: "up to and including Thursdays".

### Inference
- A practical cut-off is the Friday after the week. Sleeper gives no guarantee, and its own provider can make extra fixes, so treat Friday as "usually settled", not final.

## Suggested reminder wording

> Week 7 is scored. Stat corrections can still change points until about Thursday, and can flip a result. Run `refresh` before you publish.

Shorter, for a status line:

> Scored. Corrections may land through Thursday.
