# Coding standards

Read during review. Each rule is a judgement call; the mechanical rules are tests in `test/injected-boundaries.test.ts` (outside world only through injected `Deps`; files written only through `src/workspace-files.ts`; the validator imports nothing beyond its own modules except league-model types; whether a lineup entry started is decided only by `isStarter`), `test/format-versions.test.ts` (a file shape change needs a version bump) and `test/glossary-terms.test.ts` (no unambiguous glossary _Avoid_ term in identifiers or comments), and Biome and `tsc` cover formatting and types. Where a rule has a source, the source wins.

## Shape

- **Library first.** All behaviour lives in exported library functions. `src/cli.ts` only parses args, prompts and prints. Source: spec #37, Shape and runtime.
- **Platform-blind past the normalizer.** Only a platform's fetcher and normalizer (`src/<platform>/`) read raw payloads; everything else reads the league model in `src/league.ts`. Source: spec #37, Adapters.
- **zod at every boundary**: platform payloads, workspace files, config. A boundary error names the file or URL and what to fix.
- **Format versions.** Every workspace file the tool writes carries its version (`format:`, or `lore:` / `league:`), and a mismatch is refused with a message naming the file. League-facing outputs (`week-NN.txt`, style pages) go through `writeOutput` and carry none.
- **Problems are reported, never fixed.** The pundit owns the order and the prose; validation names the team and line and leaves the order and the words alone. The one write is the auto-tag: `check` wraps a clear untagged claim in `[…]{ev=…}` without changing a word. Source: spec #37, Grounding (Auto-tag, Pundit edits).

## Names

- Code and comments use `GLOSSARY.md` terms. A glossary _Avoid_ term appears only as a platform's own field name (`owner_id`), never as our identifier or prose: say _manager_, _place_, _team_, _matchup_. The test covers the unambiguous terms; the reviewer covers the rest, such as _player_ for a manager or _roster_ for a team, and prose in strings.
- A domain noun the diff introduces (a file, a setting, a role, a command) has a `GLOSSARY.md` entry, and the code names it with that term. Source: `docs/agents/ticket-workflow.md`, step 1.
- Team identity follows ADR 0001: `<platform>:<team id>`, scoped to one season.

## Tests

- Tests sit at the agreed seams (spec #37, Testing Decisions): **Seam 1**, the library API against a temp workspace, built with `test/support/workspace.ts` (file transport over the committed fixtures, fixed clock, recording clipboard); **Seam 2a**, normalizer from snapshot to model; **Seam 2b**, the validator.
- Assert on what a pundit or league member could observe: files written, text published, what was copied, the problems returned.
- Expected values come from an independent source: a hand-checked literal from the fixture payloads (`npm run fixture:show`), the spec, a worked example.
- Fixtures are real scrubbed payloads replayed as snapshots. A variant is a real payload patched through a wrapping transport, never a hand-built model.
- Seam 2b is the exception: the validator's input is an evidence pack, not a payload, so its tests may use a literal pack whose values are hand-checked against a fixture week (`test/support/week8-evidence.ts`). `test/stats.test.ts` asserts the evidence-pack builder against that literal, so keep the two in step.
- Validator behaviour on ordinary prose is pinned by `test/support/plain-prose.ts`: a sentence that tripped the validator in review goes there, so it can never come back hard.
