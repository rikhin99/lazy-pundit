#!/bin/sh
# PostToolUse hook on Edit and Write: in #100 and #102 the standards review's
# one hard finding was the same CODING_STANDARDS.md rule, a validator change
# with no plain-prose entries, costing a review-fix round each time. The rule
# is read only at review, so this shows it to the builder, once per session,
# on the first edit of a file that decides which words are a claim or which
# team a claim reads. It doesn't block: the edit has already happened. In
# #104 it showed, but "the new words" read as new claim phrases only, so a
# team change went to review with no PLAIN_PROSE sentence, and the spec review
# found the changed pronoun leaking into a later clause that carried on from
# it: the message now names each branch and the carry-on sentence. In #124
# a stat-cue change (nearest cue, not list order) fit neither branch, and the
# spec review found "ranked 2nd in points" reading place: a third branch now
# names cue pairs sharing a clause. In #127 the claims diff came in, read
# only from ticket-workflow.md, so the message points to it too.
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
session=$(printf '%s' "$input" | jq -r '.session_id // "none"')

case "$file" in
*/src/validator/extract.ts | */src/validator/claims-team.ts) ;;
*) exit 0 ;;
esac

marker="${TMPDIR:-/tmp}/lazy-pundit-plain-prose-$session"
[ -e "$marker" ] && exit 0
: >"$marker"

echo "Before review, add to test/support/plain-prose.ts (CODING_STANDARDS.md, Tests). A new or widened claim phrase: sentences with its words and no claim to PLAIN_PROSE, and true claims using it to TRUE_UNTAGGED, with their evidence IDs. A change to which team or week a word or claim reads: a sentence with the changed word and no claim to PLAIN_PROSE; every true sentence your new tests use to TRUE_UNTAGGED; and to TRUE_UNTAGGED, a sentence where a later clause naming no subject carries on from the changed clause, and one with brackets straight after it, since every claim's-team rule reads the same names. A change to which stat a cue picks: to TRUE_UNTAGGED, a true sentence for each pair of cue kinds that can share a claim's clause (a ranking cue beside a stat cue, two stat cues), since the pair's winner may change. Then, before the reviews, run \`npm run -s claims:diff\` and paste its output into the spec review's brief (docs/agents/workflow/validator.md)." >&2
exit 2
