# The ticket sweep's prompt

Step 3 of `ticket-workflow.md` hands this to one subagent after the commit, with the blanks filled:

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
> - For a line in #37 or #1 that the build contradicts, comment on that ticket quoting the line and the new behaviour, and leave its body as it is.
>
> Rules:
> - Every identifier you cite (function, file, field, command) must exist in <sha>; check it with `git grep`. Describe anything not built yet in words ("a function that adds to the month's spend"), never as a made-up name.
> - Keep the "from reading the code" mark on any claim you repeat, and add it to your own findings that you didn't run.
> - Use `GLOSSARY.md` terms, and avoid its _Avoid_ terms.
> - Write each new section or comment with the Write tool to a file in the scratchpad folder, and write only the new text. Pass a comment with `--body-file`. Append a section with `{ gh issue view <t> --json body --jq .body; echo; cat <file>; } | gh issue edit <t> --body-file -`. To correct a section, save the body to a scratch file, change it with Edit, then pass it with `--body-file`. No heredocs.
>
> Report each ticket you changed and what you changed, then list the other open tickets by number as unaffected. Then list each thing #<n> asked for that <sha> leaves undone and no open ticket owns.
