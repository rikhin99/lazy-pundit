# A change many tests see

Read when a ticket changes a helper in `test/support/`, or adds something to every draft's output, such as a league item or a warning (`ticket-workflow.md`, step 2).

A change to a helper in `test/support/`: run the full suite once, right after the change, since other test files call the helper too. In #79, `patchingTransport` took a patch's return value as a new payload, and two `init` tests whose patches return one by accident broke only at the commit, after both reviews.

A change that adds something to every draft's output: right after its first test is green, run the full suite once to see which tests break. Before fixing them, add one shared helper or constant in `test/support/workspace.ts` and update the tests with it in one pass. In #47 part (b), the correction-timing reminder broke 41 tests, which were fixed file by file before `withoutReminder` existed.
