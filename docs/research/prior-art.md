# Prior art: how Lazy Pundit differs

Research for issue #3. Read on 2026-10-29. Sources are each project's own README, source code and (for ffwrapped) its own site. Code was read at these commits:

| Project | Repo | Commit read | License |
|---|---|---|---|
| Fantasy Football Wrapped (ffwrapped) | https://github.com/kt474/fantasy-football-wrapped | `96e026f` | Apache-2.0 |
| Commish.ai | https://github.com/jeisey/commish | `aacff83` | MIT per its README (no license in repo metadata) |
| uberfastman FFMWR | https://github.com/uberfastman/fantasy-football-metrics-weekly-report | `f5d23ec` | GPL-3.0 |
| power_ranker | https://github.com/rynecarbone/power_ranker | `49c9e52` | MIT |

Citations use `repo:path:line` against those commits. "Not found" means I searched the checked-out source (and README) and found nothing; it is not proof of absence in a private codebase.

## Lazy Pundit's stance (the comparison baseline)

From the task brief: local and CLI-first; deterministic stats; LLM-written prose; human-edited rankings; the human decides every ranking and the tool never fixes one. The repo README currently says only "Turns your fantasy league data into power rankings and weekly recaps written in a pundit's voice... Early planning stage" (`README.md`).

## What each project does

### Fantasy Football Wrapped (ffwrapped)

