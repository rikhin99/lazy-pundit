# lazy-pundit
Turns your fantasy league data into power rankings and weekly recaps written in a pundit's voice, so the commissioner doesn't have to. Starting with Sleeper and Yahoo. Early planning stage.

League data comes from the [Sleeper API](https://docs.sleeper.com/) and (experimentally) ESPN Fantasy. Lazy Pundit isn't affiliated with either.

## Development

Needs Node 24 (see `.nvmrc`).

```sh
npm install        # also builds dist/ via prepare
npm run typecheck
npm run lint
npm test
```

The library never reaches the network or the system clock directly: every entry point takes an injected **transport** and **clock** (`httpTransport()` and `systemClock` in production). Tests replay snapshot folders through `fileTransport()`.

### Fixtures

`fixtures/sleeper/fear-the-turtle-2025/` is a scrubbed, committed snapshot set (see `fixtures/sleeper/README.md`). It's made from the private raw fixtures on the local `fixtures/raw` branch, which hold real names and are never pushed:

```sh
git archive fixtures/raw fixtures/raw/sleeper | tar -x   # untracked and gitignored
npm run scrub:sleeper
```

Tests that need the raw files run only when `fixtures/raw/` is present. The fixture name check reads an optional, never-committed `fixtures/denylist.txt` (one real name per line, `#` comments allowed).
