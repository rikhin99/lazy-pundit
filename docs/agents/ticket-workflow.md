# Ticket workflow

The steps around `/implement <ticket>`, in order. Each ends on the condition that says it's done.

## 1. Glossary first, before the first test

List every domain noun the ticket brings or renames: a file, a setting, a role, a command, a state. Run `/domain-modeling` for each one that `GLOSSARY.md` doesn't define, at the same time as agreeing the test seams. Then name files, fields and functions after the glossary terms.

Read the ticket and the spec sections it cites. To find where a neighbouring ticket's scope begins, ask an Explore subagent for a short brief rather than reading the ticket. To find code, start from the module map's exports column and read only the functions you need, not whole files.

Done when every noun on the list has a glossary entry. The code and tickets then use those names from the start. In #51 the glossary came last, which forced a code rename (`usage.yaml` → `spend.yaml`) and a second pass over 10 tickets and comments.

## 2. Build and review

`/implement`: TDD at the agreed seams, then `/code-review` in two subagents, then commit to `main`.

While building, run only the affected test files. The commit's pre-commit hook runs typecheck, lint and the full suite, and that is the final full-suite run.

## 3. Sweep the tickets in one subagent

Hand the sweep to one subagent, so the main session doesn't spend tokens reading tickets. Give it this prompt, with the blanks filled:

> Ticket #<n> was built in <sha>. Decisions the diff doesn't show: <list>.
>
> Read every open ticket in full (body and comments), not only keyword matches, in one call: `gh issue list --state open --limit 200 --json number,title,body,comments`. Also read the closed tickets and spec sections this one refines. Then:
> - Add an "Input from #<n> (<sha>)" section to each open ticket the build changes.
> - Comment "Refined by #<n> (<sha>): …" on each closed ticket whose decision it refined.
> - Comment on #<n> with what was built, then close it. For one part of a split ticket, keep it open and say what the next part still owes.
>
> Rules:
> - Every identifier you cite (function, file, field, command) must exist in <sha>; check it with `git grep`. Describe anything not built yet in words ("a function that adds to the month's spend"), never as a made-up name.
> - Use `GLOSSARY.md` terms, and avoid its _Avoid_ terms.
> - Write each body or comment with the Write tool to a file in the scratchpad folder, then pass it with `--body-file`. No heredocs.
>
> Report each ticket you changed and what you changed.

Done when the subagent's report covers every open ticket.

## 4. Measure

Run `/context` and compare it with the 150k smart zone, then run `/retro`. The user pushes `main` (`! git push origin main`); `git push` is blocked for agents.
