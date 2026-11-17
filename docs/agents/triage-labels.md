# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## Briefs

A `ready-for-human` brief for a run against a live league points to `docs/agents/live-run.md`, which the session running it follows.

Run each command an acceptance criterion names at HEAD before writing the criterion, and write what it does now. A guessed cause stays out of the desired behaviour until it's confirmed. In #75, "every other scenario still exits 0" was false for the four Ctrl-C scenarios, which exit 1 by design, and the offline key check it asked for already happened at HEAD.

A brief that words a message: list the states that reach its throw and check its fix holds in each, as CODING_STANDARDS.md's boundary-error rule asks. In #91, the fixed indent hint for front matter that isn't valid YAML also printed for a value with a colon or an unclosed bracket, where it's wrong, and the standards review caught it only after the build.

A message that tells the pundit what to run or edit, a note as much as an error: run each instruction as written at HEAD, from the pundit's home folder, and where it removes an entry, with that entry the last one. In #97, the brief's note said `lazy-pundit setup <step>`, which works only inside the workspace, and "delete its line under `workspaces:`", which with one league left a bare `workspaces:` that every command refused; the hand check and the spec review each found one.

A criterion that asks for a test gives the expected value as a literal, as CODING_STANDARDS.md's Tests rule asks; a test that must fail when a list grows pins the list as a literal. In #97, "built from the list, or checked against it" led to an expectation built from `RERUN_STEPS`, the code under test, and the standards review asked for the literal.

A criterion that finds generated text inside text the pundit may edit (a stat line, a tag) names an edit that still contains it, with words added at either end, and what that edit shows. In #120, "wherever it appears whole" was built as a substring match, and the spec review found "…Bench Mob and Alpha" showing as "and Alpha".

A criterion for a warning names what clears it: undoing the change, republishing, or a later week. In #76 the brief said when the changed-outcome warning shows but not what ends it, and the spec review found that republishing left it showing, since outcomes were recorded only at draft time.

An example output in a brief matches its criteria: work it out for the fixture week and keep one source for each value. A layout criterion, such as a row fitting on one line, names the narrowest width it holds at. In #94, the example header said "data through week 9" while the criteria said the ranking week (10), and "each row stays on one line" can't hold below about 69 columns.

A desired literal HEAD can't produce yet starts from HEAD's output for the same text, with only the changed part edited. Run the same text in each section a row names: a claim judged against another team's stats carries that team's ID on its reason (`sleeper:6/streak is L3`, not `streak is L3`). In #104, rows 1 and 2's desired reasons were written from the section-6 rows, and the build pinned the prefixed form.

A criterion that already holds at HEAD, a guard against a regression, is seen red by `npm run -s mutate`, and the criterion names the mutation: "seen red first" can't hold for it. In #108, "draft prints it exactly once" and "at 0600, no warning" already passed at HEAD. The first went red by printing the warning a second time. The second had no mutation short of breaking `config.ts`'s mode check, and went unseen. Run the named mutation against HEAD's code before posting the brief; a guard no mutation turns red is a regression check, not a criterion. A guard on code the ticket adds names the mutation to make after the build ("remove the new no-comma condition"), and the build's run of it is its red: in #128 the guard kept ", and" reading the winner, and no mutation at HEAD could reach the condition. In #124 the brief's suggested mutation couldn't turn its guard red once built, since each clause held one cue, and the build carried the unmet criterion through review and sweep.
