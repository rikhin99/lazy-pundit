# Lazy Pundit

A local tool that turns fantasy league data into power rankings and recaps. The stats are computed deterministically, the prose is written by an LLM, and a human decides the order.

## People and voice

**League workspace**:
Everything the tool knows about one league: its platform data, lore, persona, stakes for each season, and every pundit's rankings. A league can have several pundits.

**League slug**:
A league workspace's own short name, in lowercase letters, digits and dashes, by which the operator names the league from anywhere. It belongs to the workspace, not the platform.
_Avoid_: League ID (the platform's own ID), league name

**Pundit**:
The human who authors a league's rankings and owns every placement in them. Each pundit in a league keeps their own rankings and settings, and one person can be the pundit in several leagues.
_Avoid_: Writer, ranker, user

**Existing pundit**:
A pundit who was already writing rankings for their league before using Lazy Pundit.

**New pundit**:
A pundit who started writing rankings for a league because of Lazy Pundit, often in a league that had none before.

**Concierge**:
A pundit for whom someone else runs the tool. The concierge pundit only edits and posts what they are handed.

**Operator**:
The person who runs the tool on their own machine, and whose credentials, spend cap and cache it uses. Usually the pundit; for a concierge pundit, whoever runs the tool for them.
_Avoid_: User, owner, account

**Manager**:
A person who runs a team in the league. A manager stays the same across seasons and platforms, while their team, its name and their platform account can change. A team can have several managers who share it, and a manager can join, leave or come back in any season. A manager isn't a pundit unless they also write rankings.
_Avoid_: Owner, player

**Manager handle**:
The league workspace's own short name for a manager, linked to each platform account they have played under. Lore and rivalry weeks name managers by handle. A link between accounts is made only when the pundit confirms it.
_Avoid_: Username, user ID

**Departed manager**:
A manager whose handle links to platform accounts, none of them in the current league. Their lore is kept in case they come back, but isn't sent to the LLM provider.

**Lore**:
What the pundits have written down about a league and its people that the platform data doesn't hold: the league's type and history, facts about each manager, the relationships between them, running jokes, nicknames, and anything else the pundit chooses to add. It belongs to the league workspace and is shared by every pundit in it. Lore is context for the prose, not evidence.

**Lore entry**:
One fact or note in a league's lore, filed under a league, manager, team or other section. A blurb that uses a lore entry cites the section it came from. The validator checks that the section exists, never whether the entry is true.

**Lore section**:
One headed part of a league's lore: the league, a manager, a team, relationships, running jokes or anything the pundit makes up. A sentence that uses a lore entry cites the section's name.

**Personal-data warning**:
A warning, with line numbers, that lore looks like it holds a phone number, an email, a street address, a long run of digits or a date of birth. It comes from a deterministic check each time lore is read, and before any draft sends lore. It warns and doesn't stop the draft.

**Lore size warning**:
A warning when the lore a draft would send passes about 2,000 tokens, with the draft's estimated cost and lore's share of it against the spend cap.

**League type**:
What kind of group a league is: work, family, friends or other. It is written in the lore, and setup reads it to preselect the persona and the family-league setting.

**Reserved tag**:
A braced marker that means something to the tool in a file the pundit writes, such as `{manager=bo}` or `{local}`. Any other braced text in lore or a season's stakes file is an error, so a marker meant to keep something private never silently does nothing.

**Nickname**:
Another name for a manager or a team, such as "Karna" or "Rad Team". The validator uses nicknames to work out which team a sentence is about. A team's current name and its manager's display name always count as nicknames.
_Avoid_: Alias

**Persona**:
The voice the prose is written in: a preset, any tone-control overrides, a blurb shape and length, and an optional style note. Each pundit has one per league and can switch it any week, and each draft records the persona it was written in. It belongs to the pundit's output, not to the pundit. A persona shapes only LLM prose and never changes a stat line.
_Avoid_: Voice, tone (for the whole thing)

**Preset**:
A named, ready-made persona: a set of tone-control values plus a short style note. A pundit picks one and can override any part of it.
_Avoid_: Template, standard persona

**Preset sample**:
A short, fixed blurb written in one preset's voice, shown so a pundit can hear a preset before picking it. It is the same for every league and is never written by the LLM.
_Avoid_: Example blurb, sample persona

**Tone control**:
One dial on a persona: swearing (off, mild, on), teasing (none, light, roast) or formality (formal, casual, unhinged).

**Style note**:
The free text in a persona that describes the voice beyond the tone controls. It may name lore sections or managers but never copies lore.

**Family league**:
A league setting saying that people of any age may read what is published. While it is on, a persona that asks for more is lowered to no swearing and at most light teasing, with a warning, unless the pundit deliberately relaxes their own persona. A relaxed persona has no limit: the tool flags it on every load and asks the pundit to confirm before publishing with it the first time and whenever the persona changes. It is set per season, alongside the stakes, and belongs to the league workspace, not to lore or a persona.

**Blurb shape**:
Whether a persona writes a team's blurb as prose or as bullets, and about how long it is. The validator treats each bullet like a sentence.

## League data

**Platform**:
The fantasy service a league's season is played on, such as Sleeper, ESPN or Yahoo. Each season is played on one platform.

**Platform settings**:
The league settings the platform owns, such as the FAAB budget, how many teams make the playoffs and the week they start. They are read fresh from the platform on every fetch and shown read-only, never copied into a file the pundit writes, so they can't drift.

**Season**:
One year of a league, named by the platform's season year. Stakes, teams, rankings and movement belong to a season. Lore and personas carry over between seasons.

**Team**:
A manager's entry in one season, named by its platform and the platform's team ID for that season. A team's identity isn't assumed to survive into the next season; anything that spans seasons follows the manager instead.
_Avoid_: Roster, franchise

**Matchup**:
One head-to-head game in one week. It is a regular-season, winners-bracket, consolation or losers-bracket game, and it ends in a win, loss or tie. A win decided by a tiebreak is still a win, marked as decided that way.
_Avoid_: Game (for the fantasy contest)

**Matchup score**:
The points a team is credited with in a matchup, including any home bonus or commissioner override. Results, points for and score-based triggers use it.

**Players' points**:
The sum of a team's starters' points in a week, before any bonus or override. Lineup stats use it.

**Bye**:
A week in which a team has no matchup. The team still scores points, but it gets no result.

**Playoff bye**:
A top seed's place in the second round of the winners bracket, skipping the first round. A losers-bracket bye isn't one.

**Losers bracket**:
The playoff bracket for teams that missed the playoffs. On Sleeper the team with the lower score advances and is given the win, so a losers-bracket result says nothing about who outscored whom. Streaks, luck and close matchups leave it out, and score-based items read the scores.

**Playoff status**:
Whether a team has clinched a playoff bye, clinched a playoff spot or been eliminated. It is stated only when it holds whatever happens in the remaining matchups and however ties are broken. Otherwise the team has none, and nothing is said. Once the regular season is over points for is known, so it decides a level finish. A league with divisions or median scoring gives no status.
_Avoid_: Playoff odds, magic number, in the hunt

**Knocked out**:
A team that has lost a winners-bracket matchup, so it can no longer win the title. A round played over two weeks knocks a team out only in its last week. This is a bracket result, not a playoff status: a team that clinched and was later knocked out still clinched, and a team that missed the playoffs was eliminated but never knocked out. Saying a knocked-out team was eliminated is true. It holds in a league with divisions or median scoring too.

**Snapshot**:
One complete fetch of a season's data from its platform, kept in the league workspace. Each draft records the snapshot it was built from, so the data it was checked against can be looked at again later. "Data changed" means a scored week's results, scores, lineups, transactions or standings changed, or the league's number of playoff spots or regular-season length changed. A change to injuries, names or ownership doesn't count.
_Avoid_: Cache, fixture, pull

**Data as of**:
When the snapshot a draft stands on was fetched.

**Earlier snapshots**:
The snapshots a draft stood on before each refresh moved it to newer data, kept on record. A claim that held against any of them was true when written, so it is stale rather than wrong.

**Data hash**:
A fingerprint of the data a ranking stands on: everything "data changed" covers, through the ranking week. It is a record of what a draft was built from. Two snapshots are compared by their data, not by their fingerprints.

**Data change**:
One difference between two snapshots through a ranking week: a flipped result, a changed score, lineup, pairing or bye, changed standings or seeds, a transaction added or removed, or a changed number of playoff spots or regular-season length.

**Data-changed warning**:
What a fetching command says when fresh data has data changes against the draft's snapshot: how many claims would go stale, and to refresh. It changes nothing in the draft.

**Players file**:
The platform's list of every NFL player, with positions, NFL team and injury status. It is fetched rarely and kept in the operator's cache, outside any workspace, and each snapshot keeps only the players its league names. "Cache" means only this person-level store, never a snapshot.

**Routine fetch**:
A fetch of the season's shared data plus the matchups of the last 2 scored weeks and the in-progress week. Every other week comes from the last snapshot.

**Full fetch**:
A fetch of every week: the first fetch, any fetch more than 2 weeks after the last one, or `refresh --full`.

**Retention**:
Which snapshots are kept: every snapshot a draft or frozen copy names, as its snapshot or one of its earlier snapshots, and the latest of each season. Others older than 14 days are deleted, along with stored payloads no kept snapshot uses.

**Last complete snapshot**:
The newest snapshot of the season in the league workspace. When a fetch fails or comes back partial, the command writes nothing and continues from it, saying its data as of and the command to run once fetching works. With none, the command stops, writing nothing, and its error ends with the fix for what failed.
_Avoid_: Fallback snapshot (a fallback is the LLM's)

## Setup and cost

**Setup step**:
One part of setting up a league, such as the lore, the persona or the Anthropic key, that `init` walks through in order and `setup` can re-run on its own. Only the pundit name and league data steps can't be skipped.

**Setup checklist**:
What `setup` shows for a league: each setup step and whether it is done, skipped or at its default.

**Placeholder**:
The file a skipped setup step still writes: comments saying how to fill it in, and nothing that loads as written. Skipped lore has no sections, skipped stakes are unrecorded, and a skipped persona is Broadcast.
_Avoid_: Template

**Hand edit**:
A change the pundit made by hand to a file a setup step wrote. Re-running the step shows the diff against it and overwrites only on confirm.

**Wizard**:
`init`'s prompts: they ask for each setup step's answers in order and hand them to the library. Only the CLI has one.

**Pick list**:
The league data step's list of a platform account's leagues this season, to choose from instead of typing a league ID.

**Credentials**:
The operator's secrets: the Anthropic key and the ESPN cookie. They belong to the operator, never to a league workspace, so a workspace can be shared or backed up without them.

**Spend**:
What the operator's LLM calls cost, as estimated from the price table, counted by calendar month across all their leagues.
_Avoid_: Usage, cost (on its own), billing

**Spend cap**:
The most the operator lets LLM calls spend in one calendar month, across every league. A call whose estimated cost would pass it is never made.
_Avoid_: Budget, monthly cap, hard cap, limit

**Price table**:
The dated price per token of each model, shipped with the tool, which the operator can add to or correct for a model. A model with no price is never called.
_Avoid_: Rate card, pricing

## Rules and stakes

**Stakes**:
What a league plays for in one season beyond the platform's own settings: the buy-in, payouts by final place, house rules and rivalry weeks. They belong to the league workspace and are shared by every pundit in it. A league can record that it plays for bragging rights only, which is different from recording nothing.
_Avoid_: Rules (for the whole thing), settings

**Pot**:
The buy-in times the number of teams. Payouts are stated as amounts or shares of it.

**Payout**:
What one final place wins: an amount or a share of the pot. Winner takes all unless the stakes say otherwise.

**House rule**:
A rule the league runs on top of the platform: a name, an outcome (money, FAAB or anything written in words), optionally its spirit (whether it is meant seriously or as a joke), and, optionally, a trigger the tool can work out, such as the week's low score. Every tied team triggers a rule, and the tool counts how often each team has triggered it but never splits a prize. `from:` and `until:` weeks limit a rule, so splitting a rule in two keeps the old outcome for earlier weeks, while changing an outcome in place recomputes winnings to date as if it had always applied, with a changed-outcome warning.
_Avoid_: Side bet, punishment (for the whole thing)

**Trigger**:
The measurable event that decides who a house rule applies to, such as high score, low score, most points left on the bench, last place or champion, for a week or a season. A season's high or low score is its single best or worst week, while a season's most points left on the bench is the total over its weeks. A rule without a trigger is applied by hand through log entries. A trigger the platform can't work out, such as a losers-bracket last place in a league without one, has no trigger winner and loads with a warning to log it by hand.

**Trigger winner**:
A team a house rule's trigger applies to for a week or a season, whether the outcome is a prize or a punishment. Every tied team is one. An in-progress week has none.

**Points left on the bench**:
The best possible lineup's points minus the points actually scored in a week.
_Avoid_: Bench points

**Rivalry week**:
A week in which named pairs of managers are meant to face each other. A pairing names managers, not teams, and counts only if the platform's schedule really matches them that week.

**Log entry**:
A dated record of something that happened under the stakes in a given week, such as a fine issued or how a punishment turned out. It belongs to one season, and the prose uses it only around the week it happened unless the pundit pins it. The Log is only appended to: each frozen copy records the entries for its week and earlier.

**Changed-outcome warning**:
What loading `league.md` says when a house rule's dollar or FAAB outcome differs from the one the last published week recorded: winnings to date now count the new outcome for every week, and splitting the rule with `until:` and `from:` keeps the old one for earlier weeks. `setup stakes` gives it with its diff. Publishing again records the outcomes as they then stand. It changes nothing.

**Log-edit warning**:
What loading `league.md` says when a Log entry the last published week's frozen copy recorded has been changed or removed since, naming the entry. Appending an entry, or pinning one later, gives none. Publishing again records the Log as it then stands. It changes nothing.

**Stakes section**:
One headed part of the free-text rules a season's stakes hold beside the structured ones. A sentence that uses one cites the section's name, and the validator checks only that the section exists.

**No-stakes flag**:
A hard problem on prose that mentions money, a prize or a punishment in a league whose stakes say it plays for bragging rights only. With no stakes recorded at all, nothing is flagged either way.

**Winnings to date**:
How many times a team has won each house-rule prize so far in the season, multiplied by the prize's amount. A stat drawn from the recorded rules, not a record of money paid or owed.
_Avoid_: Balance, ledger

## Rankings

**Ranking**:
The pundit's ordered list of a league's teams for one week. It's the authoritative output. It always places every team, a team's place is its position in the list, and each team carries a blurb.
_Avoid_: Power score, standings

**Week**:
The platform's matchup period. In daily-lineup sports, one week is one matchup built from many days of lineups.

**Ranking week**:
The week a ranking is labelled with: the most recent scored week in its data when its draft begins. It never changes afterwards. A ranking made before any week is scored is week 0, the preseason ranking.

**Scored week**:
A week the platform has finished scoring. Until then the week is in progress and its results aren't evidence. A scored week can still change through stat corrections, and nothing signals when they stop.
_Avoid_: Final week

**In-progress week**:
The week the platform hasn't finished scoring yet. A routine fetch always asks for it, but its results aren't evidence. Drafting while one is in progress warns and builds through the last scored week; `--include-in-progress` adds its own week's stats as evidence for provisional claims, recorded in the draft as `in_progress_week`, and tells the LLM that week's scores can still change, so it gives no result for it.

**Stat correction**:
A change the platform makes to a week's scores after it has been scored.

**Drastic correction**:
A stat correction that flips a matchup result or changes a trigger winner. It is found by comparing fresh data with the snapshot behind the latest published ranking, so it only covers weeks that a published ranking has already shown. It becomes evidence for the next draft, whichever week that is, and lasts until a ranking that includes it is published. Smaller corrections are only noted for the pundit.

**Draft**:
The pundit's working copy of a week's ranking. It can be edited freely, before and after publishing, and the league never sees it.

**Blurb**:
The short prose about one team that goes with its place in the ranking. The LLM drafts it and the pundit can rewrite it.

**Stat line**:
A blurb made only of the team's checked stats, such as its record, points rank, streak and latest result, with no prose. It stands in whenever no LLM blurb exists, and the pundit can keep, extend or delete it.

**Week intro**:
An optional blurb about the whole league's week, above the teams. It cites league-wide evidence and any team's stats, follows the persona's blurb shape, and carries the line for any drastic correction. A persona setting turns it off.
_Avoid_: Header, summary

**Award**:
A league-wide item picked deterministically from the week's data, such as the top score, the biggest margin or an upset. Awards appear on publish styles and are never written by the LLM.

**Revision**:
An LLM rewrite of one team's blurb that follows the pundit's instruction. It is held to the same checks as an LLM draft, stays within the persona's tone controls whatever the instruction asks, and replaces the blurb only when the pundit accepts it. An edit the pundit makes with some other LLM isn't a revision; it counts as the pundit's own edit.
_Avoid_: Rewrite, regenerate

**Draft context**:
Everything the LLM may be told about a league-week, gathered once when a draft begins: the evidence pack, the team names and managers' display names, the persona, the lore, the stakes and each team's last published blurb. An LLM draft, a revision and the eval harness all write from it, and nothing outside it is ever sent to the LLM provider.
_Avoid_: Prompt data, LLM input

**LLM transcript**:
The record of one LLM call, kept as a file in the league workspace: the model, the token counts and cost, the system text, the prompt and the reply or the error, never the key. A draft writes one per call, and `transcripts delete` removes them all.
_Avoid_: LLM log, prompt log

**LLM prose file**:
The record a draft keeps beside itself of each section the LLM wrote, word for word as written, best attempts included: the week intro and each team's blurb, never a stat line. A draft the LLM wrote nothing for has none, so a draft with no LLM prose file is one where the LLM wasn't used. The pundit never edits it.

**Fallback**:
What a draft writes when the LLM can't run or stops partway, with a reason saying why: stat lines if it failed before its first reply, otherwise the prose so far. No key, an invalid key, no credits, the spend cap, a model with no price and any provider error all fall back. It is never silent and never half-written.

**Group**:
An optional label over a run of consecutive places in a ranking, such as a tier or a playoff split into championship and consolation groups. Places are numbered straight through the groups.
_Avoid_: Bracket, division

**Power score**:
The tool's per-team number for a week, used only to produce the starting order.
_Avoid_: Rating, ranking

**Power-score method**:
The pundit's choice of how the power score is computed, including its weights: standings, points per game, all-play, form, the ffwrapped formula, the FFMWR rank average or the ramped blend. It is a per-pundit setting, and each starting order records the method that produced it.

**Ramped blend**:
The default power-score method: a weighted mix of a team's league percentiles of all-play record, form and record. Its weights move in a straight line from the first regular-season week to the last, so record counts for more as the playoffs approach.

**Pundit settings**:
One pundit's choices for one league that aren't part of the persona: the power-score method and its weights. A pundit can change them at any time. A draft copies what it used, so changing them later never rewrites the past, and an existing draft picks up the change only when the pundit refreshes.

**Starting order**:
The order the tool proposes from the power score. The pundit edits it into the ranking. It is fixed when a draft begins and changes only when the pundit refreshes.
_Avoid_: Suggested ranking, default ranking, recommendation, starting-order snapshot

**Starting place**:
A team's place in the starting order. The editing view shows it beside the team's place in the pundit's ranking.

**Refresh**:
The pundit's explicit act of recomputing a draft's starting order from newer data or a changed method. It never changes the pundit's order or blurbs.

**Standings**:
The league's table by record, ordered with the platform's own tiebreaks, as of a given scored week. A team's position in it is its rank. A stat the pundit sees, not a ranking.

**Seed**:
A team's position in the playoff order: its position in the standings, if that is within the playoff spots. Before the regular season ends, it is the seed the team would have if the season ended now. In a league with divisions, no seed is given.

**Publish**:
The pundit's explicit act of declaring a week's ranking final. Only a published ranking counts as the previous ranking for movement. Changes made to the draft afterwards reach the league only when the pundit publishes again.
_Avoid_: Export, save

**Frozen copy**:
The ranking exactly as the pundit published it for a ranking week, kept beside the draft. Every published output renders from it, and movement reads it. Publishing that week again replaces it with a new edition.

**Edition**:
How many times a ranking week has been published: 1 on the first publish, one more on each republish.
_Avoid_: Revision (that's an LLM rewrite of a blurb), version

**Movement**:
A team's change in place since the movement baseline. A team with no place in the baseline, or a ranking with no baseline, is new, never given an invented movement.

**Movement baseline**:
The frozen copy movement is measured against: the pundit's most recent one from an earlier ranking week in the same season. Republishing a week never changes it, and when it isn't the previous week the published ranking says which week it is.
_Avoid_: Previous ranking, last week's ranking

**Small-sample flag**:
A warning that the season is too young for the power score to mean much. It appears only in the editing view.

**No-starting-order flag**:
A warning on a week-0 ranking's draft: the teams are in the platform's own order, not a starting order, and the pundit orders them by gut. It appears only in the editing view and lasts for that draft's life.

## Stats

**All-play record**:
A team's record if it had played every other team every week.

**Luck**:
Actual wins minus the wins expected from the all-play record.

**Form**:
A team's average points over its most recent weeks.

**Close matchup**:
A matchup decided by less than 5 points.

**Lineup efficiency**:
Points scored divided by the points of the best possible lineup from the same roster.
_Avoid_: Coaching efficiency, max points

## Grounding

**Claim**:
A checkable statement of fact in a blurb: a number, record, rank, streak, result or playoff status. Opinions and jokes are not claims.

**Evidence pack**:
The stats and order evidence the tool computes for each team and for the league for a week, each under an evidence ID. The LLM writes claims only from it, and the validator checks claims against it.

**Evidence ID**:
The name of one stat in the evidence pack, such as `record` or `w8.points`. A claim cites it in the draft as `[7-1]{ev=record}`. Publishing strips it.

**Player fact**:
An evidence ID that names an NFL player in a team's week: its top starter (`w8.top`), its starters who scored zero (`w8.zeros`), its best bench player when the lineup left points on the bench (`w8.benchmiss`) and its opponent's top starter (`w8.opp.top`), with that player's points under `_points`. A claim citing one that names a different player is wrong.

**Order evidence**:
A team's place, movement and group, read from the draft's current order each time it's checked rather than fixed when the draft begins. Its source is the pundit, not the platform. A claim can cite it like any other evidence.
_Avoid_: rank, for a team's place in the pundit's ranking. A team's rank is its position in the standings.

**Validator**:
The deterministic check of every claim in a blurb against the evidence pack, and of the blurb's words against the persona when swearing is off. It gates LLM drafts before they're written and reports on the pundit's edits without rejecting them.
_Avoid_: Fact-checker

**Word list**:
The fixed list of swear words the validator looks for in a blurb or week intro while the persona's swearing is off. Each hit is a soft problem.

**LLM gate**:
The validator's pass-or-fail on LLM prose before it's written: a blurb or week intro passes only if every claim is cited and verified and, when swearing is off, the word list is clean. One that fails goes back to the LLM with the validator's complaints, up to twice. If it still fails, its best attempt is written anyway, with a gate failure for each fault.

**Gate failure**:
A problems-list item marking a fault in LLM prose that never passed the LLM gate: a claim that isn't verified or a word-list hit.

**Auto-tag**:
The evidence ID the tool adds to an untagged claim of the pundit's that clearly matches exactly one stat, without changing a word. From then on the claim is checked like any cited one, so a later refresh or reorder can make it stale.

**Wrong claim**:
A claim that disagrees with the evidence it cites or clearly matches. A claim that was never true is wrong, not stale.

**Stale claim**:
A claim that was true when written and is no longer true after a refresh or after the pundit reorders the teams. Its cause names which of the two broke it.

**Loose claim**:
An untagged claim whose words match a stat, but not clearly enough to say which one.

**Unchecked claim**:
A claim with no evidence to check it against, such as a tier claim in a ranking with no groups.

## Problems

**Problems list**:
Everything in a draft the pundit should see before publishing: each claim that isn't verified, each word-list hit and each flag, placed at its team and line unless it's a league item. Every surface shows the same list, hard problems first.
_Avoid_: Errors, issues, warnings (for the whole list)

**Blurb problem**:
A problem the validator finds in a blurb or the week intro: a claim that isn't verified (provisional claims included), a word-list hit, a stakes mention under no stakes or an unreadable tag. League items and moved teams aren't blurb problems. A frozen copy records how many hard and soft ones it was published with.

**League item**:
A problems-list item about the whole league rather than a team or a line of the draft, such as the small-sample flag.

**Failed-fetch item**:
A soft league item from a command whose fetch failed: what failed, the last complete snapshot's data as of, and the fix for what failed: `lazy-pundit refresh` once fetching works; checking `league_id` in `workspace.md` when the platform doesn't know the league; or checking for a newer Lazy Pundit when the platform answers in a shape this version can't read. Only the command that fetched lists it; `check` never does. With no last complete snapshot, the same fix ends the stopping error, except that running the command again once fetching works takes the place of `lazy-pundit refresh`, since there's no draft for it to move.

**Correction-timing reminder**:
A soft league item on a draft of a scored week, since nothing signals when stat corrections stop: "Scored. Corrections may land through Thursday" on Sleeper.

**Provisional claim**:
A claim in a draft made with `--include-in-progress` that cites the in-progress week's stats and agrees with them. It is a soft problem, since the week can still change before it's scored. One that disagrees is wrong as usual.

**Hard problem**:
A problem that would put something false or garbled in front of the league: a wrong or stale claim, a cited evidence ID that doesn't exist, or a tag the tool can't read. Publishing with one asks the pundit first.

**Soft problem**:
A problem worth a look that doesn't make the ranking false: a loose or unchecked claim, a word-list hit or a flag. It is listed but never asked about.
_Avoid_: Warning (for a soft problem alone)

**Publish confirm**:
The one question publishing asks when the draft has hard problems: Publish anyway or Back to editing, with Back to editing the answer whenever nobody says otherwise. A draft with no hard problems publishes without it. It never rejects a ranking outright.
_Avoid_: Override, force publish

**Moved team**:
A team the pundit has placed somewhere other than its starting place. It's listed as a soft problem with both places, so the pundit sees their edits at a glance.

**Eval harness**:
The builder's own measure of LLM prose quality, run on prepared leagues rather than on any pundit's real weeks. It looks for what the validator can't see by design, such as untagged superlatives or invented facts, and decides which model is the default. Pundits never run it.
_Avoid_: Test suite, usage stats

**Demand test**:
The builder's Stage 1 trial with real pundits ranking their own leagues, to learn whether the tool earns a place in their week. It gathers no telemetry: what the builder learns, each pundit chooses to paste.

**Demand-test summary**:
What `stats` prints, read from the pundit's frozen copies and LLM prose files alone, for the pundit to paste to the builder during the demand test. For each published ranking week, it shows the minutes from the draft's start to its first publish, how many teams were moved and by how many places in all (measured against the starting order at publish), the LLM text kept, whether the LLM was used and the blurb problems at publish. Then it gives the medians. Nothing is sent anywhere: the pundit chooses what to paste.
_Avoid_: Usage stats, usage summary

**LLM text kept**:
The share of the LLM's words, as its LLM prose file holds them, that the frozen copy still has in the same order and in the same section, with tags left out. A week where the LLM wasn't used has none to measure.

## Surfaces

**Editing view**:
What the pundit sees while ranking: the starting order, the stats behind it, and every flag and claim problem, gathered in one problems list. In Stage 1 it's a local preview page beside the Markdown file the pundit edits, plus the same list in the terminal.

**Stats table**:
The editing view's stats behind the starting order, printed in the terminal: one row per team in the draft's current order, with its starting place beside its stats. It reads the data the draft was built from, through the ranking week, so it matches what the draft's claims are checked against.

**Published ranking**:
What the league sees, and anything copied, pasted or screenshotted from it. It is fixed at publish time. It carries no tool-internal flags or scores unless the pundit puts them there. It comes as plain text for pasting and as publish styles for screenshots, all rendered from the same frozen copy.
_Avoid_: Post

**Publish style**:
A screenshot-ready page layout of the published ranking, such as Tabloid or Broadcast. Every style renders from the same frozen copy, so a style never changes the ranking.
_Avoid_: Theme, template
