# Module map

Read this before opening source files. It says which file owns what. Within a file, `npm run outline -- <file>…` lists each declaration's line range and doc line: read the ranges you need with `sed -n`, and open a whole file only when you'll rewrite most of it. Line counts are rough sizes.

## The pipeline

`draft`: fetch (`sleeper/fetcher.ts`) → snapshot on disk (`snapshot.ts`) → League model (`sleeper/normalizer.ts`) → stats and evidence (`draft-data.ts`) → the persona (`persona.ts`, capped by `league-file.ts`'s family league) → with an Anthropic key, the draft context (`draft-context.ts`, with last week's published blurbs read in `draft.ts`), the prompt (`prompt.ts`) and the LLM gate (`llm-gate.ts`: one call, then up to 2 retries for failing sections), each call through `llm-call.ts` (price and spend-cap check, LLM transcript, spend) → Markdown (`ranking-file.ts` `renderDraft`) → `checkDraft`.

`check`, `publish` and `refresh` all start from `checkDraft` in `check.ts`: read the latest `week-NN.md`, parse it, rebuild the evidence from its snapshot, measure order evidence against the movement baseline (`movement.ts`), validate each blurb, list moved teams, return the problems list and write any auto-tags (`refresh` asks it not to). `publish` then fetches in memory for the data-changed warning (a failed fetch is only a note), freezes the checked text with its edition and renders plain text with movement.

`refresh`: fetch in memory (`refresh.ts` `fetchFresh`) → `diff` against the draft's snapshot (`data-diff.ts`) → no change, `checked_at` only; a change, write the snapshot and set the front matter's values (`setFrontMatterValue`), adding the old snapshot to `earlier_snapshots` → `checkDraft`, which reads those snapshots' evidence so a claim stays stale rather than wrong.

## Modules (`src/`)

