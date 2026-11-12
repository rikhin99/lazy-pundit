# lazy-pundit
Weekly power rankings for your fantasy football league, drafted for you with the stats behind them and written in the persona you choose. You put the teams in your order and edit the words. Every claim in the intro and blurbs is checked against the league's data before you publish. It runs on your machine, from the command line.

It works with [Sleeper](https://docs.sleeper.com/) leagues. ESPN comes in a later release. Lazy Pundit isn't affiliated with Sleeper or ESPN.

## Before you install

You need two free programs, git and Node 24 or later. Open a terminal (on a Mac: Terminal, in Applications → Utilities) and check for each:

```sh
git --version
node -v
```

- **git**: npm fetches Lazy Pundit from GitHub with it. On a Mac, if `git --version` offers to install the command line developer tools, click Install, wait for it to finish, and run `git --version` again. On Linux, install `git` with your package manager.
- **Node**: `node -v` should print `v24` or higher. If it prints an older version or isn't found, install the LTS version from [nodejs.org](https://nodejs.org/), then open a new terminal and run `node -v` again. Node comes with npm, which installs Lazy Pundit.

On Windows, Lazy Pundit works inside WSL (Windows Subsystem for Linux): run everything there as on Linux, and install Node inside WSL with a version manager such as [nvm](https://github.com/nvm-sh/nvm), since the installer from nodejs.org installs Windows' own Node. It hasn't been tried outside WSL, in PowerShell or cmd.

## Install

```sh
npm i -g github:rikhin99/lazy-pundit#semver:^0
```

That installs the latest 0.x release, with no GitHub account needed. Check it with `lazy-pundit --help`. With npm 12 or later (`npm -v`; Node 24 and 26 ship npm 11), npm refuses installs from git unless you allow them, so add `--allow-git=all`:

```sh
npm i -g --allow-git=all github:rikhin99/lazy-pundit#semver:^0
```

Install from a release (`#semver:^0` or a tag such as `#v0.1.0`), not from `#main`: only release tags carry the built code that npm can install globally. See `CHANGELOG.md` for what each release has.

**Updating.** Run the same install line again. Lazy Pundit doesn't tell you when a new release is out: the builder (who makes Lazy Pundit and runs this test with you) will, or you can watch the repo's releases on GitHub (Watch → Custom → Releases). Updating leaves your workspace where it is. Within 0.x a release may change the files a workspace holds, and its entry in `CHANGELOG.md` says how.

**Back up your workspace before updating.** Copy its folder, or keep it in git (`git init` inside it; its `.gitignore` already leaves out the cached league data and the LLM transcripts). Reinstalling never touches it, but a bad release could damage files `init` can't rebuild: your house rules and Log in `league.md`, your lore, your published weeks and a draft in progress. With a backup, the worst case is restoring a folder.

## Set up your league

Run `lazy-pundit init`. It asks:

1. **Your name**, as it goes on your rankings.
2. **Which platform the league is on.** Pick Sleeper; ESPN and Yahoo stop there for now.
3. **Your Sleeper league.** When it asks for your Sleeper account, type your account name on Sleeper (not the email or phone number you sign in with), and pick the league from that account's leagues this season. If you're not sure of the name, leave it empty and type the league ID instead: the number in the league's URL on sleeper.com. Every Sleeper league can be read this way, with no login. An account name Sleeper doesn't know gives "Sleeper has no account named …", and init asks again. An account with no leagues this season says so, and init asks for a league ID.
4. **The workspace folder**: the folder itself, not one to make it in. Type its full path (`/Users/you/leagues/fear-the-turtle`, say) or start it with `~/` (`~/leagues/fear-the-turtle`); init refuses any other path and asks again. Leave it empty for the folder the question names: for your first league, a new folder in `~/lazy-pundit/` named after the league (`~/lazy-pundit/fear-the-turtle`); after that, a new folder next to the last workspace you set up. A path ending in `.` is likely a typo, so init asks whether to use it without the dot.
5. **The setup steps**: manager handles, lore and nicknames, stakes and house rules (with whether it's a family league, read by people of any age, which keeps every persona clean), the power-score method, your Anthropic key and spend cap, and the persona. Each one but the spend cap can be skipped (the cap is passed over when you skip the key), with "Skip the rest" for all that are left, and answered later with `lazy-pundit setup <step>`.

**One league per workspace.** Each league gets its own folder, so for several leagues run `init` for each (or answer Yes to "Set up another league?"), and keep their folders under one parent, such as `~/leagues/fear-the-turtle` and `~/leagues/<another league>`. After the first, init offers the next folder in the same parent.

**Moving a workspace.** Nothing in a workspace records where it is, so move its folder, then change its line under `workspaces:` in `config.yaml` (see Config and credentials) to the new full path. Everything in it comes along. Deleting the folder and running `init` again, as init's note says, sets the league up from scratch instead.

**The Anthropic key is optional.** With one, the LLM (Claude) writes a first draft of the intro and blurbs in your persona. With none, `draft` writes a stat line for each team instead, and you write the words yourself. To get a key, make an account at [console.anthropic.com](https://console.anthropic.com/), add a little credit to the account, and create an API key. You can add the key later with `lazy-pundit setup key`.

**What a week spends.** A draft makes one to three LLM calls. On the default model (Claude Sonnet 5.5) a call can spend at most about $0.17 with a short lore file, so a draft at most about $0.50, and it's usually much less, since that ceiling assumes the longest possible reply. A long lore file sends more with each call, and `draft` says when it makes a draft cost more. Each call's real spend is in its transcript, and the month's total in `spend.yaml` in the config folder (see Config and credentials). The spend cap (5 USD a month by default, set with `lazy-pundit setup cap`) is checked before every call: a call that could take the month past it is never made, and the draft falls back to stat lines (or keeps the LLM's prose so far).

## A week's ranking

From inside the workspace folder (`cd ~/lazy-pundit/<league>`), or from anywhere with `--league <slug>`:

```sh
lazy-pundit draft     # fetch the league; write pundits/<you>/<season>/week-NN.md in the starting order
lazy-pundit table     # the Stats table: each team in the draft's order, its starting place and stats
                      # now edit week-NN.md: reorder the ## team sections, rewrite the intro and blurbs
lazy-pundit check     # list the draft's problems and tag the claims it can check
lazy-pundit publish   # freeze week-NN.published.md, write week-NN.txt and copy it to the clipboard
```

Then paste into your league chat. If there's no clipboard, `publish` says so: open `week-NN.txt` and copy it from there.

With an Anthropic key, `draft` has the LLM write the intro and blurbs, and writes each call's prompt and reply to `transcripts/<season>/` in the workspace. With no key, past the spend cap, or on any error from Anthropic, it writes stat lines instead (or the LLM's prose so far, if it stopped partway) and says why. `draft` drafts the last scored week. Run while a week's matchups are still being played, it says a week is in progress and drafts the week before; `draft --include-in-progress` adds the in-progress week's stats as evidence, so claims about it are listed as provisional until the week is scored.

### Editing a draft

Open `week-NN.md` in any text editor. Leave the front matter (the lines between the two `---`) as it is. Below it is the intro, then a `## <team>` section for each team:

```markdown
## Gus Bus {team=sleeper:1}
[6th]{ev=pf_rank} in points · [beat]{ev=w8.result} [Pylon Patrol]{ev=w8.opponent} by [55]{ev=w8.margin}
```

- **To reorder**, move whole sections, heading and blurb together. The order of the sections is your ranking. Keep each heading line as it is: `{team=…}` says which team it is.
- **To rewrite a blurb**, replace the text under the heading. A tag such as `[55]{ev=w8.margin}` marks a claim and names the stat it's checked against. Publishing strips the tags, so the league sees only `55`. You don't need to write tags: `check` adds them to the claims it can match to one stat, and leaves the words as they are.
- **`lazy-pundit table`** shows the stats behind the starting order (record, standings rank, points per game, all-play record, form, luck and streak), with each team's place now (#) against its starting place (Start). Run it again after moving sections. `--sort ppg` (or `start`, `record`, `rank`, `all-play`, `form`, `luck`) puts the best first. Below about 69 columns a row wraps, so widen the window.

Say you move Gus Bus to the top and write "Gus Bus beat Pylon Patrol by 55 and are 6-2." `check` tags the claims and finds one wrong:

```text
Tagged 2 claims in pundits/rikhin/2025/week-08.md.
Problems: 1 hard, 8 soft
  ✗ line 28 Gus Bus: "6-2" wrong: record is 4-4, allplay is 45-43
  · League: correction timing: Scored. Corrections may land through Thursday
  · line 27 Gus Bus: "Gus Bus" you moved this team: starting place 7, now 1
  ...
```

A hard problem (✗) would put something false in front of the league: fix it, and run `check` again. Soft ones (·) are worth a look, such as the teams you moved. `publish` runs the same check and asks before publishing over a hard problem, or with a relaxed family-league persona; `-y` skips the question.

### Which files are yours

- `pundits/<you>/<season>/week-NN.md`: the week's draft. Edit it.
- `lore.md`, `seasons/<season>/league.md` (stakes, house rules and the Log), `pundits/<you>/persona.md` and `pundits/<you>/settings.md` (the power-score method): what `init` asked. Change them with `lazy-pundit setup <step>`, which shows a diff before overwriting a hand edit, or edit them by hand.
- Leave the rest alone: `workspace.md`, `.snapshots/` (the league data as fetched), `transcripts/`, and each `week-NN.published.md`, the frozen copy of a published week.

**Also:**

- `lazy-pundit refresh` refetches the league after stat corrections or late scoring and moves the draft onto the new data, leaving your order and words. `--full` refetches every week.
- `lazy-pundit stats` prints a summary of your published weeks (time to publish, teams moved, how much LLM text you kept) to paste to the builder. Nothing is sent anywhere.
- `lazy-pundit setup` shows the setup checklist. `lazy-pundit setup <step>` re-runs one step: `handles`, `lore`, `stakes`, `method`, `key`, `cap` or `persona`.
- `lazy-pundit doctor` checks Node, your config and credentials, and each workspace.
- `lazy-pundit transcripts delete` removes the workspace's LLM transcripts.

## Help and feedback

Something broken or confusing: tell the builder, or open an issue at [github.com/rikhin99/lazy-pundit/issues](https://github.com/rikhin99/lazy-pundit/issues). Include the command you ran, what it printed and the output of `lazy-pundit doctor`. Issues are public, and an edited-out name stays in an issue's edit history, so leave out league-mates' names, team names and league IDs, or send those to the builder directly.

After each published week, run `lazy-pundit stats` and paste its summary to the builder. It's how the builder learns whether the tool saves you time, and it holds only numbers about your weeks.

### Config and credentials

The operator's files live in `$XDG_CONFIG_HOME/lazy-pundit/` (else `~/.config/lazy-pundit/`), never in a workspace:

```yaml
# config.yaml
format: 1
name: Rikhin
model: claude-sonnet-5-5     # the default
spend_cap_usd: 5             # the default; a call that could pass it is never made
prices:                      # optional: add a model, or correct the shipped price (USD per million tokens)
  claude-sonnet-5-5: { input_per_mtok: 2, output_per_mtok: 10 }
workspaces:
  fear-the-turtle: /Users/you/lazy-pundit/fear-the-turtle
```

`spend.yaml` counts LLM spend by local calendar month, across every league. `credentials.yaml` holds the Anthropic key (and, for ESPN once it's supported, the `espn_s2` cookie) at mode 0600; the tool warns if others can read it.

Environment variables:

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | used instead of the stored Anthropic key |
| `LAZY_PUNDIT_ESPN_S2` | used instead of the stored `espn_s2` cookie |
| `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` | where the config and cache folders go |
| `LAZY_PUNDIT_CLIPBOARD=off` | publish copies nothing, for scripted runs |

## Development

Needs Node 24 (see `.nvmrc`; `.npmrc` makes npm refuse other versions). A pre-commit hook runs typecheck, lint and tests.

```sh
npm install        # also builds dist/ via prepare
npm run typecheck
npm run lint
npm test
```

The library never reaches the network or the system clock directly: every entry point takes injected `Deps`: a **transport**, a **clock**, a **clipboard**, the **cache**, **config** and **workspaces** folders, and the environment's overrides (`systemDeps()` in production, the only place that reads `process.env`). Tests drive `draft()` and `publish()` against a temp workspace, replaying snapshot folders through `fileTransport()` with a fixed clock and a recording clipboard (see `test/support/workspace.ts`).

### Fixtures

`fixtures/sleeper/fear-the-turtle-2025/` is a scrubbed, committed snapshot set (see `fixtures/sleeper/README.md`). It's made from the private raw fixtures on the local `fixtures/raw` branch, which hold real names and are never pushed:

```sh
npm run fixtures:raw     # unpacks the local fixtures/raw branch: untracked and gitignored
npm run scrub:sleeper
```

The branch, not the unpacked folder, is what exists: list it with `git ls-tree -r --name-only fixtures/raw`, and rerun `npm run fixtures:raw` after the branch changes, since an older unpack goes stale silently.

Tests that need the raw files run only when `fixtures/raw/` is present. The fixture name check reads an optional, never-committed `fixtures/denylist.txt` (one real name per line, `#` comments allowed). So do the commit hooks (each commit's diff and message) and an agent hook on `gh` issue and comment text, through `scripts/denylist-check.ts`: without the file, they pass everything.

### Releasing

`npm i -g` can't install a git ref whose `package.json` has a `prepare` or `build` script (npm 11.6.1 and 11.21.2 alike). It installs the clone globally, as a link to a temp folder that npm then deletes. So `main` isn't installable, and each release tag points at a release commit made on top of `main`, with the built `dist/` added and no `scripts` block. To cut a release:

1. On `main`, set `package.json`'s version (`npm pkg set version=<version>`, then `npm install --package-lock-only --ignore-scripts`) and add a `## <version>` entry to `CHANGELOG.md`: what's in it and what isn't yet. Commit.
2. Push `main` and wait for CI to pass (`gh run watch`). Its `install:smoke` step has then installed this exact commit the way a pundit would.
3. Run `npm run -s release -- <version>`. It refuses a tree with changes, a branch other than `main`, a `package.json` with another version, a tag that exists and a CHANGELOG without the entry. Then it builds and tags `v<version>` on the release commit, leaving `main` and your working tree as they are.
4. Push the tag (`git push origin v<version>`), then make the GitHub release with the printed `gh release create` command. Its notes are the CHANGELOG entry, written to `dist/RELEASE_NOTES.md`.
5. Check the real install, from GitHub, in a clean HOME:

   ```sh
   export HOME=$(mktemp -d) && npm i -g --prefix "$HOME/p" github:rikhin99/lazy-pundit#semver:^0 && "$HOME/p/bin/lazy-pundit" doctor
   ```

   Run it in a new terminal, since it changes `HOME`. It should install `<version>` and `doctor` should run.

If a pushed release is broken, leave its tag where it is: pundits may have installed it, and npm caches git refs. Fix it on `main` and release the next patch version, which the install line's `#semver:^0` picks up when a pundit runs it again.

`npm run -s install:smoke` (run in CI after the tests) does steps 3 and 5 in a throwaway clone of HEAD, from the clone instead of GitHub: it tags a release commit there, installs it by `#semver:^0` into an empty prefix with a clean HOME, once with the npm in use and once with npm 12 and `--allow-git=all`, and fails unless `--help` lists every command and `doctor` exits 0. Only committed work is tested.
