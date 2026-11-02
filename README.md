# lazy-pundit
Turns your fantasy league data into power rankings and weekly recaps written in a pundit's voice, so the commissioner doesn't have to. Starting with Sleeper and Yahoo. Early planning stage.

League data comes from the [Sleeper API](https://docs.sleeper.com/) and (experimentally) ESPN Fantasy. Lazy Pundit isn't affiliated with either.

## Usage (early)

A league workspace is a folder with a `workspace.md` naming the pundit and the Sleeper season:

```markdown
---
format: 1
pundit: rikhin
seasons:
  2025:
    platform: sleeper
    league_id: "1234567890"
---
```

From inside that folder (or any folder in it):

```sh
lazy-pundit draft     # fetch, then write pundits/<pundit>/<season>/week-NN.md in standings order
                      # reorder the ## sections and edit the blurbs
lazy-pundit check     # list the draft's problems and tag clear claims
lazy-pundit publish   # freeze week-NN.published.md, write week-NN.txt and copy it
lazy-pundit doctor    # check Node, your config and credentials, and each listed workspace
lazy-pundit transcripts delete   # remove the workspace's LLM transcripts
```

With an Anthropic key, `draft` has the LLM write the intro and blurbs, and writes each call's prompt and reply to `transcripts/<season>/` in the workspace. With no key, past the spend cap, or on any error from Anthropic, it writes stat lines instead (or the LLM's prose so far, if it stopped partway) and says why.

From anywhere, `--league <slug>` acts on a workspace your `config.yaml` lists.

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

`spend.yaml` counts LLM spend by local calendar month, across every league. `credentials.yaml` holds the Anthropic key and the `espn_s2` cookie at mode 0600; the tool warns if others can read it.

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
