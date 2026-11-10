# Ticket workflow

The steps around `/implement <ticket>`, in order. Each ends on the condition that says it's done.

## 1. Glossary first, before the first test

Before reading code, list what the ticket adds. If it adds two or more commands or behaviours with their own seams, propose a split once, naming the line to cut on. Size alone is no reason, and a ticket's "Size watch" section is no reason either: #55 and #60 were split, and each part still ended well over the 150k zone while paying for its own review and sweep.

List every domain noun the ticket's text uses, or the build brings or renames, that `GLOSSARY.md` has no heading for: a file, a setting, each value a setting can take, a role, a command, a state. `grep -n '^\*\*' GLOSSARY.md` lists the headings in about 1k; grepping the whole glossary for the ticket's words cost #69 8k. In #69, "player fact" was in the ticket's title and body, and step 1 reported no new noun until the standards review caught it. `test/glossary-terms.test.ts` checks dashed values such as `losers-bracket` too: in #61 part (a), `most-bench-points` carried the _Avoid_ term "bench points" into `league.md`. Run `/domain-modeling` for each one that `GLOSSARY.md` doesn't define, at the same time as agreeing the test seams. Then name files, fields and functions after the glossary terms.

Read the ticket with `gh issue view <n> --json title,body,labels --jq '.title, .body'`, and the spec sections it cites. When the user names a comment, such as the latest, read that comment (`gh issue view <n> --json comments --jq '.comments[-1].body'`), not the whole thread. To find where a neighbouring ticket's scope begins, ask an Explore subagent for a short brief rather than reading the ticket. To find code, start from the module map's exports column and read only the functions you need, not whole files. Grep the map for the functions, files, glossary nouns and commands the ticket names, and for the test seam it touches (`grep -n -i -E 'checkDraft|evidence pack|^- \*\*CLI' docs/agents/module-map.md`), rather than reading it whole; read it whole only when nothing matches. In #94, a new command named only by behaviour and nouns, the whole map cost 11.7k and five rows plus the CLI seam were used. In #82, #84 and #72 the whole map was the largest read (about 10k), and #82 used two rows, one pipeline line and one seam bullet.

Done when the list is in a message, each noun with its `GLOSSARY.md` line or a new entry. A ticket with no new noun still gets the message: one line naming the glossary terms its user-facing text uses, and any phrase in that text the glossary doesn't define. In #82 the step was skipped, and the error's "snapshots folder" and "season folder" went in undecided, since the glossary test checks only _Avoid_ terms. The code and tickets then use those names from the start. In #51 the glossary came last, which forced a code rename (`usage.yaml` → `spend.yaml`) and a second pass over 10 tickets and comments.

## 2. Build and review

`/implement`: TDD at the agreed seams, then `/code-review` in two subagents, then commit to `main`. A seam the ticket names is agreed; ask before testing at any other. See each new test fail before writing the code that passes it. For a test of code that already exists, committed or written earlier in the build, see it go red with `npm run -s mutate -- <src-file> '<old>' '<new>' <test-file>`: it changes one place, runs that test file, prints the tests that went red (or "survived", exit 1) and puts the file back. It edits the file in the working tree, so run it before launching the reviews or after both have reported. In #89, two mutations ran during the spec review, and its scratch tests saw 5 failures it couldn't explain. In #77, nine mutations by hand (Edit, test run, `git checkout`, re-Read) cost about 25k. In #60 part (b), the checklist tests were written with their code and first seen red only by a mutation after the build.

A pasted `/implement` arrives as text, and the skill can't be loaded with the Skill tool, so read `~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/skills/engineering/implement/SKILL.md` directly. In #56 part (b), searching for it with `find` cost 7.4k.

Add to the spec subagent's brief: "Run the built library in scratch scripts: the ticket's commands in sequence, and each failure after a command has begun writing. Write each run as a script file in the scratchpad that starts with `set -euo pipefail` and sets `HOME` and the working directory to a temp folder. Drive `init` with `npm run -s drive:wizard -- <scenario>`, adding a scenario if yours is missing. For `refresh`, make the data change with a patched replay, so the run reaches the data-changed path." In #73 the spec review's `refresh` runs replayed week 9 over a week-8 draft and got "No changes", so the path that edits the front matter went unrun.

