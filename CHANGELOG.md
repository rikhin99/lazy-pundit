# Changelog

Releases are hand-cut 0.x tags, installed with `npm i -g github:rikhin99/lazy-pundit#semver:^0` (with npm 12 or later, add `--allow-git=all`). Within 0.x, a release may change the files a workspace holds; its entry says how.

## 0.1.1

### Added

- `init` says, once the workspace folder is accepted and before the first setup step, how to change an answer afterwards: `lazy-pundit --league <slug> setup <step>` for the setup steps it names, and for the pundit name, platform, league or folder, deleting the workspace's folder and its line under `workspaces:` in `config.yaml` (both paths given), then running `init` again.

### Fixed

- A `config.yaml` whose `workspaces:` has nothing under it, as deleting its last line by hand leaves it, reads as listing no workspaces, and `init` lists the next one under it. Before, every command refused the file.
- `check` no longer verifies a claim about the section's team from an opponent's stat. In a blurb such as "lost to Gus Bus by 55 and sits at 4-4", the record is judged against the section's team, the claim's team, and is wrong if it isn't that team's record, though the opponent's record fits. A claim is judged against another team only when that team is the subject of its clause ("while Bench Mob sit at 7-1") or the claim comes straight after its name, in brackets or a "who" clause ("lost to Gus Bus (4-4)", "trails Bench Mob, who sit at 7-1"). "We", "they" and "this team" are the section's team.
- `check` reads "the fourth loss in a row" and "a 2nd win in a row" as streak claims, as it already read "fourth straight loss" and "four losses in a row": each is verified or wrong against the team's streak and auto-tagged when true. Before, the streak in such a sentence was neither verified nor listed. "3rd straight loss", with the ordinal in digits, is read too.
- A Sleeper team name or manager display name with spaces at its ends ("Team C ") is trimmed, so the draft's heading, tagged team names and `check`'s problems list no longer carry the extra space. Spaces inside a name stay as Sleeper has them. A draft written by 0.1.0 with the untrimmed name still checks and refreshes without a new problem, but keeps the extra space, and publishes it, until the pundit removes it by hand, which is safe.
- `init`'s "Which league?" pick list marks each league a listed workspace already holds ("League A (2026, 12 teams), set up in <folder>"), and picking one, or typing its league ID, is refused straight away with the same message as before and asks for the league again, where before it was refused only after the workspace folder question, ending `init`. A league set up only for an earlier season isn't marked, since Sleeper gives each season's league its own ID.

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
