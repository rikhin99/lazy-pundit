#!/bin/sh
# PostToolUse hook on Edit and Write: in #100 and #102 the standards review's
# one hard finding was the same CODING_STANDARDS.md rule, a validator change
# with no plain-prose entries, costing a review-fix round each time. The rule
# is read only at review, so this shows it to the builder, once per session,
# on the first edit of a file that decides which words are a claim or which
# team a claim reads. It doesn't block: the edit has already happened.
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

echo "A change to which words are a claim, or which team or week a claim reads, adds to test/support/plain-prose.ts before review (CODING_STANDARDS.md, Tests): sentences sharing the new words with no claim to PLAIN_PROSE, and true untagged claims using them to TRUE_UNTAGGED, with their evidence IDs." >&2
exit 2
