# Prior art landscape: who else turns fantasy league data into rankings, recaps and commentary

Research date: 2026-10-30. Scope goes beyond the four tools already read (ffwrapped, FFMWR, power_ranker, Commish.ai).

Method: official help pages, product pages (including raw HTML and shipped JS bundles where the page is a single-page app), App Store listings, and GitHub READMEs and code pinned to a commit SHA. Every claim has its source URL. **[Unverified]** marks things I could not confirm from a primary source. Vendor pages are marketing. They show what is claimed, not what works.

---

## 1. Short answer

- **Platforms (Sleeper, Yahoo, ESPN):** none of them produces a power ranking a human can reorder. Sleeper and Yahoo post an automated stats or awards report to league chat. Yahoo also writes LLM matchup and draft recaps ("powered by ChatGPT"). ESPN's AI is advice only (IBM watsonx grades, Auto Control). It has no recaps and no league power rankings.
- **The market has grown since the earlier read.** For the 2026 season at least a dozen hosted products write AI recaps or league media: Commish HQ, The Bench Press, LeaguePulse, GameDayBot Elite, CommishCast, League Rewind, LeagueBeat, The Front Office, SmackScript, League Legacy, Sleeper Manager AI, NFL Fantasy Edge, LeagueLogs and ffwrapped. Several of them take **league lore** as input: Commish HQ, The Bench Press, LeaguePulse (self-host), PeregrineCode and tfadp.
- **One product already does "the human ranks, the tool writes the prose with league lore": MMT HQ (mmt.football, Checkmate Labs LLC).** It computes a power score and lets the commissioner reorder the list with ↑/↓. It drafts AI "takes" with the commissioner's own OpenAI, Anthropic or xAI key, and takes per-manager "voice notes … inside-joke fuel". The commissioner reviews, edits and publishes. It is hosted, NFL-only, ESPN and Sleeper (Yahoo by manual entry), and free during beta. Evidence is in §5.
- **Lazy Pundit's open space has shrunk to:** local-first, CLI, no hosted account, Yahoo by API, NBA and MLB, a ranking that is human-only with no default formula order, and a persona voice. No product I found combines local, CLI, multi-sport and human-ranked.
- **DIY is common.** GitHub has a long tail of zero-star personal "AI recap" repos created in 2026 (§4). MCP connectors (Flaim, League Loom, FantasyBot) now let anyone pipe league data into ChatGPT or Claude and do it by hand.

---

## 2. What the platforms build in

### Sleeper: "Weekly Report" (the stats source pundits read today)

- Source: Sleeper help article "League History and Weekly Reports" (by Sleeper HQ, updated 2026-09-22): https://support.sleeper.com/en/articles/3204499-league-history-and-weekly-reports
  - Text: "Weekly Reports are given out each week for ultimate shaming or bragging rights." Under "Weekly Reports with Awards": "It's posted in the league chat every week."
- **Exact contents**, read from the screenshot on that page (image `2685613796/.../image.png` on downloads.intercomcdn.com, "Weekly Report · sleeper · WEEK 4"):
  1. **Best Team** and **Worst Team**: team, @user and weekly points (example: 163.96 vs 104.50).
  2. **Players of the Week**: one per position (QB, RB, WR, TE, K, DEF), with points, NFL opponent and the manager who started them.
  3. **Benchwarmers of the Week**: the highest-scoring benched player per position (QB, RB, WR, TE), with points, opponent and owner.
  4. **League Awards** (cards):
     - Most Efficient Manager and Least Efficient Manager (points vs "max points", the optimal lineup)
     - Highest Pts in Loss and Lowest Pts in Win (with opponent and score)
     - Biggest Blowout and Narrow Victory
- It has **no power ranking, no prose and no AI.** It is a fixed card of stat awards.
- **[Unverified]** whether the screenshot shows every card (it ends at Biggest Blowout and Narrow Victory). Also unverified: whether Sleeper NBA, and MLB if Sleeper offers it, get the same report.
- Same article, **League History**: League Champs, All-Time Standings, All-Time Weekly High Scores, All-Time Player High Scores, Playoff Brackets, Toilet Bowl / Consolation Brackets. The second screenshot shows champs and all-time W%/PF/PA/transactions.
- **Sleeper AI:** I found no Sleeper-built AI recap, power ranking or trash-talk feature. Sleeper's product page lists league chat, matchups, SleeperZone and the Trade Center (https://sleeper.com/fantasy-football). **[Unverified]** that nothing exists. I found no Sleeper changelog or blog to rule it out.
- The Sleeper API does not expose league chat. This is a constraint for any tool wanting chat-derived lore (stated in the etanetan/weekly-league-recap README, §4. **[Unverified]** against Sleeper docs).

