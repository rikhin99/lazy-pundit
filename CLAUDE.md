## Agent skills

### Issue tracker

Issues live in GitHub Issues (`rikhin99/lazy-pundit`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), and the checks before writing a brief's acceptance criteria. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Code layout

Before reading source files, read `docs/agents/module-map.md`: which module owns what, the test seams and their helpers. In `src/` and `test/`, read with `npm run outline -- <file>` and then ranges of 150 lines or fewer, and edit with the Edit tool. The repo's hooks refuse whole-file reads and shell edits there.

### Implementing a ticket

Follow `docs/agents/ticket-workflow.md`: glossary before the first test, then build, sweep and measure.
