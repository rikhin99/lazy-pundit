# lazy-pundit
Weekly power rankings for your fantasy football league, drafted for you with the stats behind them and written in the persona you choose. You put the teams in your order and edit the words. Every claim in the intro and blurbs is checked against the league's data before you publish. It runs on your machine, from the command line.

It works with [Sleeper](https://docs.sleeper.com/) leagues. ESPN comes in a later release. Lazy Pundit isn't affiliated with Sleeper or ESPN.

## Install

Needs Node 24 or later.

```sh
npm i -g github:rikhin99/lazy-pundit#semver:^0
```

That installs the latest 0.x release. Run the same line again to update. With npm 12 or later (`npm -v`; Node 24 and 26 ship npm 11), npm refuses installs from git unless you allow them, so add `--allow-git=all`:

```sh
npm i -g --allow-git=all github:rikhin99/lazy-pundit#semver:^0
```

Install from a release (`#semver:^0` or a tag such as `#v0.1.0`), not from `#main`: only release tags carry the built code that npm can install globally. See `CHANGELOG.md` for what each release has.

## A week's ranking

**Set up once.** `lazy-pundit init` asks for your name, finds your Sleeper league, and walks through the setup steps: manager handles, lore and nicknames, stakes, the persona, the power-score method, your Anthropic key and the spend cap. You can skip any step and come back to it. It makes the league's workspace in a new folder.

**Each week**, from inside the workspace (or from anywhere, with `--league <slug>`):

```sh
lazy-pundit draft     # fetch the league; write pundits/<pundit>/<season>/week-NN.md in the starting order
lazy-pundit table     # the Stats table: each team in the draft's order, its starting place and stats
                      # now edit: reorder the ## team sections, rewrite the intro and blurbs
lazy-pundit check     # list the draft's problems and tag the claims it can check
lazy-pundit publish   # freeze week-NN.published.md, write week-NN.txt and copy it to the clipboard
```

With an Anthropic key, `draft` has the LLM write the intro and blurbs, and writes each call's prompt and reply to `transcripts/<season>/` in the workspace. With no key, past the spend cap, or on any error from Anthropic, it writes stat lines instead (or the LLM's prose so far, if it stopped partway) and says why. `table` reads the draft's own data, with no fetch: run it again after moving sections to see each team's place (#) against its starting place (Start), or with `--sort ppg` (or `start`, `record`, `rank`, `all-play`, `form`, `luck`) for the best first. `publish` asks before publishing a draft with hard problems, or with a relaxed family-league persona; `-y` skips the question.

**Also:**

- `lazy-pundit refresh` refetches the league after stat corrections or late scoring and moves the draft onto the new data, leaving your order and words. `--full` refetches every week.
- `lazy-pundit stats` prints a summary of your published weeks (time to publish, teams moved, how much LLM text you kept) to paste to the builder. Nothing is sent anywhere.
- `lazy-pundit setup` shows the setup checklist. `lazy-pundit setup <step>` re-runs one step: `handles`, `lore`, `stakes`, `method`, `key`, `cap` or `persona`.
- `lazy-pundit doctor` checks Node, your config and credentials, and each workspace.
- `lazy-pundit transcripts delete` removes the workspace's LLM transcripts.

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

Tests that need the raw files run only when `fixtures/raw/` is present. The fixture name check reads an optional, never-committed `fixtures/denylist.txt` (one real name per line, `#` comments allowed).

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
