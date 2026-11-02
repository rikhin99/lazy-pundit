# Module map

Read this before opening source files. It says which file owns what, so you can open only the files the ticket touches, and use `sed -n`/`grep` on the rest. Line counts are rough sizes.

## The pipeline

`draft`: fetch (`sleeper/fetcher.ts`) → snapshot on disk (`snapshot.ts`) → League model (`sleeper/normalizer.ts`) → stats and evidence (`draft-data.ts`) → Markdown (`ranking-file.ts` `renderDraft`) → `checkDraft`.

`check` and `publish` both start from `checkDraft` in `check.ts`: read the latest `week-NN.md`, parse it, rebuild the evidence from its snapshot, validate each blurb, return the problems list and write any auto-tags. `publish` then freezes the checked text and renders plain text.

## Modules (`src/`)

| File | Owns | Entry points |
|---|---|---|
| `index.ts` | The library's public API; the CLI and tests import only this | re-exports |
| `cli.ts` | Arg parsing, the publish prompt and printing the problems list; no logic | commander program |
| `deps.ts` | Injected outside world: transport, clock, clipboard, cache, config and workspaces folders, environment overrides; the only reader of `process.env` | `Deps`, `Environment`, `systemDeps` |
| `config.ts` | The person-level files: `config.yaml`, `credentials.yaml` (0600), `usage.yaml`, with `CONFIG_FORMAT` | `readConfig`, `loadCredentials`, `saveCredentials`, `dropWorkspaces` |
| `anthropic.ts` | Anthropic's API base and the live key check | `ANTHROPIC_API`, `checkAnthropicKey` |
| `doctor.ts` | The `doctor` command: each check with its fix | `doctor`, `DoctorCheck` |
| `transport.ts`, `file-transport.ts`, `clock.ts`, `clipboard.ts` | The adapters behind `Deps`; only these touch network, time or other processes | `httpTransport`, `fileTransport`, `systemClipboard`, `noClipboard` |
| `workspace.ts` | `workspace.md`, finding a workspace (`--league` or upwards from the current folder), season folders, file naming | `readWorkspace`, `findWorkspace`, `rankingsDir`, `snapshotsDir`, `weekStem` |
| `front-matter.ts`, `workspace-files.ts` | Front matter with the FORMAT version; writing workspace files and outputs | `readFrontMatter`, `writeWorkspaceFile`, `writeOutput` |
| `cache.ts` | The person-level cache (players file) | `readCacheEntry`, `writeCacheEntry` |
| `sleeper/api.ts` | Sleeper's API base and players URLs | `SLEEPER_API`, `SLEEPER_PLAYERS_URL` |
| `sleeper/fetcher.ts` | Fetching every Sleeper payload into a snapshot | `fetchSleeperSnapshot` |
| `snapshot.ts` (300) | Snapshot manifest and blobs on disk | `readSnapshot`, `readManifest`, `readBlob` |
| `sleeper/normalizer.ts` (470) | Sleeper payloads → the platform-neutral `League` | `normalizeSleeper` |
| `league.ts` | The `League` model types, `TeamId`, record formatting, `isStarter` | types |
| `standings.ts` | Standings, rank, seed and tiebreaks through a week | `standingsThrough` |
| `lineup.ts` | Best possible lineup points | `bestLineupPoints` |
| `data-hash.ts` | The hash of the data a ranking stands on | `dataHash` |
| `evidence-pack.ts` (490) | Every stat under its evidence ID, per team and league | `buildEvidencePack` |
| `draft-data.ts` | Evidence pack plus the stat lines and intro a draft starts with | `draftData` |
| `ranking-file.ts` | The `week-NN.md` format: render, parse (with text offsets), order checks | `renderDraft`, `parseRanking`, `checkOrder` |
| `draft.ts` | The `draft` command | `draft` |
| `check.ts` | The problems list: validates a draft and writes auto-tags | `check`, `checkDraft`, `Problem` |
| `publish.ts` | Publish confirm, frozen copy, plain text, clipboard | `publish` |
| `plain-text.ts` | The plain text the league reads | `renderPlainText` |
| `validator.ts` | The validator's entry: claims, auto-tags, swears for one blurb | `validate`, `applyAutoTags`, `stripTags`, `isHard` |
| `validator/types.ts` | Validator input/output and `EvidencePack`, `OrderEvidence` types | types |
| `validator/extract.ts` (440) | Splitting text into units and finding claim shapes | `units` |
| `validator/judge.ts` (325) | Deciding each claim's status and reason | `judge` |
| `validator/evidence.ts` | Resolving an evidence ID; whether words agree with a fact | `resolve`, `agrees` |
| `validator/tags.ts`, `validator/names.ts`, `validator/numbers.ts`, `validator/swears.ts` | Tag syntax and auto-tag writing, team-name matching, number words, the word list | `TAG`, `stripTags`, `applyAutoTags` (re-exported by `validator.ts`) |

## Tests (`test/`)

The seams, and the helpers each one uses:

- **Library API against a temp workspace** (`draft-publish`, `check`, `config`, `doctor`): `fearTheTurtle(week)` in `support/workspace.ts` gives a workspace, deps that replay the committed snapshot, a recording clipboard and a fixed clock; `rankingsDir(dir)` finds the files. `person()` gives deps alone, with temp config, cache and workspaces folders and no environment overrides, so nothing touches the real home directory.
- **Validator** (`validator`): `blurb()` and `week8Evidence()` in `support/week8-evidence.ts` hold literal week-8 evidence; `support/plain-prose.ts` lists sentences that must never come back hard.
- **League model and stats** (`sleeper-normalizer`, `standings`, `stats`, `data-hash`): `committed(week)` and `patched(week, patches)` in `support/workspace.ts`.
- **CLI** (`cli`): spawns `src/cli.ts` in a workspace with `LAZY_PUNDIT_CLIPBOARD=off` and HOME and the XDG folders in a temp home; `homeListing()` writes a `config.yaml` for `--league`.
- **Repo rules** (`injected-boundaries`, `format-versions`, `glossary-terms`, `sleeper-fixtures`).

Fixture values for hand-checked literals: `npm run fixture:show -- <week> --model`. A workspace with a draft for running the CLI by hand: `npm run fixture:workspace`.