### Yahoo Fantasy

- **Weekly League Recap:** "posted in league chat every Tuesday morning". It covers the whole league: top performers at each position, biggest disappointments, high scorers left on the bench. No AI is mentioned. https://help.yahoo.com/kb/SLN37123.html
- **Draft and matchup recaps (LLM):** Yahoo's help page says these recaps are "powered by ChatGPT" and "auto-generated". Each is "a brief summary and graphical based content" with a headline and summary. Users can report offensive output; the recap is then hidden until reviewed. https://help.yahoo.com/kb/sln36411.html. Sports covered and launch date: **[Unverified]** (not stated).
- **Game Breakdowns (beta):** AI summaries of real NFL games for Fantasy Plus subscribers, not league recaps. https://help.yahoo.com/kb/fantasy-sports-app-for-android/overview-game-breakdowns-beta-yahoo-sports-sln37188.html
- **2026 "29 Days of Fantasy":** 29 new features (Record Book, Death Leagues, Fantasy Ultra tier, Swipe the Starter and others). None is an AI recap, power ranking or chat feature. https://football.fantasysports.yahoo.com/f1/signup/29days
- No Yahoo league power-ranking feature was found. An old 2018 Yahoo/Roto Arcade piece recommends power rankings and treating your league "as if it's the most important league in the world", which is an advice article: https://sports.yahoo.com/tips-improving-fantasy-league-team-power-rankings-recaps-005105775.html?src%3Drss

### ESPN Fantasy

- **2026 features** (press release, 2026-08-03): Knockout leagues, Fantasy Achievements, live activities, Matchup Moments, win-probability charts, league bundles, NFL Fantasy migration (ESPN is now the official NFL fantasy game). **No AI, recap, power ranking or chat feature.** https://espnpressroom.com/press-release/espn-fantasy-football-celebrates-being-named-official-fantasy-game-of-the-nfl-with-new-features-games-campaigns-and-more/
- **2025 features** (2025-08-07): personalised home, roster dashboard and similar. No AI recaps. http://espnpressroom.com/press-release/espn-fantasy-football-30th-anniversary-new-design-new-features-all-new-fantasy-app-for-2025/
- **AI that exists is advice, not commentary.** The IBM watsonx Waiver Grades, Trade Grades and Trade Analyzer use Granite-generated "Top Contributing Factors" bullets: https://newsroom.ibm.com/2024-09-10-ibm-brings-next-generation-of-ai-powered-insights-to-espn-fantasy-football-platform. "Auto Control" hands a team to AI: https://support.espn.com/hc/en-us/articles/8181547483924-How-to-activate-Auto-Control-AI-Team-Management-LM-Leagues-only
- **Chat:** ESPN Fantasy Chat for league-manager leagues: https://support.espn.com/hc/en-us/articles/9628529093908-ESPN-Fantasy-Chat-Basics-LM-Leagues-Only. The League Manager's note is a free-text board the commissioner writes (secondary source: https://africa.espn.com/fantasy/basketball/story/_/id/20804379/league-team-pages).
- **[Unverified]** whether the ESPN app shows any in-league "power rankings" page. I found no official source either way.

---

## 3. Hosted apps and websites

Ordered roughly by closeness to Lazy Pundit.

### MMT HQ (mmt.football, Checkmate Labs LLC): the closest match
- Source: the homepage HTML and its JSON-LD, plus the shipped JS bundles `/assets/index-zqf11LZA.js`, `/assets/power-rankings-DrLuaaZP.js`, `/assets/power-rankings-generator-CKO1wnVu.js` and `/assets/league-settings-OakOSfEI.js`, fetched 2026-10-30. The site is a single-page app, so the quotes below are UI strings from those bundles.
- JSON-LD feature list: "Personal weekly power rankings from available final scores", "Commissioner review and publishing of custom takes", "ESPN and Sleeper scores and league history sync", "NFL.com archived records and standings import", "Reviewed Yahoo and other manual scores with CSV support", "Optional AI drafting; separate provider charges when using your own key". Price: "Free during beta".
- **Ranking control:** "Use ↑/↓ on the rank cards below to reorder the rankings. Power-score tiers stay with each team." Also: "The commish can reorder and add comments without changing a team's power score or tier; anything left blank keeps its automatic take." And: "The commish hasn't published this week, so teams are ordered by power score and each one gets an automatic take."
  - The default order is a formula: "The three strength measures are standardized across the league, blended, and scaled by 15 points. Wins, losses, and schedule luck do not enter the formula" (recent form is weighted 20/30/50%).
  - The human can override the order.
