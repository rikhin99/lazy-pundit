# Ticket workflow

The steps around `/implement <ticket>`, in order. Each ends on the condition that says it's done.

## 1. Glossary first, before the first test

Before reading code, list what the ticket adds. If it adds two or more commands or behaviours with their own seams, propose a split once, naming the line to cut on.

List every domain noun the ticket brings or renames: a file, a setting, a role, a command, a state. Run `/domain-modeling` for each one that `GLOSSARY.md` doesn't define, at the same time as agreeing the test seams. Then name files, fields and functions after the glossary terms.

Read the ticket and the spec sections it cites. To find where a neighbouring ticket's scope begins, ask an Explore subagent for a short brief rather than reading the ticket. To find code, start from the module map's exports column and read only the functions you need, not whole files.

Done when every noun on the list has a glossary entry. The code and tickets then use those names from the start. In #51 the glossary came last, which forced a code rename (`usage.yaml` → `spend.yaml`) and a second pass over 10 tickets and comments.

## 2. Build and review

`/implement`: TDD at the agreed seams, then `/code-review` in two subagents, then commit to `main`. A seam the ticket names is agreed; ask before testing at any other.

Add to the spec subagent's brief: "Run the built library in scratch scripts: the ticket's commands in sequence, and each failure after a command has begun writing."

Before committing, undo each review fix's source change and see its test go red. Tighten any test that stays green. Done when every fix has a test seen red. In #55 part (a), one of six fixes' tests stayed green: it missed the snapshot a late failure leaves behind.

While building, run only the affected test files. The commit's pre-commit hook runs typecheck, lint and the full suite, and that is the final full-suite run.

## 3. Sweep the tickets in one subagent

Hand the sweep to one subagent, so the main session doesn't spend tokens reading tickets. Give it this prompt, with the blanks filled:

> Ticket #<n> was built in <sha>. Decisions the diff doesn't show, with any claim nobody ran marked "from reading the code": <list>. Closed tickets it refined, each with the decision: <list>.
>
> First pass: read every open ticket, not only keyword matches, in this one call. It leaves out the spec, the map and each ticket's earlier "Input from" sections:
>
> ```sh
> gh issue list --state open --limit 200 --json number,title,body,comments --jq '[.[] | select(.number != 37 and .number != 1) | {number, title, body: (.body | split("\n## ") | map(select(startswith("Input from") | not)) | join("\n## ")), comments: [.comments[].body]}]'
> ```
>
> Grep #37 and #1 for #<n> and for the terms the build changed. Second pass: read the full text of only the tickets the build affects, or whose conflict with it the first pass leaves unclear, in one call: `gh issue list --state open --limit 200 --json number,title,body,comments --jq '[.[] | select(.number | IN(<numbers>))]'`. Then:
> - Add an "Input from #<n> (<sha>)" section to an open ticket only when the build changes what that ticket has to do. Keep it to about five lines.
> - Comment "Refined by #<n> (<sha>): …" on each closed ticket listed above, with its decision.
> - Comment on #<n> with what was built, then close it. For one part of a split ticket, keep it open and say what the next part still owes.
>
> Rules:
> - Every identifier you cite (function, file, field, command) must exist in <sha>; check it with `git grep`. Describe anything not built yet in words ("a function that adds to the month's spend"), never as a made-up name.
> - Keep the "from reading the code" mark on any claim you repeat, and add it to your own findings that you didn't run.
> - Use `GLOSSARY.md` terms, and avoid its _Avoid_ terms.
> - Write each new section or comment with the Write tool to a file in the scratchpad folder, and write only the new text. Pass a comment with `--body-file`. Append a section with `{ gh issue view <t> --json body --jq .body; echo; cat <file>; } | gh issue edit <t> --body-file -`. No heredocs.
>
> Report each ticket you changed and what you changed, then list the other open tickets by number as unaffected.

Done when the subagent's report accounts for every open ticket.

## 4. Measure

Run `/context` and compare it with the 150k smart zone, run `npm run trace` for where the context went, then run `/retro`. The user pushes `main` (`! git push origin main`); `git push` is blocked for agents.
