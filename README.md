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

From inside that folder:

```sh
lazy-pundit draft     # fetch, then write pundits/<pundit>/<season>/week-NN.md in standings order
                      # reorder the ## sections and edit the blurbs
lazy-pundit publish   # freeze week-NN.published.md, write week-NN.txt and copy it
```

## Development

Needs Node 24 (see `.nvmrc`; `.npmrc` makes npm refuse other versions). A pre-commit hook runs typecheck, lint and tests.

```sh
npm install        # also builds dist/ via prepare
npm run typecheck
npm run lint
npm test
```

The library never reaches the network or the system clock directly: every entry point takes injected `Deps`: a **transport**, a **clock**, a **clipboard** and a **cache dir** for the players file (`systemDeps()` in production). Tests drive `draft()` and `publish()` against a temp workspace, replaying snapshot folders through `fileTransport()` with a fixed clock and a recording clipboard (see `test/support/workspace.ts`).

### Fixtures

`fixtures/sleeper/fear-the-turtle-2025/` is a scrubbed, committed snapshot set (see `fixtures/sleeper/README.md`). It's made from the private raw fixtures on the local `fixtures/raw` branch, which hold real names and are never pushed:

```sh
npm run fixtures:raw     # unpacks the local fixtures/raw branch: untracked and gitignored
npm run scrub:sleeper
```

The branch, not the unpacked folder, is what exists: list it with `git ls-tree -r --name-only fixtures/raw`, and rerun `npm run fixtures:raw` after the branch changes, since an older unpack goes stale silently.

Tests that need the raw files run only when `fixtures/raw/` is present. The fixture name check reads an optional, never-committed `fixtures/denylist.txt` (one real name per line, `#` comments allowed).