- **Prose and lore:** "Voice notes per manager (inside each card below) get woven into the roast — write a sentence or two of inside-joke fuel. Saved to your league." It also has selectable "voices", with a consent prompt for "permission to use their name and voice for AI commentary. Every take will be labeled AI."
- **Review gate:** "I've checked the names, scores, and historical claims." "Edits require another review." "Check the names, scores, and takes. Edit in your league's voice, then publish." "You can write and publish takes yourself."
- **LLM:** BYO key, with providers `openai` (default), Anthropic (`sk-ant-`) and xAI/Grok in the settings bundle. "AI is optional: your league shows whether an included first draft is available. Further drafts use your provider key, billed separately."
- Platforms: ESPN and Sleeper sync, Yahoo by manual or CSV scores, NFL.com history. NFL only. Web, iPhone and Android. Hosted. Leagues are private by default with a share link. Licence: proprietary.
- Also: weekly awards (most and fewest points, most points left on the bench), league votes, rivalry records and a "Season Wrapped".

### Commish HQ (commishhq.ai)
- Source: https://commishhq.ai/ (FAQ text from the shipped Next.js chunk).
- Says "Now live — ready for the 2026 season". $7.99/month for up to 3 leagues, with a 7-day trial. Sleeper and ESPN only. Delivers to **Telegram** ("Support for more chat platforms is on the way").
- Nine content types: recaps, **power rankings** ("ranked graphic … with weekly movement and commentary"), previews, Matchup of the Week, trade grades, PDF newsletter, AI podcast, posters.
- **Lore:** "Our RAG memory system ingests your league history — rivalries, inside jokes, nicknames, and past results." Also "Tone learning from your group chat".
- **Editing:** "Every piece of generated content goes through an approval step where you can edit, tweak the tone, or regenerate before it's delivered." **[Unverified]** whether the ranking *order* can be changed or is set by the AI. LLM not named.

### The Bench Press (thebenchpress.app; source alexeldeib/fantasy-recap)
- Source: README and code at commit `2bc4582fb437c2df34d6a3ac078885262cbcc713`: https://github.com/alexeldeib/fantasy-recap. Repo created 2026-10-02, no licence file. The site answered HTTP 200 on 2026-10-30.
- Sleeper NFL only. $25 season pass. Weekly recap with headline, column, "power rankings with a take on every team", 15 trophies and a game-day quick hit.
- **Ranking is formula-driven:** in `worker/src/facts.ts`, "Power rankings: season all-play win rate, then points for."
- **Lore:** the commissioner editor has a "League lore" box: "One per line, up to 40 lines of 300 characters: in-jokes, rivalries, nicknames, past champions. The writer works them into the next recaps." The commissioner can edit every copy line after it is generated.
- **LLM:** Claude Opus 5.5 (`claude-opus-5-5` in `writer.ts`) via the Batch API. The README measures about $0.48 per weekly recap and about $12.50 of Claude per league per season. Hosted on Cloudflare Workers.

### LeaguePulse (leaguepulse.io; source ebrown-32/LeaguePulse)
- Source: README at `3a6f0a7778108c5960667d7d8a12ed816b341a22`: https://github.com/ebrown-32/LeaguePulse. 16 stars, licence FSL-1.1-ALv2 (source-available, becomes Apache later). Created 2024-12, pushed 2026-10-30.
- Sleeper and ESPN NFL. A league website with a record book, rivalries and "AI beat writers": "columns, power rankings, predictions, matchup previews … Every claim is checked against the league's real record before it publishes."
- Price: League Pass $39/yr, League Pass + AI $79/yr. Self-host is free with your own Anthropic key.
- LLM: Claude (`ANTHROPIC_API_KEY`). **[Unverified]** how power rankings are ordered (AI-written vs formula) and whether lore can be entered.

### GameDayBot (gamedaybot.com; managed version of dtcarls/fantasy_football_chat_bot)
- Source: https://www.gamedaybot.com/ and the README at `1ae2440916c2d55e6cf1fe25bf4ace5a852921f8`: https://github.com/dtcarls/fantasy_football_chat_bot
- ESPN and Sleeper NFL, posting to Discord, Slack and GroupMe. Pro $24.99/yr; Elite $49.99/yr adds an "AI weekly recap written from your league's actual week". "Posting to league chats since 2017."
- **Ranking is a formula:** "Two-step dominance rankings with week-over-week movement" (the same algorithm as espn-api `power_rankings`, §4). LLM not named. No lore input mentioned.