| File | Owns | Entry points |
|---|---|---|
| `index.ts` | The library's public API; the CLI imports only this, and tests start from it (see "Direct imports" under Tests) | re-exports |
| `cli.ts` | Arg parsing, the publish prompt and printing the problems list; no logic | commander program |
| `deps.ts` | Injected outside world: transport, LLM, clock, clipboard, cache, config and workspaces folders, environment overrides; the only reader of `process.env` | `Deps`, `Environment`, `systemDeps` |
| `config.ts` | The operator's files: `config.yaml`, `credentials.yaml` (0600), `spend.yaml` and its reader and writer, with `CONFIG_FORMAT` | `readConfig`, `loadCredentials`, `saveCredentials`, `dropWorkspaces`, `spendMonth`, `monthSpend`, `addSpend` |
| `anthropic.ts` | Anthropic's API base, the live key check, the `Llm` interface and its Messages API client, which throws a typed `LlmError` (invalid key, no credits, provider). Raw HTTP through the transport (ADR 0002): copy it for a new call, and open the `claude-api` skill only for an endpoint or feature it doesn't use yet | `ANTHROPIC_API`, `checkAnthropicKey`, `Llm`, `anthropicLlm`, `LlmError` |
| `doctor.ts` | The `doctor` command: each check with its fix | `doctor`, `DoctorCheck` |
| `transport.ts`, `file-transport.ts`, `clock.ts`, `clipboard.ts` | The adapters behind `Deps`; only these touch network, time or other processes | `httpTransport`, `fileTransport`, `systemClipboard`, `noClipboard` |
| `workspace.ts` | `workspace.md`, finding a workspace (`--league` or upwards from the current folder), season folders, file naming | `readWorkspace`, `findWorkspace`, `punditDir`, `rankingsDir`, `seasonDir`, `snapshotsDir`, `weekStem` |
| `front-matter.ts`, `workspace-files.ts` | Front matter with the FORMAT version; writing workspace files and outputs. Every workspace file goes through `writeWorkspaceFile` or `writeOutput`, with front matter carrying its FORMAT version, from its first draft (the `format-versions` test fails otherwise). `setFrontMatterKey` replaces a key's whole line, `setFrontMatterValue` only its value, so a trailing comment stays | `readFrontMatter`, `setFrontMatterKey`, `setFrontMatterValue`, `writeWorkspaceFile`, `writeOutput` |
| `cache.ts` | The operator's cache (players file) | `readCacheEntry`, `writeCacheEntry` |
| `sleeper/api.ts` | Sleeper's API base and players URLs | `SLEEPER_API`, `SLEEPER_PLAYERS_URL` |
| `sleeper/fetcher.ts` | Fetching every Sleeper payload into a snapshot, or in memory until the caller writes it | `fetchSleeperSnapshot`, `fetchSleeper` |
| `snapshot.ts` (300) | Snapshot manifest and blobs on disk | `readSnapshot`, `readManifest`, `readBlob` |
| `sleeper/normalizer.ts` (470) | Sleeper payloads → the platform-neutral `League` | `normalizeSleeper` |
| `league.ts` | The `League` model types, `TeamId`, record formatting, `isStarter` | types |
| `standings.ts` | Standings, rank, seed and tiebreaks through a week, and the starting order they give | `standingsThrough`, `standingsAsReported`, `startingOrder` |
| `playoff-status.ts` | Each team's settled playoff status from conservative bounds, and who changed in a ranking week | `playoffStatuses`, `settledThisWeek`, `PlayoffStatus` |
| `lineup.ts` | Best possible lineup points | `bestLineupPoints` |
| `data-hash.ts` | The hash of the data a ranking stands on, and that data | `dataHash`, `coveredData` |
| `evidence-pack.ts` (490) | Every stat under its evidence ID, per team and league | `buildEvidencePack` |
| `draft-data.ts` | Evidence pack plus the stat lines and intro a draft starts with | `draftData` |
| `draft-context.ts` | Everything the LLM may be sent for a league-week | `draftContext`, `DraftContext` |
| `persona.ts` | The presets and their preset samples, reading `persona.md` (Broadcast when it's missing) under the family league's cap with its warnings, and the persona a draft records | `PRESETS`, `loadPersona`, `Persona`, `personaRecord`, `personaSchema` |
| `league-file.ts` | The season's `league.md`; only its `family-league` setting until the stakes ticket (#56) | `familyLeague`, `leagueFilePath` |
| `prompt.ts` | The first-draft instructions and prompt, the retry prompt with the gate's complaints, and reading the reply's sections | `FIRST_DRAFT_SYSTEM`, `firstDraftPrompt`, `rewritePrompt`, `readReply` |
| `llm-gate.ts` | The LLM gate: validating each section, retrying the failing ones, keeping each section's best attempt, and stopping with the prose so far when a retry is stopped | `gatedProse`, `GATE_RETRIES`, `FailedSection` |
| `llm-call.ts` | One LLM call for a draft: no price or past the spend cap stops it unmade; after it, its LLM transcript and spend. Any stop is `LlmStopped`, which `draft.ts` turns into the fallback | `llmAsk`, `LlmStopped`, `MAX_TOKENS` |
| `prices.ts` | The dated price table, `config.yaml`'s overrides, a call's cost and its ceiling before it's made | `PRICE_TABLE`, `PRICES_AS_OF`, `priceOf`, `costOf`, `ceilingCost` |
| `transcripts.ts` | LLM transcripts: writing one per call, deleting the folder | `writeTranscript`, `deleteTranscripts` |
| `ranking-file.ts` | The `week-NN.md` format: render, parse (with text offsets), order checks, the last published ranking, a frozen copy with its edition | `renderDraft`, `parseRanking`, `checkOrder`, `lastPublished`, `frozenCopy` |
| `movement.ts` | The movement baseline, each team's order evidence (place, move, group), and the mark after a record: (▲2), (▼1), (—), (new) | `movementBaseline`, `moveOf`, `orderEvidence`, `movementMark` |
| `draft.ts` | The `draft` command and its fallback reason | `draft` |
| `check.ts` | The problems list: validates a draft and writes auto-tags; marks a new draft's gate failures; the claims a move between two leagues makes stale | `check`, `checkDraft`, `claimsGoingStale`, `Problem`, `withGateFailures` |
| `refresh.ts` | The `refresh` command, the data-changed warning and the fetch behind it | `refresh`, `dataChangedWarning`, `freshDataWarnings`, `fetchFresh` |
| `data-diff.ts` | The data changes between two leagues through a week | `diff`, `DataChange` |
| `publish.ts` | Publish confirms (hard problems; a new or changed relaxed persona), frozen copy and its edition, plain text, clipboard | `publish` |
| `plain-text.ts` | The plain text the league reads | `renderPlainText` |
| `validator.ts` | The validator's entry: claims, auto-tags, swears for one blurb | `validate`, `applyAutoTags`, `stripTags`, `isHard` |
| `validator/types.ts` | Validator input/output and `EvidencePack`, `OrderEvidence` types | types |
| `validator/extract.ts` (440) | Splitting text into units and finding claim shapes | `units` |
| `validator/judge.ts` (325) | Deciding each claim's status and reason | `judge` |
| `validator/evidence.ts` | Resolving an evidence ID; whether words agree with a fact | `resolve`, `agrees` |
| `validator/tags.ts`, `validator/names.ts`, `validator/numbers.ts`, `validator/swears.ts` | Tag syntax and auto-tag writing, team-name matching, number words, the word list | `TAG`, `stripTags`, `applyAutoTags` (re-exported by `validator.ts`) |

## Tests (`test/`)

The seams, and the helpers each one uses:

- **Library API against a temp workspace** (`draft-publish`, `refresh`, `movement`, `playoff-status`, `llm-draft`, `llm-fallback`, `persona`, `check`, `config`, `doctor`), with `persona.md` at `pundits/rikhin/persona.md` and the family league in `seasons/2025/league.md` when a test writes them: `fearTheTurtle(week)` in `support/workspace.ts` gives a workspace, deps that replay the committed snapshot, a recording clipboard and a fixed clock; `rankingsDir(dir)` finds the files; `atWeek(deps, week)` replays a later week, to publish one week and draft the next in the same workspace; `published(dir, deps)` publishes and fails the test if it's held back; `frontMatter(text)` parses a file's front matter. `operator()` gives deps alone, with temp config, cache and workspaces folders and no environment overrides and `noLlm`, so nothing touches the real home directory or calls an LLM. For LLM drafts, set `deps.llm = scriptedLlm(...)` (`support/llm.ts`, which records each request; a scripted answer can be text, a reply with token counts, or an `LlmError` to throw) and `deps.env.anthropicApiKey`.
- **LLM client** (`anthropic-llm`): `anthropicLlm` against a transport that records requests and answers with a canned Messages API body.
- **Validator** (`validator`): `blurb()` and `week8Evidence()` in `support/week8-evidence.ts` hold literal week-8 evidence; `support/plain-prose.ts` lists sentences that must never come back hard.
- **League model and stats** (`sleeper-normalizer`, `standings`, `playoff-status`, `stats`, `data-hash`, `data-diff`): `committed(week)` and `patched(week, patches)` in `support/workspace.ts`.
- **CLI** (`cli`): spawns `src/cli.ts` in a workspace with `LAZY_PUNDIT_CLIPBOARD=off`, `LAZY_PUNDIT_REPLAY` on the week-8 snapshot so a fetch stays offline, and HOME and the XDG folders in a temp home; `homeListing()` writes a `config.yaml` for `--league`.
- **Repo rules** (`injected-boundaries`, `format-versions`, `glossary-terms`, `sleeper-fixtures`).
- **Direct imports**: a test may import from a `src/` module what `index.ts` doesn't export, when the case can't be set up through the library API. `draft-publish` does this for `setFrontMatterKey`, on front matter that `publish` refuses first.

Fixture values for hand-checked literals: `npm run fixture:show -- <week> --model`. A workspace with a draft for running the CLI by hand: `npm run fixture:workspace`.