The same script rule holds for your own scratch runs. In #60 part (a), a one-liner's failed `cd` left its `mkdir` and `touch` running in the repo. A scratch run calls the library with `node`, which strips the types, or uses `npm run fixture:show`. In #56 part (a), a vitest run outside the repo root hung past its timeout.

See each review fix's test go red, by writing it before the fix or by undoing the fix. Tighten any test that stays green. A review fix that adds behaviour gets its own scratch run through the ticket's commands before committing, since no review sees it. A fix that no portable test can show failing, such as one that needs a write to fail, gets a scratch run that shows it instead, named in the commit message. Done when every fix has a test seen red, or that scratch run, and each added behaviour has had its run. In #55 part (a), one of six fixes' tests stayed green: it missed the snapshot a late failure leaves behind. In #55 part (b), a warning added after review misfired on auto-tagged stats, and only the sweep's scratch script caught it.

While building, run `npm run -s format` (it fixes formatting itself and fails on any other lint problem) with the typecheck, and the affected test files plus `test/glossary-terms.test.ts` and `test/module-map.test.ts`, which check every new comment and module. In #47 part (a), both failed only after the build was done; in #79, lint failed only at the commit. The commit's pre-commit hook runs typecheck, lint and the full suite, and that is the final full-suite run.

A change to a wizard prompt (`cli.ts`) or a setup step (`init.ts`): run `npm run -s drive:wizard:all` (about a minute) before committing, since CI runs it only after the push and the pre-commit hook doesn't.

A change to `package.json`'s `bin`, `files`, `dependencies` or `scripts`, to `src/cli.ts`'s entry, or to `scripts/release.ts`: run `npm run -s install:smoke` (about 20s) before committing, for the same reason.

A ticket that says to diagnose before choosing a fix: the diagnosis is done when a scratch run of the fix's shape goes green, before any repo code. In #85, `scripts/prepare.ts` was written on the first cause found (`-g` reaching the child install), and a no-op `prepare` then showed that every `prepare` script breaks a global git install. That run, first, would have ruled the fix out.

A change to a helper in `test/support/`: run the full suite once, right after the change, since other test files call the helper too. In #79, `patchingTransport` took a patch's return value as a new payload, and two `init` tests whose patches return one by accident broke only at the commit, after both reviews.

A change that adds something to every draft's output, such as a league item or a warning: right after its first test is green, run the full suite once to see which tests break. Before fixing them, add one shared helper or constant in `test/support/workspace.ts` and update the tests with it in one pass. In #47 part (b), the correction-timing reminder broke 41 tests, which were fixed file by file before `withoutReminder` existed.

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
> - For a line in #37 or #1 that the build contradicts, comment on that ticket quoting the line and the new behaviour, and leave its body as it is.
>
> Rules:
> - Every identifier you cite (function, file, field, command) must exist in <sha>; check it with `git grep`. Describe anything not built yet in words ("a function that adds to the month's spend"), never as a made-up name.
> - Keep the "from reading the code" mark on any claim you repeat, and add it to your own findings that you didn't run.
> - Use `GLOSSARY.md` terms, and avoid its _Avoid_ terms.
> - Write each new section or comment with the Write tool to a file in the scratchpad folder, and write only the new text. Pass a comment with `--body-file`. Append a section with `{ gh issue view <t> --json body --jq .body; echo; cat <file>; } | gh issue edit <t> --body-file -`. To correct a section, save the body to a scratch file, change it with Edit, then pass it with `--body-file`. No heredocs.
>
> Report each ticket you changed and what you changed, then list the other open tickets by number as unaffected. Then list each thing #<n> asked for that <sha> leaves undone and no open ticket owns.

Done when the subagent's report accounts for every open ticket, and the main session has asked the user whether to file each unowned item as a ticket. In #56, the changed-outcome warning in `check` and `publish` was left undone by both parts, and #56 was closed with no ticket owning it.

## 4. Measure

Run `/context` and compare it with the 150k smart zone, run `npm run trace` for where the context went, then run `/retro`. The user pushes `main` (`! git push origin main`); `git push` is blocked for agents. After the push, run `gh run watch` (or `gh run list --limit 1` once it's done) and report the CI result.
