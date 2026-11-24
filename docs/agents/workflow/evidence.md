# A new evidence ID

Read when a ticket adds an evidence ID or changes the shape of one's value (`ticket-workflow.md`, step 2).

- **How `check` judges it.** `kindOf` in `src/validator/evidence.ts` picks the kind from the ID's stat name, and `agrees` judges the claim's words against it. A number with no special kind is matched by `numMatch`. Any other string passes when the words contain it, ignoring case. So a string value is the shortest form a claim should be able to cite. In #136, ESPN's `Wed Nov 26` turned `[Nov 26]` wrong until the value became `Nov 26`, which the spec review found.
- **The prompt.** "Reading the evidence" in `src/prompt.ts` names each ID family by hand. A new ID gets a clause there saying what it is and when it's present.
- **A raw Sleeper field name.** `test/injected-boundaries.test.ts` fails on `.<sleeper_field>` outside `src/sleeper/`. It skips a `platform.<field>` ID, so `platform.trade_deadline` passes. Any other ID spelled like a Sleeper field (`wk.waiver_budget`) trips it. Check the rule before naming the ID.
- **The test.** stakes.test's "platform settings" case cites league IDs in the week intro and reads `check`'s problems by `id`. A right value is absent from the list, and a wrong one is `wrong`. An ID the pack doesn't hold that week is `unknown-id`.
