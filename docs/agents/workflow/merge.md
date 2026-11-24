# A step that keeps what the pundit wrote

Read when a ticket changes how a setup step rewrites a file the pundit edits while keeping their lines: `setup lore` (`withEntriesOf` in `rerun.ts`) or `setup stakes` (`withBodyOf`) (`ticket-workflow.md`, step 2).

Keep the pundit's lines as written and drop only the lines the step writes itself, since a rule that picks which lines to keep loses whatever it doesn't recognise.

Before the first test, scratch-run the rule on each of these shapes, and make each one a test:

- a comment spanning lines, opened on a kept line and on a line the step drops;
- blank lines between entries, and a comment-only line;
- CRLF line endings;
- text above the first heading;
- the same answers twice: the second run asks nothing.

Write the file by hand from `twoTeamLore()`'s `writeBody` in `test/support/workspace.ts`; the step's top comment holds example `## ` headings, so a test that cuts the file at a heading cuts at the last one.

A refusal or warning about the merged text names lines in the pundit's file, so map its line numbers back (`messages.md`).
