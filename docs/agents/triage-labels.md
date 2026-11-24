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

Run each command an acceptance criterion names at HEAD before writing the criterion, and write what it does now. A guessed cause stays out of the desired behaviour until it's confirmed. A criterion about an outside event (a signal, a closed tab, a dropped connection) reproduces it the way a user causes it, since a stand-in can pass where the real event fails: #140's `kill -HUP` left the terminal writable, and a real tab close crashed on the restore's write. In #75, "every other scenario still exits 0" was false for the four Ctrl-C scenarios, which exit 1 by design, and the offline key check it asked for already happened at HEAD.

A bug brief's red-first test runs on a fixture that has the bug's shape: check the payload at HEAD with `npm run fixture:show`. A scrubbed fixture is often tidier than the live answer, and then the brief names the patch that restores the shape. In #116, Hot Takery's box scores held only their own week, where ESPN sends the whole schedule, so a literal on the replay was green at HEAD and the red came from `failingOn` with an `answer`.

A brief that words a message: list the states that reach its throw and check its fix holds in each, as CODING_STANDARDS.md's boundary-error rule asks. In #91, the fixed indent hint for front matter that isn't valid YAML also printed for a value with a colon or an unclosed bracket, where it's wrong, and the standards review caught it only after the build.

A message that tells the pundit what to run or edit, a note as much as an error: run each instruction as written at HEAD, from the pundit's home folder, and where it removes an entry, with that entry the last one. In #97, the brief's note said `lazy-pundit setup <step>`, which works only inside the workspace, and "delete its line under `workspaces:`", which with one league left a bare `workspaces:` that every command refused; the hand check and the spec review each found one.

A criterion that asks for a test gives the expected value as a literal, as CODING_STANDARDS.md's Tests rule asks; a test that must fail when a list grows pins the list as a literal. In #97, "built from the list, or checked against it" led to an expectation built from `RERUN_STEPS`, the code under test, and the standards review asked for the literal.

A criterion that finds generated text inside text the pundit may edit (a stat line, a tag) names an edit that still contains it, with words added at either end, and what that edit shows. In #120, "wherever it appears whole" was built as a substring match, and the spec review found "…Bench Mob and Alpha" showing as "and Alpha". Name one with only the pundit's punctuation added to end it ("<stat line>. They are cooking.") too: #121's brief didn't, the row quoted "<stat line>.", and the decision came after the sweep, as a second commit.

A criterion for a warning names what clears it: undoing the change, republishing, or a later week. In #76 the brief said when the changed-outcome warning shows but not what ends it, and the spec review found that republishing left it showing, since outcomes were recorded only at draft time.

An example output in a brief matches its criteria: work it out for the fixture week and keep one source for each value. A layout criterion, such as a row fitting on one line, names the narrowest width it holds at. In #94, the example header said "data through week 9" while the criteria said the ranking week (10), and "each row stays on one line" can't hold below about 69 columns.

A desired literal HEAD can't produce yet starts from HEAD's output for the same text, with only the changed part edited. Run the same text in each section a row names: a claim judged against another team's stats carries that team's ID on its reason (`sleeper:6/streak is L3`, not `streak is L3`). In #104, rows 1 and 2's desired reasons were written from the section-6 rows, and the build pinned the prefixed form.

A criterion that already holds at HEAD, a guard against a regression, is seen red by `npm run -s mutate`, and the criterion names the mutation: "seen red first" can't hold for it. Name only a mutation you've run at HEAD and seen turn the test red, or leave the choice to the build. In #134, the brief's "the verdict judging the untrimmed inner text" survived, since `agrees` reads " 23.9, " as 23.9. In #108, "draft prints it exactly once" and "at 0600, no warning" already passed at HEAD. The first went red by printing the warning a second time. The second had no mutation short of breaking `config.ts`'s mode check, and went unseen. Run the named mutation against HEAD's code before posting the brief; a guard no mutation turns red is a regression check, not a criterion. A guard on code the ticket adds names the behaviour the mutation brings back ("the 'them' reading reaches the clause after ', and'"), and the build picks the edit and runs it as its red: in #128 the brief named a no-comma condition to remove, the build turned out not to need one, and that mutation survived. In #124 the brief's suggested mutation couldn't turn its guard red once built, since each clause held one cue, and the build carried the unmet criterion through review and sweep.

A brief that changes what a claim reports (its words, offsets, status or reason) says whether it covers tagged claims, untagged ones or both, with a criterion for each it covers. In #130 the brief named only untagged cases, and whether `[127,]{ev=w8.points}` kept its comma first came up at the sweep, as a second commit. A rule that trims or normalizes text says what happens to text it trims to nothing. In #134, `[   ]{ev=w10.margin}` became the claim "" with nothing underlined, found by the spec review, and the maintainer's decision (its own problem, "empty tag") came as a second commit.

A criterion that something is absent ("no power-score value") names what a test looks for that nothing else on the page can match, such as a label. A decided value ("an empty list reads none") names the fixture case that reaches it, found at HEAD, or the patch that makes one. In #132, a power score rounded to two places matched a team's luck, so the absence test took three tries, and no week-10 team had an empty injuries list, so the test had to patch the players file.
