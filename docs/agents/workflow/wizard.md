# A change to the init wizard

Read when a ticket adds a `scripts/drive-wizard.exp` scenario, or changes a wizard prompt (`cli.ts`) or a setup step (`init.ts`) (`ticket-workflow.md`, step 2).

To check a scenario you added, pipe `npm run -s drive:wizard:plain -- <scenario>` through `grep -E '<its prompts>|WROTE|EXIT'`; its `WROTE` line names each workspace folder made under the temp home. Read the whole run only when that shows something wrong. In #99, four new scenarios read whole cost about 5k, where their folder lines, `WROTE` and `EXIT` take under 1k.

A change to a wizard prompt or a setup step: run `npm run -s drive:wizard:all` (about a minute) before committing, since CI runs it only after the push and the pre-commit hook doesn't.
