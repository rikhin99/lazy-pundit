# Changelog

Releases are hand-cut 0.x tags, installed with `npm i -g github:rikhin99/lazy-pundit#semver:^0` (with npm 12 or later, add `--allow-git=all`). Within 0.x, a release may change the files a workspace holds; its entry says how.

## 0.1.1

### Fixed

- `check` no longer verifies a claim about the section's team from an opponent's stat. In a blurb such as "lost to Gus Bus by 55 and sits at 4-4", the record is judged against the section's team, the claim's team, and is wrong if it isn't that team's record, though the opponent's record fits. A claim is judged against another team only when that team is the subject of its clause ("while Bench Mob sit at 7-1") or the claim comes straight after its name, in brackets or a "who" clause ("lost to Gus Bus (4-4)", "trails Bench Mob, who sit at 7-1"). "We", "they" and "this team" are the section's team.

## 0.1.0

The first release, for Sleeper leagues.

### What's in it

- `init` sets up a league workspace step by step: the pundit's name, the Sleeper league picked from a Sleeper account's leagues, manager handles, lore and nicknames, stakes and house rules, the family league and persona, the power-score method, the Anthropic key and the spend cap. Any step can be skipped and answered later.
- `setup` shows the setup checklist, and `setup <step>` re-runs one step (`handles`, `lore`, `stakes`, `method`, `key`, `cap`, `persona`), showing a diff before overwriting a hand edit.
- `draft` fetches the league and starts a draft for the last scored week: the teams in the starting order from the chosen power-score method (standings, points per game, all-play, form, the ffwrapped formula, the FFMWR rank average or the ramped blend), each with its stats. With an Anthropic key, the LLM writes the week intro and the blurbs following the persona, under the spend cap, and its transcripts are kept in the workspace. With no key, past the cap or on an error, the draft has stat lines instead. `--include-in-progress` adds the in-progress week's stats as evidence for provisional claims.
- `table` prints the Stats table for the latest draft: each team in the draft's current order with its starting place, record, standings rank, points per game, all-play record, form, luck and streak, from the data the draft was built from. `--sort <column>` puts the best first. It reads only the draft and its snapshot, with no fetch, and `draft` points to it.
- `check` lists the draft's problems and auto-tags clear claims. Claims in the intro and blurbs, such as records, scores, matchups and playoff status (clinched, eliminated, knocked out), are checked against the evidence pack, and a claim that names a week ("in week 5") against that week's stats.
- `refresh` refetches the league and recomputes the starting order and stats, leaving the pundit's order and words as they are. `--full` refetches every week.
- `publish` checks the draft, asks before publishing over a hard problem, writes the frozen copy and the plain text, and copies the plain text to the clipboard.
- `draft`, `check`, `refresh` and `publish` warn when a house rule's dollar or FAAB outcome has changed in place since the last published week, or a Log entry that week recorded has been changed or removed since; `setup stakes` gives the changed-outcome warning with its diff.
- `stats` prints the demand-test summary from the pundit's published weeks, to paste to the builder. Nothing is sent anywhere.
- `doctor` checks Node, the config and credentials, and each workspace.
- `transcripts delete` removes the workspace's LLM transcripts.

### Not in it yet

- ESPN leagues (and Yahoo).
- `revise`, the LLM revision of one blurb or the intro.
- `preview`, the local editing view beside the draft.
- An interactive Stats table.
- Style pages and awards.
- `season add` and `handles`, for carrying a workspace into a new season.
- Week-0 (preseason) drafts.
- Drastic corrections as evidence in the next draft.
- Playoff status for leagues with median scoring or divisions.