### CommishCast (commishcast.ai)
- Source: https://commishcast.ai/
- A weekly AI **podcast** for the league (hosts "Knox and Remy"). Sleeper and ESPN NFL; Yahoo and CBS on a waitlist. $99/season (2026 promo), list price $150.
- **Commissioner steering:** each week they see the stories and can "note anything worth hammering, drop anything worth sparing"; "anything you put in quotes gets said word for word." Includes power rankings ("who is surging, who is sliding"). Ranking method and LLM: **[Unverified]**.

### League Legacy (leaguelegacy.io)
- Source: https://leaguelegacy.io/features/fantasy-league-newsletters
- Football, baseball, basketball, hockey and WNBA, importing from Sleeper, Yahoo, ESPN, MFL, CBS, Fleaflicker and RTSports. **The only multi-sport, all-three-platform newsletter product found.**
- Newsletter has recaps, previews, standings and power rankings. "Customize AI generated summaries and publish"; commissioners can "edit headlines, sections, and summaries". $36/yr after a 7-day trial.
- LLM not named. **[Unverified]** whether the ranking order is editable.

### ffwrapped (already read; current state)
- Source: https://ffwrapped.com/fantasy-football-weekly-recap. Sleeper, ESPN and Yahoo NFL. The free Standard report covers the latest week. Premium adds editing, three commentary styles (Roast, Newspaper, Neutral) and video recaps. "AI turns that structured context into the written report." Live on 2026-10-30.

### Other hosted AI recap or commentary products (thinner evidence)
| Product | What it is | Source |
|---|---|---|
| **League Rewind** (iOS, Nicholas Bodmer) | AI weekly recaps for Sleeper, ESPN, Fleaflicker and Yahoo. Tones: Hype, Broadcast, Analyst, Roast, or write your own. Weekly $2.99; 2026 season $24.99. Last update 2026.9.29. No power rankings listed. | https://apps.apple.com/app/id6499177011 |
| **LeagueBeat** (iOS, Harrison Holcomb) | Sleeper social feed, "AI personas" commenting on trades and matchups, recaps and power rankings. $7.99 per league IAP. Ranking method not stated. | https://apps.apple.com/pg/app/leaguebeat/id6749873508 |
| **The Front Office** (tfofantasy.com) | "GPT-generated newsletters", tone "from PG to unhinged", trash-talk generator, per-manager insult database. ESPN, Sleeper and Yahoo NFL. Invite-only beta, free. | https://www.tfofantasy.com/ |
| **SmackScript** | Screenshot or direct-connect recaps (Sleeper, ESPN; Yahoo read-only). "GPT-powered". 14 tones. 25 credits for $9.99. No rankings. | https://smackscript.com/ |
| **Sleeper Manager AI** (sleepermanai.com) | Sleeper NFL "league show": recap, roasts for every team, **AI power rankings** ("The AI ranks every Sleeper roster by actual strength"). Pro $15/season. | https://www.sleepermanai.com/ |
| **NFL Fantasy Edge** | Sleeper and ESPN. Premium posts "AI power rankings" to the league's Discord via webhook. Uses Claude. $19 one-time or $8/month. | https://nflfantasyedge.com/ |
| **LeagueLogs** | "personalized weekly newsletters" plus an AI analyst "that knows your league by name". Sleeper and ESPN. Details are behind a single-page app: **[Unverified]**. | https://leaguelogs.com/ (meta description) |
| **The Fantastic Leagues** | Fantasy baseball "League Digest", an AI weekly recap with team grades. Gemini and Claude. Free for 2026. Appears to be its own league platform: **[Unverified]**. | https://thefantasticleagues.com/ |
| **Fantasy Genius** | Year-end Sleeper and ESPN recap with power rankings, awards and a schedule simulator. $10 per league. No AI mentioned. Post dated 2025-01-11; current status **[Unverified]**. | https://fantasygenius.substack.com/p/fg-yearly-recaps-now-available |
| **LeagueMint** | Formula power rankings (SoS, PF, consistency, H2H, "Luck Factor") and "Story of the Week" talking points. | https://www.leaguemint.com/features/power-rankings |
| **Stacked Pro** | Per-manager Tuesday and Friday emails for Sleeper leagues (advice, not league media). No power rankings. | https://www.stackedfantasy.com/nfl/news/weekly-emails |
| **Commish.ai** (already read) | On 2026-10-30 the domain `commish.ai` serves a Spaceship "Commish.ai for sale … $24,995" page. Effectively dead at that domain. | https://commish.ai |

