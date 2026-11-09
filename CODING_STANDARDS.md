# Coding standards

Read during review. Each rule is a judgement call; the mechanical rules are tests in `test/injected-boundaries.test.ts` (outside world only through injected `Deps`; files written only through `src/workspace-files.ts`; the validator imports nothing beyond its own modules except league-model types; whether a lineup entry started is decided only by `isStarter`; a test never hand-builds a `League`), `test/format-versions.test.ts` (a file shape change needs a version bump) and `test/glossary-terms.test.ts` (no unambiguous glossary _Avoid_ term in identifiers or comments), and Biome and `tsc` cover formatting and types. Where a rule has a source, the source wins.

## Shape

- **Library first.** All behaviour lives in exported library functions. `src/cli.ts` only parses args, prompts and prints. Source: spec #37, Shape and runtime.
- **Platform-blind past the normalizer.** Only a platform's fetcher and normalizer (`src/<platform>/`) read raw payloads; everything else reads the league model in `src/league.ts`. Source: spec #37, Adapters.
- **zod at every boundary**: platform payloads, workspace files, config. A boundary error names the file or URL and what to fix.
- **Format versions.** Every workspace file the tool writes carries its version (`format:`, or `lore:` / `league:`), and a mismatch is refused with a message naming the file. League-facing outputs (`week-NN.txt`, style pages) go through `writeOutput` and carry none, and so does a `.gitignore`, which goes through `writeGitignore` because git reads it as it is.
- **Schema before writer.** A file written ahead of the ticket that reads it gets its zod schema now, in the reading module, and the writer's tests load what it writes through that schema. In #61 part (a), `init` wrote stakes fields for #56 with no schema, so no review could check them and #56 inherited a `per:` key nobody had agreed.
- **Fail before writing.** An error that stops a command is raised before its first write, so a failed command leaves nothing behind that a later command can't open.
- **Problems are reported, never fixed.** The pundit owns the order and the prose; validation names the team and line and leaves the order and the words alone. The one write is the auto-tag: `check` wraps a clear untagged claim in `[…]{ev=…}` without changing a word. Source: spec #37, Grounding (Auto-tag, Pundit edits).

## Names

- Code and comments use `GLOSSARY.md` terms. A glossary _Avoid_ term appears only as a platform's own field name (`owner_id`), never as our identifier or prose: say _manager_, _place_, _team_, _matchup_. `test/glossary-terms.test.ts` enforces the terms in its `ENFORCED` list; the reviewer judges those in `REVIEWED`, such as _player_ for a manager or _roster_ for a team, and prose in strings outside `src/prompt.ts`.
- A domain noun the diff introduces (a file, a setting, a role, a command) has a `GLOSSARY.md` entry, and the code names it with that term. Source: `docs/agents/ticket-workflow.md`, step 1.
- Team identity follows ADR 0001: `<platform>:<team id>`, scoped to one season.

## Tests

- Tests sit at the seams listed under "Tests" in `docs/agents/module-map.md`, and use that section's helpers: no live network, no real home directory, no real LLM.
- Assert on what a pundit or league member could observe: files written, text published, what was copied, the problems returned.
- Expected values come from an independent source: a hand-checked literal from the fixture payloads (`npm run fixture:show`), the spec, a worked example.
- Fixtures are real scrubbed payloads replayed as snapshots. A variant is a real payload patched through a wrapping transport, never a hand-built model.
- Seam 2b is the exception: the validator's input is an evidence pack, not a payload, so its tests may use a literal pack whose values are hand-checked against a fixture week (`test/support/week8-evidence.ts`). `test/stats.test.ts` asserts the evidence-pack builder against that literal, so keep the two in step.
- A fake-timer test advances the clock only once the code under test is idle on the timer alone (for a request, after `silentOn`'s `asked()`), since faked time races real disk reads: in #84, advancing 30 seconds first timed out a replay request still reading its payload.
- Validator behaviour on ordinary prose is pinned by `test/support/plain-prose.ts`: a sentence that tripped the validator in review goes there, so it can never come back hard. A new or widened claim phrase in `src/validator/extract.ts`, or a change to which stat a claim reads (its week or team), comes with sentences there that share its words but state no claim (an injury beside "knocked out", a draft round beside "first round", two weeks named in one sentence): in #72 two such sentences came back wrong, and in #78 "In week 7 they scored 87.86 and in week 8 they scored 133.22" read 87.86 against week 8, until the spec review's run found them.
