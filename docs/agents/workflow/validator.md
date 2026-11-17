# A change to the validator

Read when a ticket changes `src/validator.ts` or `src/validator/` (`ticket-workflow.md`, step 2).

Before launching the reviews, run `npm run -s claims:diff` (about a second; `-- <ref>` compares against another ref, such as `HEAD~1` after a commit). It runs `test/support/plain-prose.ts`'s sentences and its own cue-pair sentences through HEAD's validator and the working tree's on the week-8 fixture, and prints each sentence whose claims read differently, with both readings. Check each change is one the ticket means, and paste the output into the spec review's brief. In #124 a nearest-cue change turned "Ranked 2nd in points." wrong with every test green, and the spec review found it by rebuilding this comparison by hand (about 58k).

A change that fixes a reading `CUE_PAIRS_MISREAD` in `scripts/claims-diff-report.ts` lists turns `test/claims-diff-report.test.ts` red: take the sentence off that list.