- A hosted Vue/TypeScript web app for Sleeper and ESPN leagues that turns league data into "power rankings, playoff odds, AI-generated reports, trade insights, and personalized season recaps" (ffwrapped:README.md:6).
- The open-source repo is a frozen copy: "Development of ffwrapped has moved to a private repo" (ffwrapped:README.md:4). The AI backend is not in it: "some features such as AI-generated summaries are hidden behind an API" (ffwrapped:README.md:55). The client just POSTs league data to env-configured endpoints (ffwrapped:src/api/reportGenerationApi.ts:40-100), so what the model is told is not visible.
- Power rankings are a fixed formula in the client: `(avg*6 + (high+low)*2 + winPct*400) / 10` (ffwrapped:src/api/helper.ts:366-378). Ranks are produced by sorting those ratings per week (ffwrapped:src/components/power_rankings/PowerRankingData.vue:85-135). I found no UI for hand-ordering the table in the power-rankings components.
- Premium reports take a `commentaryStyle` (ffwrapped:src/api/reportGenerationApi.ts:102-121) and the README lists "customizable shared Premium reports, shareable images, and video recaps" (ffwrapped:README.md:17). Premium needs sign-in (ffwrapped:src/api/reportGenerationApi.ts:122-127).
- Site: the core analysis "requires no login to start"; premium is optional (https://ffwrapped.com/, fetched 2026-10-29). The homepage copy fetched did not mention AI.

### Commish.ai

- A Streamlit web app (hosted at commish.streamlit.app) that generates weekly recaps for ESPN, Sleeper and Yahoo using OpenAI (commish:README.md:1-7). Features listed: automated recap generation, persona-based storytelling, a trash-talk meter (commish:README.md:25-27).
- Pipeline is stats then LLM: Python helpers build a bullet-list summary (top scorer, biggest blowout, closest game, benched player, etc.; commish:utils/summary_generator.py:172-185), which is interpolated into one prompt asking for a recap "in the style of {character_choice}" with trash talk "level of {trash_talk_level}" and "under 800 characters" (commish:utils/summary_generator.py:44-49). Model is `gpt-4o-mini` (commish:utils/summary_generator.py:60), although the README says GPT-4.
- User inputs are a free-text persona and a 1-10 trash-talk slider (commish:app.py:168-169).
- It does not produce a ranking. The only ordering is "Top 3 fantasy teams" taken from league standings (commish:utils/summary_generator.py:174, :295), not a power ranking.
- Credentials: ESPN needs the user's SWID and ESPN_S2 cookies entered into the hosted app (commish:README.md:13-16).

### uberfastman fantasy-football-metrics-weekly-report (FFMWR)

- A Python CLI app, run via Docker, that "automatically generates a report in the form of a PDF file that contains a host of metrics and rankings" for Yahoo, Fleaflicker, Sleeper, ESPN and CBS leagues (uberfastman:README.md:137-148, :429).
- Its power ranking is the average of three metric ranks: "avg of (weekly score rank + weekly coaching efficiency rank + weekly luck rank)" (uberfastman:ffmwr/calculate/metrics.py:876-902). Ties are detected and marked with `*`, and score ties can optionally be broken with `--break-ties` (uberfastman:README.md:526; metrics.py:437-470).
- Configuration is via `.env` and CLI flags, and "all command line arguments OVERRIDE any settings in the local .env file" (uberfastman:README.md:484, :532). These toggle report sections and tie handling, not individual team placements.
- Output is numbers and tables; LLM mentions: none found. A case-insensitive search for openai/anthropic/gpt/llm across the repo (excluding `uv.lock`) returned nothing. It can upload to Google Drive and post to Slack, Discord and GroupMe (uberfastman:README.md:561-566; `ffmwr/integrations/`).

### power_ranker (rynecarbone)

- A Python package/CLI "for scraping fantasy football stats from ESPN leagues, creating power rankings, collecting previous season standings, and publishing to a website" (power_ranker:README.md:4). Last pushed 2019-11-07; the README's latest update note is 2019-11-06 (power_ranker:README.md:6).
- The ranking is a weighted blend of eight metrics (dominance matrix, iterative least squares, Colley matrix, aggregate win %, consistency, strength of schedule, luck, streak), with default weights in config (power_ranker:power_ranker/docs/ConfigurationDocumentation.md:65-77; power_ranker:power_ranker/league.py:168-169). The doc invites the user to tune weights "if you find the power rankings don't reflect the actual state of your league" (ConfigurationDocumentation.md:65).
- Human prose is a manual step: the generated HTML has a commented-out `FIXME! ... Add your own commentary here!` block the user edits by hand (power_ranker:README.md:66-72). No LLM: a search of the Python source for openai/llm/gpt found nothing.
- It also computes playoff odds by Monte Carlo (power_ranker:README.md:74-75).

## How mine differs

| Axis | ffwrapped | Commish | uberfastman | power_ranker | Lazy Pundit |
|---|---|---|---|---|---|
| Runs where | Hosted web app | Hosted Streamlit app | Local, in Docker (CLI) | Local CLI, publishes static site | Local, CLI-first |
| Who orders the ranking | Formula (helper.ts:366) | Nobody (no ranking) | Formula (metrics.py:876) | Weighted formula (config) | The human |
| Can the human reorder it | Not found | n/a | Not found; flags only affect ties | Only by tuning weights, then re-running | Yes, by design; tool never fixes a ranking |
| LLM prose | Yes, behind private API | Yes, OpenAI | No | No (hand-written block) | Yes |
| What the prose is based on | Not visible (private backend) | Stats summary string in prompt | n/a | n/a | Deterministic stats plus the human's ranking |
| Account or credentials | Optional sign-in; premium needs it | ESPN cookies entered in hosted app | Platform API keys, local `.env` | ESPN login for private leagues (README:27-40) | Local only |

Differences, each tied to the evidence above:

1. **The human owns the ranking; the others compute it.** In all three that rank teams, the order is an output of a formula: ffwrapped's rating (helper.ts:366-378), FFMWR's rank average (metrics.py:876-902) and power_ranker's weighted metrics (ConfigurationDocumentation.md:65-77). The closest to human control is power_ranker's weight tuning, which still lets the formula decide placement after the user picks weights. Lazy Pundit inverts this: stats are inputs to the human's decision, and the human's ordering is authoritative. This is the main differentiator. (I found no hand-reorder feature in any of them, but ffwrapped's private codebase may differ.)
2. **No tool "fixing" a ranking.** The tools above recompute rankings on every run. A design where an edited ranking is never overwritten or "corrected" has no counterpart in what I read. That is a Lazy Pundit design rule, not a feature evidenced elsewhere.
3. **Stats and prose are split, with the LLM only on the prose side.** Commish is the nearest pattern (deterministic helpers build a summary, then one LLM call; summary_generator.py:44-49, :172-185). It differs in that the LLM there has no human-set ranking to narrate, and is asked for persona-driven trash talk with a slider (app.py:168-169). Lazy Pundit's pundit prose would be written about a ranking the human has already fixed, so the model describes decisions rather than making them.
4. **Local and CLI-first, no hosted account.** FFMWR is also local and CLI but ships a PDF of metrics with no LLM prose (README.md:137; LLM search found none). power_ranker is local but dated (last push 2019-11-07) and ESPN-only (README.md:4). ffwrapped and Commish are hosted; Commish asks users to paste ESPN cookies into a hosted app (README.md:13-16).
5. **Scope.** ffwrapped is a broad analytics product (draft grades, trade calculator, video recaps; README.md:12-25). Lazy Pundit's stated scope is narrower: rankings plus recaps, Sleeper and Yahoo first (`README.md`).

## Things worth borrowing

- Commish's explicit "do not simply repeat every single stat verbatim" and length cap in the prompt (summary_generator.py:46-48) are cheap prompt constraints.
- FFMWR's ranking inputs (score, coaching efficiency, luck; metrics.py:876-902) and power_ranker's luck, strength-of-schedule and consistency metrics (ConfigurationDocumentation.md:70-77) are a ready menu of deterministic stats to show the human while they rank.
- power_ranker's pattern of generating output with an explicit slot for human commentary (README.md:66-72) is the same human-in-the-loop idea, applied to prose only.
- FFMWR flags tied ranks visibly with `*` rather than silently breaking them (metrics.py:437-470), which fits "the tool never decides".

## Caveats and gaps

- ffwrapped's AI prompts and any ranking-edit features live in a private repo (README.md:4, :55), so claims about what it does not do are limited to the public snapshot and its site.
- "No LLM" and "no manual override" findings are string searches and code reading, not full audits.
- I did not run any of the tools; everything is from reading docs and source.
