# Changelog

Releases are hand-cut 0.x tags, installed with `npm i -g github:rikhin99/lazy-pundit#semver:^0` (with npm 12 or later, add `--allow-git=all`). Within 0.x, a release may change the files a workspace holds; its entry says how.

## 0.1.1

### Added

- `init` says, once the workspace folder is accepted and before the first setup step, how to change an answer afterwards: `lazy-pundit --league <slug> setup <step>` for the setup steps it names, and for the pundit name, platform, league or folder, deleting the workspace's folder and its line under `workspaces:` in `config.yaml` (both paths given), then running `init` again.
- `init`'s folder question names the folder an empty answer gives. For a second league that's a new folder next to the last workspace set up, and `init` says so, where before it was always one in `~/lazy-pundit/`. A folder typed as `~/…` is in the home folder. A folder ending in `.`, likely a typo, asks whether to drop the dot before anything is made.
- The README says what the folder answer is (the workspace folder itself, by its full path or `~/…`), that each league needs its own folder, and how to move a workspace. Its Windows line says Lazy Pundit works inside WSL, and is still untried outside it.

- ESPN leagues read through `draft`, `check`, `publish` and `refresh` (experimental, NFL, read-only): a `workspace.md` may name `platform: espn`, which a v0.1.0 workspace never did, so older files stay valid. The ESPN normalizer reads only players' actual points (never projections), numbers playoff rounds from the first playoff week, treats a playoff bye as a bye, and refuses a league whose playoff seeding isn't by total points scored (head-to-head, say), since the standings order it rebuilds would be wrong. It also refuses a league whose playoff rounds last more than a week, on purpose: no league we know of has them, so the reading of a two-week round couldn't be checked. ESPN's playoff home bonus is part of the matchup score but no longer reads as a commissioner override, and a player in the IR slot no longer counts towards the best possible lineup or points left on the bench, nor is named as the bench player who would have helped most, since they couldn't have started.
- `init` sets up an ESPN league: pick ESPN, paste the league ID from the league's URL, and init reads the league straight away. A public league needs nothing more. A private one shows how to copy the `espn_s2` cookie from the browser and asks for it at a masked prompt, and the cookie is saved, dated, in `credentials.yaml` (mode 0600) once the workspace is listed, never in the workspace, and not asked for again for another league while it works. A rejected cookie asks for the cookie again (or the league ID, since a mistyped ID can be someone else's private league), and a league ID ESPN doesn't know asks for the ID again, each with its own message. A rejected cookie from `LAZY_PUNDIT_ESPN_S2` ends `init`, saying to set it to a fresh one or unset it, since a typed cookie can't take its place. A league scored by categories or roto is refused. A Sleeper league and an ESPN league with the same ID are no longer taken for the same league.
- `setup espn` saves a fresh cookie for an ESPN league's workspace, after checking it against the league, as the rejected-cookie fix says; Skip keeps the stored one. `setup handles` and `setup lore` read an ESPN workspace's league from ESPN.
- `doctor` checks the ESPN cookie, or its absence, with one request for a listed ESPN league's own data: rejected (or a private league with no cookie) is a failure with the `setup espn` fix (or, for `LAZY_PUNDIT_ESPN_S2`, to set or unset it), a league ESPN doesn't know a warning to check `league_id`, and no answer a warning. It still warns once a stored cookie is 11 months old.

### Fixed

- A folder `init` refuses (a relative path, a folder in use, one whose workspace holds the league) asks for the folder again, keeping the answers before it. Before, it ended `init`.
- A `config.yaml` whose `workspaces:` has nothing under it, as deleting its last line by hand leaves it, reads as listing no workspaces, and `init` lists the next one under it. Before, every command refused the file.
- `check` no longer verifies a claim about the section's team from an opponent's stat. In a blurb such as "lost to Gus Bus by 55 and sits at 4-4", the record is judged against the section's team, the claim's team, and is wrong if it isn't that team's record, though the opponent's record fits. A claim is judged against another team only when that team is the subject of its clause ("while Bench Mob sit at 7-1") or the claim comes straight after its name, in brackets or a "who" clause ("lost to Gus Bus (4-4)", "trails Bench Mob, who sit at 7-1"). "We", "they" and "this team" are the section's team.
- `check` reads "the fourth loss in a row" and "a 2nd win in a row" as streak claims, as it already read "fourth straight loss" and "four losses in a row": each is verified or wrong against the team's streak and auto-tagged when true. Before, the streak in such a sentence was neither verified nor listed. "3rd straight loss", with the ordinal in digits, is read too.
- `check` reads "them" or "their" in the clause straight after a result between two teams as the team that lost: the team beaten ("beat Bench Mob, handing them a third loss in a row") or the team that lost to the other ("Bench Mob lost to us, leaving them at 3-5"). Before, it judged such a claim against the section's team, so a true claim about the losing team came back wrong. Any other pronoun, and "them" further on in the sentence, is still the section's team.
- A Sleeper team name or manager display name with spaces at its ends ("Team C ") is trimmed, so the draft's heading, tagged team names and `check`'s problems list no longer carry the extra space. Spaces inside a name stay as Sleeper has them. A draft written by 0.1.0 with the untrimmed name still checks and refreshes without a new problem, but keeps the extra space, and publishes it, until the pundit removes it by hand, which is safe.
- On an ESPN workspace, `refresh` and `publish` now warn about a `credentials.yaml` others can read or change, with its `chmod 600` fix, as `draft` and `doctor` already did, whether the fetch succeeds or fails. `draft` says it once, now before the fetch, so a `credentials.yaml` it can't read stops it before any snapshot is written. A Sleeper workspace's `refresh` and `publish` read no credentials and say nothing about them.
- When a fetch fails, `draft` and `refresh` continue from the newest snapshot of the season whose data all reads, skipping one with a stored payload deleted or damaged by hand, which is left as it is. With none, they stop with the fetch's error and its fix, as with no snapshot at all. Before, such a payload ended the command with a raw file error.
- `init`'s "Which league?" pick list marks each league a listed workspace already holds ("League A (2026, 12 teams), set up in <folder>"), and picking one, or typing its league ID, is refused straight away with the same message as before and asks for the league again, where before it was refused only after the workspace folder question, ending `init`. A league set up only for an earlier season isn't marked, since Sleeper gives each season's league its own ID.
- `setup handles`, `lore`, `stakes`, `method` and `persona` refuse a `workspace.md` whose front-matter keys are indented or written inside `{...}`, before asking anything and before writing any file, saying "workspace.md: put each front-matter key at the start of its line, with no indent and no braces around the keys", as `check`, `refresh` and `publish` do for a draft. Before, a step that added a key, such as linking the first handle after the handles step was skipped, said `workspace.md` wasn't valid YAML, and one that only changed a key wrote it. `setup key` and `setup cap` don't edit `workspace.md` and work as before.

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
