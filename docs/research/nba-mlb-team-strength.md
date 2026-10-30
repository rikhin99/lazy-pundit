# How NBA and MLB fantasy experts judge team strength

Research for issue #21. Read on 2026-10-30. The focus is head-to-head (H2H) **points** leagues where weekly matchups are built from daily lineups, which is how the Yahoo NBA and MLB leagues in the inventory are set up (issue #5).

Sources are platform help pages (Yahoo first, ESPN for contrast), bylined analyst columns, and the source code of open-source ranking tools. Code was read at these commits:

| Project | Repo | Commit read | License | Sport / format |
|---|---|---|---|---|
| Power League | https://github.com/Forestmb/power-league | `f7323800` | BSD-3-Clause | Any Yahoo sport, points |
| Fantasy Basketball Weekly Report | https://github.com/msadahiro/fantasy-basketball-weekly-report | `a8323ea3` | none stated | Yahoo NBA, categories |
| fb-power-rankings | https://github.com/michelmansour/fb-power-rankings | `59eda6e4` | MIT | ESPN MLB, categories |
| y_fantasy (Ruby Yahoo wrapper) | https://github.com/eaylward8/y_fantasy | `24b511e0` | MIT | Yahoo API client |
| yahoo-fantasy-sports-api (Node wrapper) | https://github.com/whatadewitt/yahoo-fantasy-sports-api | `fc66175f` | n/a | Yahoo API client |

"Not found" means I searched and found nothing. It is not proof that nothing exists.

## Short answer

- In H2H points leagues with daily lineups, **volume decides a lot of matchups**. Every expert source says games played (NBA) and starts or plate appearances (MLB) matter as much as talent in a given week.
- Experts treat volume as **partly skill and partly schedule**. Streaming and filling every daily slot is a manager skill. How many games your players' real teams play that week is schedule luck.
- **No source I found adjusts team-level all-play, form or points for games played.** Experts value players per game and then multiply by games. Every open-source team ranker I read uses raw weekly points (or category wins) with no games term.
- Published NBA and MLB fantasy **power rankings of league teams are rare**. What exists leans on results (all-play) in tools, or on roster value in dynasty tools. Weekly expert *player* rankings lean heavily on the schedule.

## 1. Volume: how much games played matters

### NBA

