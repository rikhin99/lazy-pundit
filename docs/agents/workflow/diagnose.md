# A ticket that says to diagnose first

Read when a ticket says to diagnose before choosing a fix (`ticket-workflow.md`, step 2).

The diagnosis is done when a scratch run of the fix's shape goes green, before any repo code. In #85, `scripts/prepare.ts` was written on the first cause found (`-g` reaching the child install), and a no-op `prepare` then showed that every `prepare` script breaks a global git install. That run, first, would have ruled the fix out.