---

## 4. Chat bots and open-source projects (beyond the four already read)

### Chat bots (Discord, Slack, GroupMe, Telegram)
- **dtcarls/fantasy_football_chat_bot**: 307 stars, GPL-3.0, last pushed 2026-09-07, HEAD `1ae2440916c2d55e6cf1fe25bf4ace5a852921f8`. ESPN to GroupMe, Discord or Slack. Posts scoreboards, 10 weekly trophies, waiver report and formula "Two-step dominance" power rankings on a schedule. No LLM in the self-hosted version; the AI recap exists only in the paid GameDayBot Elite. https://github.com/dtcarls/fantasy_football_chat_bot
- **SwapnikKatkoori/sleeper-ff-bot**: 37 stars, MIT, last pushed 2023-05-22 (dormant; Heroku-era). Sleeper to GroupMe, Slack or Discord: standings, close games and scheduled stat posts. https://github.com/SwapnikKatkoori/sleeper-ff-bot
- **LandonPatmore/yahoo-fantasy-bot**: 86 stars, MIT, **archived** (last push 2022-09-06). Yahoo alerts to GroupMe, Discord or Slack. https://github.com/LandonPatmore/yahoo-fantasy-bot
- Commish HQ posts to Telegram and NFL Fantasy Edge to a Discord webhook (§3). Many tiny 2026 Discord bots exist (for example genkuroo/sleeper-discord-bot for transactions). None of the ones checked does rankings with prose.

### Libraries with built-in rankings
- **cwendt94/espn-api**: 999 stars, MIT, active (pushed 2026-10-26). `League.power_rankings(week)` builds a win matrix, then `two_step_dominance` and `power_points`. This is a formula. Code at `700e15ddbb91124f031473d2411c8a6285944274`, `espn_api/football/league.py` lines 391–409: https://github.com/cwendt94/espn-api

### LLM recap repos (2026 wave)
GitHub search on 2026-10-30 for "fantasy recap", "league recap" and "fantasy newsletter" returns dozens of repos created or pushed in 2026, almost all with 0 stars and personal one-league builds. Examples: OGCooDirty/fantasy-recaps, ckmanz1/fantasy-recap, jordanrhall/fantasy-recap (ESPN emails), drewkeely3/fantasy-league-recap, madmikeri-ops/league-recap-bot (Yahoo), johnschettini-ship-it/league-recap ("Beer Den Gazette"), PeregrineCode/dads-league-recap (baseball) and dads-hockey-recap, Ringo029/nba_fantasy_recaps, nickrolen/fantasy-newsletter-engine (Yahoo NBA, MIT), zschlaich/FantasyFootballBot (Azure OpenAI and Discord). The notable ones:

- **tfadp/fantasy-recap**: no licence, created 2026-08-31, HEAD `b19954d5bf12bafa606df585e8e4a3604dfac7b2`. https://github.com/tfadp/fantasy-recap
  - **Architecturally the closest open-source analogue to Lazy Pundit.** "**code computes, the model writes.** Every number the recap can cite is calculated, checked and labeled before the model sees it … it may not add, compare, or infer any figure."
  - Sleeper API plus a Yahoo Chrome-button scraper. QC assertions run before the model.
  - **Lore:** `prompts/<league>-lore.md` ("nicknames, rivalries, who mocks who") and `prompts/<league>-chat.md` ("real messages pasted from the group chat", which they call "the highest-leverage file"). Past write-ups are fed forward. There is a `./recap approve` step before publishing.
  - **Ranking is a formula:** "weights 0.40 season PF, 0.25 last two weeks, 0.25 win percentage, 0.10 consistency". It was validated against a *hand-made* Week 4 ranking: 10 of 12 teams within two spots; one team was 1st by hand and 8th by formula. They read that as the formula correcting the human.
  - Built for one friend group (iMessage delivery by email or GitHub Pages). LLM: **[Unverified]** (not named in the README).
- **PeregrineCode/fantasy-weekly-recap**: MIT, 0 stars, created 2026-04-14, HEAD `51acbc8b8198623e01703f73f398704829b063ce`. https://github.com/PeregrineCode/fantasy-weekly-recap
  - Yahoo **fantasy baseball** (categories). Narrates with **Claude via `claude --print`**, so it runs locally on the user's Claude CLI. Uses "configurable writer personas".
  - `prompts/reference.md` holds "rivalries, running jokes". A member-submitted "trade rumours" form feeds an "Insider" persona.
  - **Power Rankings — Composite ranking with tier labels** (formula). It is the closest prior art for the NBA/MLB plus persona plus lore parts of Lazy Pundit, but not for human ranking.
