# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <path>`.
- **Multi-line bodies and comments**: write the text with the Write tool to a file in the scratchpad folder, then pass it with `--body-file <path>` (`gh issue create`, `gh issue edit`, `gh issue comment`). Ticket text is full of backticks and quotes, which can leave a shell heredoc waiting for input forever.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh issue create --blocked-by <n>,<n> ...` or `gh issue edit <child> --add-blocked-by <blocker>` (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, and remove one with `gh issue edit <child> --remove-blocked-by <blocker>` (2.94+) or `gh api --method DELETE repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by/<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Count open blockers**: `gh api -H 'Cache-Control: no-cache' repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by` (open blockers only; 0 means startable; without the header it can show a count from before an edge just changed). `gh issue view <n> --json blockedBy` (2.94+) also lists closed blockers, so filter it: `--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: post the explanation with `gh issue comment <number> --body "..."`, then `gh issue close <number>`. On an already-closed issue, `gh issue close --comment` drops the comment and still exits 0.

## Personal data stays off GitHub

The repo goes public with #96.

- **Prototype branches**: a prototype branch is scrubbed against `fixtures/denylist.txt` before it's pushed, or it stays local. The three existing ones (`prototype/grounding`, `prototype/power-score`, `prototype/ranking-views`, which issues cite as primary sources) are local-only once #96 deletes them from origin, kept in the gitignored `private/prototypes.bundle`: in a clone of it, `git fetch origin 'refs/heads/prototype/*:refs/heads/prototype/*'` restores them as branches.
- **Issue, comment and commit text**: write a placeholder (Tester A, Team A, `<league ID>`) for a tester's or another manager's name, username or team name, or a real league ID, the first time. Editing it out later leaves it readable in the text's edit history, which anyone can open on a public repo, and a revision can only be deleted by hand in the web UI. `scripts/denylist-check.ts` enforces the names in `fixtures/denylist.txt` on `gh` issue, PR and comment text (`.claude/hooks/denylist-gh.sh`) and on each commit's diff and message (`.husky`); league IDs aren't on the denylist, so they're on you.

## Reading spec #37

Spec #37's decisions (Implementation Decisions, Testing Decisions, Out of Scope, Further Notes) are in its first comment, not the body. The body holds only the user stories. Save each part to a file and grep `^#` for the sections a ticket names, rather than printing them whole:

```sh
gh issue view 37 --json comments --jq '.comments[0].body' > spec-37-decisions.md
gh issue view 37 --json body --jq .body > spec-37-stories.md
```

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

File issues only into the user's own repo. Never file into `mattpocock/skills` (the repo these skills come from) unless the user owns it. In a fork, `gh` can default to the upstream parent, so before the first `gh issue create` of a session, check the target with `gh repo view --json nameWithOwner` and confirm it with the user if it is not their repo.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number>`, then `gh pr view <number> --comments` (off a TTY, `--comments` prints only the comments, not the body), and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (see **Count open blockers**, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