- Players play "anywhere from two to four times in a week", and "sometimes, four games' worth of production out of an average player is more valuable than two games from an elite player." A star with two games may need to sit for an average player with four. (Alex Barutha, RotoWire, on Yahoo Sports, 2018-10-03: https://sports.yahoo.com/play-yahoo-fantasy-basketball-complete-rundown-strategies-popular-formats-230508852.html)
- A player half as good as LeBron James can match him by playing twice as many games. Rank players by per-game average, then factor in the risk of missed games. Games played in the fantasy finals "matter even more than opponents". (Tom Carpenter, ESPN, 2020-11-16: https://africa.espn.com/fantasy/basketball/story/_/id/20631092/fantasy-basketball-points-league-strategy)
- In weekly-lock leagues the format "puts tremendous importance on the number of games played each week". (Ryan Knaus, NBC Sports / Rotoworld, 2018-10-04: https://www.nbcsports.com/fantasy/basketball/news/article-numbers-game-nba-official-scoring-h2h-pts). Note: this is the weekly-lock variant, not daily lineups, but the volume point carries over.
- Week lengths are not fixed. "For default Yahoo! fantasy leagues, Week 17 consists of two actual weeks because of the All-Star break", and that week ran 3 to 5 games per NBA team. (Raphielle Johnson, NBC Sports, 2026-02-08: https://www.nbcsports.com/fantasy/basketball/news/fantasy-basketball-week-17-schedule-primer-at-long-last-the-all-star-break-is-here)
- Playoff weeks are judged by games: "A five-game week ... provides a significant advantage" and "A two-game week for star players ... can be detrimental". Back-to-backs are called "a major variable in fantasy performance". (Joel Bartilotta, RotoWire, 2025-09-16: https://www.rotowire.com/basketball/article/nba-schedule-tips-for-winning-fantasy-basketball-96161)
- Volume is the format's appeal: "The joy of points leagues is the sheer value volume." Players usually "play three or four games" a week. (Jim McCormick, ESPN, 2026-09-30: https://global.espn.com/fantasy/basketball/story/_/id/38604409/pros-cons-points-roto-category-leagues-nba-2023-24)

### MLB

- "The more chances a player has to score points, the more likely they are to score points." Top-of-order hitters gain value, and two-start pitchers "take on added importance for the same reasons". "Most points formats are weekly head-to-head matchups." (Dan Marcus, RotoWire, 2024-03-29: https://www.rotowire.com/baseball/article/points-leagues-primer-and-week-1-overview-81200)
- An ace with a two-start week means "it's likely not to be close". "You need to be in the lineup on a weekly basis to earn your keep." (AJ Mass, ESPN, 2016-02-18: https://africa.espn.com/flb/story/_/page/mlbdk2k16_masspointsstandouts/how-build-head-head-points-fantasy-baseball-roster-fantasy-mlb)
- Reader comments on a Hardball Times points primer add that "every slot on your roster needs to be getting you points every day" and suggest rotating two-start pitchers. These are commenters, not the author, so treat them as practitioner colour. (Ben Pritchett, The Hardball Times, 2011-02-21: https://tht.fangraphs.com/preparation-h2h-points-based/)

## 2. Volume is partly skill and partly schedule

**Skill side.** Streaming means "swapping out one-to-three players each week" who have a favourable number of games (Barutha, above). Marcus says to "maximize volume according to your league settings" (above). With daily lineups, a manager who leaves slots empty or starts players with no game loses volume their opponent keeps.

**Limits on that skill, from Yahoo's own help pages:**

- Yahoo H2H leagues have **no maximum games played**. "Head-to-Head leagues have no max limits" for basketball positions (https://help.yahoo.com/kb/SLN6784.html). For baseball, "Max games played and pitcher inning limits aren't available for Head-to-Head Leagues" (https://help.yahoo.com/kb/SLN6809.html).
- Yahoo NBA default H2H points settings: daily roster changes, **4 acquisitions per week**, playoffs in weeks 20–22 with 6 teams (https://help.yahoo.com/kb/SLN6919.html). So streaming volume is capped by the weekly acquisition limit, not by games.
- Yahoo MLB default H2H points settings: daily roster changes, **6 acquisitions per week**, a **minimum innings pitched per week** (https://help.yahoo.com/kb/SLN6785.html).
- The default minimum is inconsistent across Yahoo's pages. SLN6809 says public leagues default to **7** innings. SLN6785 lists **20**. Private commissioners can change it. SLN6809 says missing it means you "automatically lose all the pitching categories", which is category language. What it does in a points league is not stated. Read the league's own settings.
- Yahoo's H2H scoring page: "Each week is considered a Game Week", the higher points total wins, and "Your W-L-T record determines your standings" (https://help.yahoo.com/kb/sln6212.html).

**Contrast with ESPN.** ESPN basketball has a per-matchup **games-played limit** ("the limit for a standard matchup", 7 days, scaled for longer or shorter matchups; e.g. 42) (https://support.espn.com/hc/en-us/articles/360056369011-Games-Played-Limit). So whether volume can be raised without limit is a league setting, not a fact of the sport.

**Schedule side.** How many games a player's real team plays in a matchup week is outside the manager's control, and week lengths vary (All-Star weeks, opening weeks). Bartilotta and Carpenter both treat the playoff-week schedule as a major factor beyond the manager's control.

**A format that removes volume.** Yahoo's High Score format (launched 2025-10-01) counts only each starter's best single game of the week, so extra games add nothing (https://www.yahooinc.com/press/yahoo-sports-and-nba-launch-new-simpler-season-long-fantasy-basketball-game-yahoo-fantasy-high-score). Yahoo's stated reason is simplicity and less lineup work, not fairness. If a league ever uses it, the games-played question goes away.

## 3. Do experts adjust all-play, form or points per game for games played?

**Not found.** No column, help page or tool I read divides a team's weekly score by games played to judge team strength.

- Experts value **players** per game and then multiply by expected games (Carpenter, Barutha). At the **team** level they judge results on raw weekly points.
- **Power League** (Yahoo, any sport) ranks on raw weekly points only. Its schemes are all-play ("what their record would be if they played every other team", `rankings/schemes.go:179-182`), total points (`:264-266`) and victory points (a win for beating half the league, `:107-110`). It also uses Yahoo's projected points for remaining weeks (`rankings/rankings.go:172-205`). There is no games-played term.
- **Fantasy Basketball Weekly Report** (Yahoo NBA, a categories league) computes weekly all-play on category win rate, then a power score of `seasonRate * 0.6 + recentRate * 0.4`, where recent is a 1-2-3 weighted average of the last 3 weeks (`src/rankings/powerRankings.ts:48-58`, `src/rankings/yahooPowerRankings.ts:53-66,154-158`). No games term. This is close to the issue #8 blend (all-play plus form).
- **fb-power-rankings** (ESPN MLB, categories) uses "aggregate winning percentage", meaning the all-play record over a week or a season (`README.md`, Methodology). No games term. The author says he sometimes adds "a witty comment" by hand, like Lazy Pundit's pundit.

**What the data would allow.** Yahoo's team stats can carry a `team_remaining_games` block with `completed_games`, `live_games` and `remaining_games`, next to `team_points` and `team_projected_points`. This comes from two third-party wrappers (y_fantasy `lib/y_fantasy/resources/team/stat_collection.rb`; yahoo-fantasy-sports-api `helpers/teamHelper.mjs:81-95` and its 5.4.0 changelog), not from Yahoo's own docs. Yahoo's basketball stat list includes GP (Games Played) (https://help.yahoo.com/kb/SLN6928.html). Whether these fields come back for the user's NBA and MLB points leagues, and whether `completed_games` counts started player-games, is **unverified** until the Yahoo fixtures exist.

## 4. Signal and noise

What the sources treat as **signal**:

- Per-game production of the rostered players, and roles that guarantee minutes or plate appearances (Carpenter: "guaranteed, steady roles").
- Games available: health and schedule. Injury risk counts for more in H2H points (Mass).
- Volume management: streaming and filling daily slots (Barutha, Marcus).
- MLB pitching volume: two-start weeks and strikeouts. K/BB under 3.00 is a concern (Mass).
- MLB hitting: walks count like hits, so OBP matters and batting average is "fairly irrelevant in points leagues" (Mass).

What they treat as **noise** or luck:

- **Opponent draw.** "The luck of the draw of the schedule is THE biggest factor in determining which teams make the playoffs" (malamoney, Razzball, 2016-06-17, H2H points baseball: https://razzball.com/get-the-luck-outta-here/). He uses total points scored as the truer measure. This matches the issue #8 choice to leave points against out of the starting order.
- **Single weeks.** Strong rosters get "felled by a single bad week in the fantasy playoffs" (McCormick). A long NBA season reduces volatility overall.
- **A light schedule week** for a good roster is noise about roster quality but real for that week's result. None of the sources separates these at team level.

## 5. What published power rankings lean on

- **Tools lean on results.** All three open-source rankers above use all-play on weekly results, plus recent form in one case.
- **Dynasty tools lean on roster value.** HarryKnowsBall (Yahoo and Fantrax, baseball) ranks league teams by "aggregating crowdsourced player and pick values for each team". Record and schedule play no part (https://harryknowsball.com/faq).
- **Expert weekly content leans on schedule.** RotoWire's weekly NBA player rankings "primarily factor in number of games played for the week, current player trends and pertinent information about the team" (Eric Johnson, 2016-10-23: https://www.rotowire.com/basketball/article/nba-weekly-player-rankings-week-1-30116). ESPN's Forecaster columns rate each NBA team's weekly schedule 1–10 and list games per team. CBS and others publish weekly two-start pitcher rankings.
- **Not found:** a bylined analyst column that publishes power rankings of the teams in a fantasy NBA or MLB league, or a platform help page that documents an in-app power-ranking formula for these sports (Fantrax's was searched for and not found).

## What this means for the power-score ticket (not a decision)

- Raw weekly points, and so raw all-play, mix roster quality with volume. Volume is partly manager skill and partly schedule luck, so neither "use raw points" nor "divide by games" is clearly right. The sources do not settle it.
- One option to put to the user: compute all-play and form on raw points (what the league's results are), and show points per game played beside them as a stat in the editing view. Do this only if Yahoo supplies games played.
- Matchup weeks vary in length (All-Star and opening weeks), so any per-week average needs the week's length or games to be comparable.

## Not verified

- Whether Yahoo returns `team_remaining_games` or a team-level GP for the user's NBA and MLB points leagues, and what exactly it counts.
- What Yahoo's minimum-innings rule does in a points league (its help text speaks of categories). The two help pages also disagree on the default (7 vs 20).
- Unfetched search results (FantasyPros, CBS, Fantasy Six Pack primers) were not used as sources.