- **etanetan/weekly-league-recap**: Sleeper, Gemini 2.0 Flash, Next.js/Supabase, tweet-thread recap. No rankings or lore. https://github.com/etanetan/weekly-league-recap
- **jayson-stancil/sleeper-power-rankings**: a Glicko-2 formula ranking with a Shiny app. https://github.com/jayson-stancil/sleeper-power-rankings

### MCP connectors (make the by-hand route easy)
- **Flaim**: free, MIT (jdguggs10/flaim-fantasy, HEAD `2de520001736bbb5ad79b4cd0e2f46bc7f87db85`, 4 stars). ESPN, Yahoo and Sleeper; football, baseball, basketball and hockey. A read-only connector for Claude, ChatGPT and others. https://flaim.app, https://github.com/jdguggs10/flaim-fantasy
- **League Loom**: free connector for ESPN, Sleeper and Fantrax (no Yahoo). Publishes a copyable "AI power rankings" prompt in which **the assistant decides the order**: "the ordering and the one-line reasoning come from your assistant." https://leagueloom.com/power-rankings-ai
- **FantasyBot**: ESPN, Yahoo and Sleeper; NFL, NBA, MLB and NHL. A ChatGPT app and Claude connector with power rankings. Free to start; Pro price unlisted. https://www.fantasybot.ai/

---

## 5. Templates and guides for doing it by hand

- **League Loom prompt** (above): the AI ranks and gives one line per team, with stated weighting. https://leagueloom.com/power-rankings-ai. Also a list of 14 prompts: https://leagueloom.com/prompts
- **FantasyBot "45 prompts"**: https://www.fantasybot.ai/ai-fantasy-football-prompts (not opened; **[Unverified]** contents).
- **ffwrapped weekly recap template**: seven sections (Story, Final Scores, Awards, Schedule Luck, Where That Leaves Us, Next Week, closing line "in the league's own voice"). Explicitly leaves "room for the things only your league would understand". No power ranking section. https://blog.ffwrapped.com/posts/fantasy-football-weekly-recap
- **RationalGo "power rankings generator" build guide**: formula order (all-play, CBS-style, composite), with **the commissioner writing the blurbs**. No AI writing. https://rationalgo.ai/resources/app-builder/community-tools/fantasy-football-power-rankings-generator
- **Dynasty newsletter guide** (Substack): advises building inside jokes, league terminology and recurring awards. https://deltdynastynewsletter.substack.com/p/writing-a-dynasty-fantasy-football
- **Medium "Python & GPT" weekly email** (DIY, ESPN/Sleeper to GPT-4 to email): https://medium.com/@pysli/automate-weekly-fantasy-football-summary-emails-with-python-gpt-6a9f5afac0ea (not opened). **RoastGPT** (ESPN, Azure OpenAI): http://blog.matt-o.com/Ai-Fantasy-Football-Roast (not opened).
- **Gumroad "Commissioner Newsletter Templates"**: contents not visible. https://asbowker.gumroad.com/l/CommishTemplates
- **Reddit:** I could not retrieve primary Reddit threads (the search API was blocked). **[Unverified]** how common shared "ChatGPT power rankings" prompts are there.

---

## 6. Comparison table

Ranking key: **F** = formula only; **AI** = the LLM decides the order; **H** = the human decides; **F+H** = formula default, human can reorder; **?** = not determinable.

