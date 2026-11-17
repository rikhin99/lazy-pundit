# A change to a committed fixture set

Read when a ticket changes `scripts/scrub-*.ts` or regenerates a committed fixture set (`ticket-workflow.md`, step 2).

A fixture ticket has no command to run, so the spec review's runs are these, in place of the scratch scripts:

- Move `fixtures/raw` to the scratchpad, run the affected test files, then move it back and check `fixtures/raw/espn` and `fixtures/raw/sleeper` are there. This is what CI sees: a criterion "checked in CI" holds only if its test runs here, not skips.
- With `fixtures/raw` back, re-run the scrub (`npm run -s scrub:sleeper` or `scrub:espn`): `git status` shows no further fixture change, and the name check in `sleeper-fixtures` or `espn-fixtures` passes.

A scrub change moves a snapshot ID only if it changes what `coveredData` covers (`src/data-hash.ts`); manifests and blobs can change while the IDs stay put. In #68, #40's "snapshot IDs change too" didn't hold: the data hash covers no bracket before its round is played.
