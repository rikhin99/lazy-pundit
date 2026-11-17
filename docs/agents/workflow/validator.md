# A change to the validator

Read when a ticket changes `src/validator.ts` or `src/validator/` (`ticket-workflow.md`, step 2).

Before launching the reviews, run `npm run -s claims:diff` (about a second; `-- <ref>` compares against another ref, such as `HEAD~1` after a commit). It runs `test/support/plain-prose.ts`'s sentences and its own cue-pair sentences through HEAD's validator and the working tree's on the week-8 fixture, and prints each sentence whose claims read differently, with both readings. Check each change is one the ticket means, and paste the output into the spec review's brief. In #124 a nearest-cue change turned "Ranked 2nd in points." wrong with every test green, and the spec review found it by rebuilding this comparison by hand (about 58k).

Also before the reviews, run the full suite (`npx vitest run`): `check`, `draft`, `refresh` and the in-progress tests all reach the validator. In #126 a stricter cue rule passed the validator tests and both reviews, then broke `test/in-progress.test.ts` at the commit.

A wrong untagged claim carries no `id`, so a test that a claim isn't read against a stat asserts its `reason` too. In #126 a check over `id`s alone stayed green with the bug in place.

A claim phrase that reads data `blurb()` doesn't pass (house rules) runs `PLAIN_PROSE` again with that data, plus sentences where a number before the phrase isn't the claim (a week, a points value, a past ordinal). In #126 the corpus ran without rules, and the reviews found four misreads.

A rule that widens which team or stat a claim reads adds to `TRUE_UNTAGGED` a sentence matching the new trigger where the old reading is still right. In #128 a bare "and" after "them" began reading the team that lost, and "leaving them 4-4 and sit first" turned wrong; only the spec review's probes found it.

A change that fixes a reading `CUE_PAIRS_MISREAD` in `scripts/claims-diff-report.ts` lists turns `test/claims-diff-report.test.ts` red: take the sentence off that list.