| Tool | Platforms | Sports | Ranking | LLM / where it runs | Reads lore? | Hosted / local | Price | Licence | Alive (2026-10-30) | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| **Lazy Pundit** (planned) | Sleeper, Yahoo, ESPN | NFL, NBA, MLB | **H only** | LLM API from local CLI | Yes | Local CLI | — | — | — | — |
| Sleeper Weekly Report | Sleeper | NFL (others **[Unverified]**) | None (awards only) | None | No | In-app | Free | Proprietary | Yes | support.sleeper.com/…/3204499 |
| Yahoo Weekly League Recap | Yahoo | **[Unverified]** | None | None stated | No | In-app | Free | Proprietary | Yes | help.yahoo.com/kb/SLN37123.html |
| Yahoo matchup/draft recaps | Yahoo | **[Unverified]** | None | ChatGPT, Yahoo-hosted | No | In-app | Free | Proprietary | Yes | help.yahoo.com/kb/sln36411.html |
| ESPN (IBM watsonx) | ESPN | NFL | None (advice grades) | IBM Granite, hosted | No | In-app | Free | Proprietary | Yes | newsroom.ibm.com (2024-09-10) |
| **MMT HQ** | ESPN, Sleeper, Yahoo (manual) | NFL | **F+H (↑/↓ reorder)** | BYO OpenAI, Anthropic or xAI key, server-side | **Yes (per-manager voice notes)** | Hosted (web + apps) | Free beta + own API costs | Proprietary | Yes | mmt.football (JS bundles) |
| Commish HQ | Sleeper, ESPN | NFL | ? (editable content; order **[Unverified]**) | Not named, hosted | Yes (RAG + group-chat tone) | Hosted to Telegram | $7.99/mo | Proprietary | Yes | commishhq.ai |
| The Bench Press | Sleeper | NFL | F (all-play, PF) | Claude Opus 5.5, Cloudflare | Yes (40-line lore box) | Hosted | $25/season | No licence (source public) | Yes | github.com/alexeldeib/fantasy-recap @2bc4582 |
| LeaguePulse | Sleeper, ESPN | NFL | ? (AI writers) | Claude, hosted or BYO key | **[Unverified]** | Hosted or self-host | $39–79/yr; self-host free | FSL-1.1-ALv2 | Yes | github.com/ebrown-32/LeaguePulse @3a6f0a7 |
| GameDayBot / dtcarls bot | ESPN, Sleeper (hosted) | NFL | F (two-step dominance) | Not named (Elite only) | No | Hosted or self-host | $24.99–49.99/yr; self-host free | GPL-3.0 | Yes | gamedaybot.com; github @1ae2440 |
| CommishCast | Sleeper, ESPN | NFL | ? | Not named | Partial (commish notes and quotes) | Hosted (podcast) | $99–150/season | Proprietary | Yes | commishcast.ai |
| League Legacy | Sleeper, Yahoo, ESPN, MFL, CBS and others | NFL, MLB, NBA, NHL, WNBA | ? (summaries editable) | Not named | No | Hosted | $36/yr | Proprietary | Yes | leaguelegacy.io |
| ffwrapped | Sleeper, ESPN, Yahoo | NFL | F | Not named, hosted | No (user can add notes to a draft) | Hosted | Free + Premium | Proprietary | Yes | ffwrapped.com |
| League Rewind | Sleeper, ESPN, Fleaflicker, Yahoo | NFL | None | Not named | No (custom tone only) | iOS app | $2.99/wk, $24.99/season | Proprietary | Yes (2026.9.29) | apps.apple.com/app/id6499177011 |
| LeagueBeat | Sleeper | NFL | ? | Not named | No | iOS app | $7.99+/league | Proprietary | Yes (1.0.8) | apps.apple.com/…/id6749873508 |
| The Front Office | ESPN, Sleeper, Yahoo | NFL | None stated | GPT, hosted | Partial (insult database) | Hosted | Free beta | Proprietary | Yes (beta) | tfofantasy.com |
| SmackScript | Sleeper, ESPN, Yahoo, NFL.com | NFL | None | GPT, hosted | No | Hosted | $9.99/25 credits | Proprietary | Yes | smackscript.com |
| Sleeper Manager AI | Sleeper | NFL | AI | Not named | No | Hosted | $15 | Proprietary | Yes | sleepermanai.com |
| NFL Fantasy Edge | Sleeper, ESPN | NFL | AI (to Discord) | Claude, hosted | No | Hosted | $19 or $8/mo | Proprietary | Yes | nflfantasyedge.com |
| tfadp/fantasy-recap | Sleeper, Yahoo (scraper) | NFL | F (0.40/0.25/0.25/0.10) | **[Unverified]**, GitHub Actions | **Yes (lore + pasted chat)** | Self-run | Free | No licence | Yes (personal) | github.com/tfadp/fantasy-recap @b19954d |
| PeregrineCode/fantasy-weekly-recap | Yahoo | **MLB** | F (composite + tiers) | Claude CLI, local | Yes (reference.md, rumours) | Self-run (local + Pages) | Free | MIT | Yes (personal) | github @51acbc8 |
| sleeper-ff-bot | Sleeper | NFL | None/F | None | No | Self-host | Free | MIT | Dormant (2023) | github.com/SwapnikKatkoori/sleeper-ff-bot |
| yahoo-fantasy-bot | Yahoo | Multi | None | None | No | Self-host | Free | MIT | Archived | github.com/LandonPatmore/yahoo-fantasy-bot |
| espn-api | ESPN | NFL, NBA | F (two-step dominance) | None | No | Library | Free | MIT | Yes | github @700e15d |
| League Loom prompt | ESPN, Sleeper, Fantrax | NFL, NBA, NHL | AI | User's Claude or ChatGPT | Only if user pastes it | Connector | Free | Proprietary | Yes | leagueloom.com/power-rankings-ai |
| Flaim | ESPN, Yahoo, Sleeper | NFL, MLB, NBA, NHL | n/a (data only) | User's assistant | Only if user pastes it | Connector | Free | MIT | Yes | flaim.app |
| Commish.ai | — | — | — | — | — | — | — | — | **Domain for sale** | commish.ai |

