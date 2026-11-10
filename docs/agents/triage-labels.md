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

Run each command an acceptance criterion names at HEAD before writing the criterion, and write what it does now. A guessed cause stays out of the desired behaviour until it's confirmed. In #75, "every other scenario still exits 0" was false for the four Ctrl-C scenarios, which exit 1 by design, and the offline key check it asked for already happened at HEAD.

A brief that words a message: list the states that reach its throw and check its fix holds in each, as CODING_STANDARDS.md's boundary-error rule asks. In #91, the fixed indent hint for front matter that isn't valid YAML also printed for a value with a colon or an unclosed bracket, where it's wrong, and the standards review caught it only after the build.

A criterion for a warning names what clears it: undoing the change, republishing, or a later week. In #76 the brief said when the changed-outcome warning shows but not what ends it, and the spec review found that republishing left it showing, since outcomes were recorded only at draft time.

An example output in a brief matches its criteria: work it out for the fixture week and keep one source for each value. A layout criterion, such as a row fitting on one line, names the narrowest width it holds at. In #94, the example header said "data through week 9" while the criteria said the ranking week (10), and "each row stays on one line" can't hold below about 69 columns.
