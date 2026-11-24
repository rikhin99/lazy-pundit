# Ticket workflow: the incidents behind the rules

Each rule in `docs/agents/ticket-workflow.md` came from a ticket where its absence cost tokens or a second round. Read this file when weighing whether to change or drop a rule, not while building. A retro that adds a rule adds its incident here, under the step.

## Before step 1

- #110 ran a live run and its fixes in one session and ended at 173k; a live run now ends at its results comment.
- #55 and #60 were split, and each part still ended well over the 150k zone while paying for its own review and sweep.

## Step 1: glossary first

- Grepping the whole glossary for the ticket's words cost #69 8k; `grep -n '^\*\*' GLOSSARY.md` lists the headings in about 1k.
- In #136, two line-range reads of the glossary (73 and 17 lines) cost about 10k, and the build used three entries.
- In #69, "player fact" was in the ticket's title and body, and step 1 reported no new noun until the standards review caught it.
- In #61 part (a), `most-bench-points` carried the _Avoid_ term "bench points" into `league.md`; `test/glossary-terms.test.ts` checks dashed values too.
- In #82 the step was skipped, and the error's "snapshots folder" and "season folder" went in undecided, since the glossary test checks only _Avoid_ terms.
- In #51 the glossary came last, which forced a code rename (`usage.yaml` → `spend.yaml`) and a second pass over 10 tickets and comments.
- In #118 the brief's "its path as the CLI shows paths" went in workspace-relative as a "known choice"; after the sweep the maintainer asked for the CLI's paths: a second commit, about 15k.
- #50's twenty ticket sections ran to 14.8k characters, and its build used the brief alone.
- In #132 the decision came after the brief, and reading only the latest comment missed the criteria.
- In #90 the whole thread came in with the workflow doc, 6.4k.
- In #90, bare `snapshot` and `refresh` greps of the module map pulled in three pipeline paragraphs where two rows were used.
- In #94, a new command named only by behaviour and nouns, the whole module map cost 11.7k and five rows plus the CLI seam were used. In #82, #84 and #72 the whole map was the largest read (about 10k); #82 used two rows, one pipeline line and one seam bullet.
- In #50 part (b), messages.md's grep printed `cli.ts`'s `table` help ("each with its starting place and stats"), but step 1's message didn't list it, and only the standards review caught it.

## Step 2: build and review

- In #50 part (a), twelve guessed team names took a red run to correct. In #50 part (b), a guessed problems heading ("1 soft problem:" for "Problems: 0 hard, 1 soft") and guessed week-1 lines took two more.
- In #130 a guard's mutation listed 42 red tests, 5.4k, without the `-t` name.
- In #125 the formatter had rewrapped `LOSS_VERB`, and an `<old>` copied from the edit matched nothing.
- In #129, widening the count regex to decimals so "a decimal counted as a count" had a mutation target made "2.0 high scores" a rule's count, out of scope; only the spec review caught it.
- In #59 part (b), a mutation loop that split pairs on `|` broke on the code's `||`.
- In #89, two mutations ran during the spec review, and its scratch tests saw 5 failures it couldn't explain.
- In #77, nine mutations by hand (Edit, test run, `git checkout`, re-Read) cost about 25k.
- In #60 part (b), the checklist tests were written with their code and first seen red only by a mutation after the build.
- In #56 part (b), searching for the implement skill with `find` cost 7.4k.
- In #58 a rerun of the spec review's script after a fix printed both style pages whole, 7k for two lines of counts, and the brief's extra `draft` step failed on the fixture's own draft.
- In #101 the spec review rebuilt `dist` and re-blobbed the replay by hand for a patch (67k against the standards review's 45k), where a scratch test file did it in about 2k.
- In #73 the spec review's `refresh` runs replayed week 9 over a week-8 draft and got "No changes", so the path that edits the front matter went unrun.
- In #107 the spec brief didn't name HEAD's saved output, and the review copied HEAD's script into `scripts/` to rebuild it.
- In #60 part (a), a one-liner's failed `cd` left its `mkdir` and `touch` running in the repo.
- In #56 part (a), a vitest run outside the repo root hung past its timeout.
- In #131, `teamInjuries` moved to `evidence-pack.ts` after both reviews, and its body-part mutation turned the week-10 row test red.
- In #95, the view's test built its expected rows by calling `statsTableLines`, and the function's mutation stayed green there until the rows were written out.
- In #134, folding three trims into `claimWords` left two auto-tag span mutations surviving, until a spaced-score test was added.
- In #55 part (a), one of six fixes' tests stayed green: it missed the snapshot a late failure leaves behind. In #55 part (b), a warning added after review misfired on auto-tagged stats, and only the sweep's scratch script caught it.
- In #47 part (a), `glossary-terms` and `module-map` tests failed only after the build was done; in #79, lint failed only at the commit.
- #128 left out its CHANGELOG line, and 0.1.2's entry missed its fix until the retro after #129.
- #101 wrote its commit message twice.
- In #98, "Fetching the league… prints before the refusal" went to review as cosmetic, and both reviews' fixes moved the refusal out of `checkLeague`.
- In #93 the hint search was pruned for speed, timed only on a fault no fix mends, and handed to the spec review as a question; it found three combinations the pruning hid, a second red-green round of about 20k.
- In #139 `setup lore` first kept only the lines that read as entries once comments were stripped, tested on plain bullets alone; the spec review found a comment spanning lines that lost its closing line and swallowed every later section, and blank lines, comments and CRLF that made an unchanged re-run show a diff: a second red-green round and eight more mutations, about 35k (`merge.md`). Its test helper also cut `lore.md` at the top comment's example `## League`, a red run.
## Step 3: sweep

- #118's e7e5d7f added a state and an option after the sweep, unreviewed.
- In #130, dropping an argument at 67 call sites by Edit cost about 11k.
- In #130 the sweep's section on #132 said tagged claims weren't trimmed, and a fix after the sweep trimmed them.
- #128 was filed with its options and criteria, and its triage minutes later replaced them.
- In #119, a file-or-leave question was rejected for "can we do the quick ones here".
- In #56, the changed-outcome warning in `check` and `publish` was left undone by both parts, and #56 was closed with no ticket owning it.
- Part (a) of #50's sweep listed the "Preseason" title and movement after a preseason as owed by part (b), though HEAD already did both; part (b) found out by a scratch run before its first test.
