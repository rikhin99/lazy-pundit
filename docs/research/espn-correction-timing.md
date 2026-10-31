# ESPN scoring and stat-correction timing

Issue: rikhin99/lazy-pundit#29. Researched 2026-10-31. Items marked **UNVERIFIED** could not be confirmed from a primary source. Items marked **INFERENCE** are my reading, not a stated fact. Community sources are marked **LOWER TRUST**.

## Summary

- ESPN updates standings once a night, "normally by 3 am EST the following morning". So a week's `winner` and final `totalPoints` most likely appear in the nightly run after Monday Night Football, early Tuesday Eastern time. No page says when `winner` is set, and nobody has timed it, so that's **INFERENCE**.
- No field in `lm-api-reads` says a week is final. "Scored" means `winner` is not `UNDECIDED`. `status.standingsUpdateDate` timestamps the nightly run and is the closest thing to a scoring clock.
- ESPN says NFL stat corrections can appear up to seven days after a game, and that the system stops making corrections "the Saturday following the week of the game in question". It also says corrections show up automatically in Box Score and Standings. So corrections still apply after a winner is set, and they can flip a result.
- ESPN exposes no "corrections done" signal. The only end point is the Saturday deadline in its help text.

## 1. When the winner and final `totalPoints` are set

### Verified
- ESPN Fan Support, "Updated Standings" (Fantasy Football > Managing Your League, updated 2026-06-16, https://support.espn.com/hc/en-us/articles/360000095931-Updated-Standings): "Your league standing, playoff seeding, waiver order and everything else league-related is updated every night, normally by 3 am EST the following morning". It adds that FantasyCast shows "point scoring stats in real-time as the games unfold".
- The fixtures on local branch `fixtures/raw` were pulled Saturday 2026-10-31, in week 8, with games still to come. In all three 2026 leagues:
  - `status.currentMatchupPeriod: 8`, `status.latestScoringPeriod: 8`, `status.finalScoringPeriod: 17`. These name the current week. Neither says whether a past week is final.
  - `status.lastUpdateInfo.source: "NightlyLeagueUpdateTaskProcessor"` (platform `lm-processor`).
  - `status.standingsUpdateDate` and `status.waiverLastExecutionDate` are 2026-10-31 between 07:41 and 07:53 UTC, which is 03:41–03:53 EDT. That matches the nightly run in the help article.
  - Week 8 matchups in `schedule.json` have `winner: UNDECIDED`, `totalPoints: 0` and no `pointsByScoringPeriod`. The live points are only in the box score views (mMatchupScore). Weeks 1–7 have `HOME`/`AWAY` winners and `pointsByScoringPeriod` set.
- The finished Football Fam 2025 season reads `currentMatchupPeriod: 17`, `latestScoringPeriod: 19`, and `standingsUpdateDate` 2026-01-05 08:32 UTC. So `latestScoringPeriod` can run past the last fantasy week and can't be used as a "last scored week" counter like Sleeper's `last_scored_leg`.

### Not found
- No ESPN help page or article says when a matchup's `winner` changes from `UNDECIDED`, or when `totalPoints` stops reading 0. A single snapshot can't show it.
- ESPN does not document the `lm-api-reads` API at all.

### Inference
- `winner` and `totalPoints` are probably written by the same nightly job that writes standings. After Monday night's game, that run lands around 03:00–04:00 Eastern on Tuesday. Before that run, the week reads as in progress even though every game is over.
- **Follow-up:** re-pull week 8 for one fixture league on Tuesday 2026-11-03 and on Friday 2026-11-06. Record `winner`, `totalPoints`, `pointsByScoringPeriod` and `status.standingsUpdateDate`. Tuesday's pull checks when the winner gets set. Friday's pull shows whether any score moved after the winner was set.

## 2. NFL stat corrections

### Verified
- ESPN Fan Support, "Scoring & Stat Corrections" (Fantasy Football > Managing Your League, updated 2026-08-18, https://support.espn.com/hc/en-us/articles/360000099732-Scoring-Stat-Corrections):
  - Live scoring: "Each player's individual points and stats will be accurately reflected once the game is final."
  - NFL post-game adjustments: "This type of stat correction can appear up to seven (7) days after the game was played."
  - ESPN feed errors: "Most of the time when inaccurate data is detected, the incorrect score/stat is corrected within minutes. Rarely, incorrect scores/stats may not be corrected until the next day." These can also appear up to seven days later.
  - "The deadline for all weekly scoring or stat corrections made by the system during the season is the Saturday following the week of the game in question."
  - "Any changes entered in the system will automatically reflect in both your Box Score and your Standings pages."
  - Only official NFL post-game corrections appear on https://fantasy.espn.com/football/statcorrections. ESPN's fixes to its own bad feed data don't.
  - If an LM has already used Adjust Scoring to fix the same stat, the automatic correction gives the team "double credit", and the LM has to reverse the manual change.
- ESPN Fan Support, "Adjust Scoring (LM Only)" (Fantasy Football, https://support.espn.com/hc/en-us/articles/47160137571988-Adjust-Scoring-LM-Only): "If the score adjustment changes the matchup results (e.g., from a win to a loss), the standings page will automatically update to reflect the adjusted results." The box score marks the change with an asterisk. In the payload this is the matchup side's `adjustment` field (see #26).
- ESPN Fan Support, "What happens if a professional game is suspended then resumed at a later date?" (Fantasy Football, https://support.espn.com/hc/en-us/articles/360047750711): a game resumed within seven days counts for the original scoring period, "even if the resumption of the suspended game occurs within the next matchup period". The page calls this "consistent with how other Stat Corrections are handled". The points "will appear overnight the day the game concludes".
- ESPN Fantasy, "Stat change: Big Ben threw TD pass" (Fantasy Staff, 2012-10-10, https://www.espn.co.uk/fantasy/football/ffl/story?id=8487835): an NFL correction to a Week 5 game "will be processed Thursday morning in all ESPN leagues". This is old, but it is a first-party example of a correction landing after the week was scored.
- Elias Sports Bureau, the NFL's statistician (https://www.esb.com/contact-us), doesn't publish a correction schedule (see the Sleeper research, #27).

### Not found
- No official NFL or Elias statement of the weekly correction schedule. The claim that Elias reviews on Wednesday and corrections land Wednesday night or Thursday comes from fantasy forums (for example, https://forums.footballguys.com/threads/stat-corrections-week-14.700869/), so it is **LOWER TRUST** and **UNVERIFIED**.
- No ESPN page says in so many words that "a correction can flip a matchup".

### Inference
- Corrections apply after the winner is set. "Automatically reflect in ... your Standings pages" means the system recomputes win and loss, not just points. So a correction can flip a matchup, and ESPN's own record follows. That's unlike Sleeper, where a commissioner may need to recalculate.
- **LOWER TRUST** community reports agree: a forum thread describes an ESPN championship flipping after a team sack was removed (https://www.tigerdroppings.com/rant/fantasy-sports/championship-reversing-stat-correction-dilemma/122164394/).
- The two ESPN windows don't quite match. "Up to seven days after the game" would reach the next Monday for a Monday night game. "The Saturday following the week" ends sooner. Read together, corrections can change week N until the Saturday after it, and the nightly run that follows (early Sunday Eastern) is the last one that writes them.

## 3. A "corrections done" signal

### Verified
- None in the payloads seen. Nothing in `status`, the matchup or the team says corrections are finished. `standingsUpdateDate` only says when the nightly job last ran. `isActive` and `isExpired` are league-level flags.
- The only stated end point is the help text: "the Saturday following the week of the game in question".
- The stat corrections page (https://fantasy.espn.com/football/statcorrections) lists official NFL corrections for people to read. No API for it is documented, and I didn't check whether its data comes from `lm-api-reads`.

### Inference
- A practical cut-off is Sunday morning after the following Saturday, after that night's run. Feed-error fixes can land earlier and without notice, so before then treat the week as "scored, may still change".

## Suggested reminder wording

> Week 7 is scored. Stat corrections can still change points, and flip a result, until about Saturday. Run `refresh` before you publish.

Shorter, for a status line:

> Scored. Corrections may land through Saturday.