---

## 7. Does anything already do "the human ranks, the tool writes the prose with league lore"?

**Yes, one product, partially.** MMT HQ comes closest:
- The commissioner can reorder the ranking.
- The AI writes each team's take.
- Per-manager "inside-joke fuel" notes go into the prompt.
- There is a review-then-publish gate.

It differs from Lazy Pundit in four ways:
1. **The formula order is the default and the fallback.** When the commissioner does nothing, the power score orders the board and auto-takes are posted. The human *may* reorder; they do not *have to*. Lazy Pundit never fixes an order.
2. **It is hosted, NFL-only, ESPN and Sleeper first** (Yahoo by manual scores), with no NBA or MLB.
3. Lore is a short per-manager note, not a league-wide lore store with entries.
4. Its persona "voices" are styles, sometimes named after a real person with consent, not a pundit persona.

Commish HQ, The Bench Press, tfadp and PeregrineCode all read league lore, but they rank by formula (or the order is unknown). League Loom's prompt and the AI-ranking apps let the LLM decide the order, which is the opposite of Lazy Pundit's rule. No local CLI tool with human-only ranking was found.

## 8. What this means for the demand test

- **The core need is validated by other people paying for it.** At least six paid products launched or relaunched for 2026 sell AI-written league commentary: Commish HQ $7.99/mo, The Bench Press $25/season, LeaguePulse $79/yr with AI, CommishCast $99/season, GameDayBot Elite $49.99/yr and League Rewind $24.99/season. Lore and inside jokes are a headline selling point in Commish HQ ("RAG memory … inside jokes") and The Bench Press (lore box).
  - Demand for "AI writes our league's recap" should not be the hypothesis under test. It is crowded.
- **The differentiator to test is narrower:** "the pundit decides the order, and the tool never does". MMT HQ shipping a reorder control is weak evidence that commissioners want to override. Its formula-default design is evidence that the builders thought most commissioners would not bother.
  - A tfadp README anecdote cuts the other way: a hand ranking (recency-driven) disagreed with the formula, and the author kept the formula.
  - A demand test should measure whether pundits actually hand-rank each week when a default is available, or whether they want a default to edit.
- **Cheap substitutes set the bar:**
  - Sleeper's free in-chat Weekly Report (stat awards).
  - Yahoo's free ChatGPT recaps.
  - Free MCP connectors (Flaim, League Loom) plus a general chatbot.
  - Kill criteria should ask what a pundit gets from Lazy Pundit that "Flaim + Claude + my lore doc + I type the order" does not. Today the answers are grounded numbers, a persistent lore store, a persona and repeatability.
- **Possible white space** (unverified as demand; supply only):
  - Local or CLI with no account and no league data sent to a SaaS. Only tfadp, PeregrineCode and LeaguePulse self-host come near, and all are single-league DIY builds.
  - Yahoo via the official API.
  - NBA and MLB with lore. Only League Legacy (hosted) and PeregrineCode (MLB, Yahoo) cover non-NFL.
- **Competitive risk:** MMT HQ could make reordering mandatory, add a lore store or add sports with little effort. Commish HQ could add rank editing. Both are live in-season products as of 2026-10-30.

## 9. Gaps and unverified items
- Sleeper Weekly Report: whether there are cards beyond Narrow Victory, and whether it exists for NBA or other sports.
- Yahoo ChatGPT recaps: sports covered and launch date. Yahoo Weekly League Recap: whether any LLM is used.
- Whether ESPN shows any in-league power ranking.
- Commish HQ, LeaguePulse, CommishCast and League Legacy: whether the ranking order is human-editable.
- tfadp/fantasy-recap: which LLM.
- LeagueLogs: features and pricing (single-page app, not rendered).
- Reddit or forum prompt-sharing prevalence: not retrieved.
