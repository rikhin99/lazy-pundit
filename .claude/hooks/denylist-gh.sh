#!/bin/sh
# PreToolUse hook on Bash: an issue, PR or comment sent with `gh` never holds
# a real name from fixtures/denylist.txt, since an edited-out name stays in the
# text's edit history on the public repo (docs/agents/issue-tracker.md,
# "Personal data stays off GitHub"). Commits are checked by .husky's hooks.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

printf '%s' "$cmd" | grep -Eq 'gh +(issue|pr) +(create|comment|edit|close|review)\b|gh +api\b.*(body|mutation)' || exit 0

# The command's own text (an inline --body), then each body file it names:
# --body-file <f>, -F <f>, or gh api's -F body=@<f>.
files=$(printf '%s' "$cmd" |
  grep -Eo '(--body-file|-F)[ =]+[^ ;&|]+' |
  sed -E "s/^(--body-file|-F)[ =]+//; s/^[a-z_]+=@//; s/^@//; s/[\"']//g")
if ! {
  printf '%s\n' "$cmd"
  for f in $files; do [ -f "$f" ] && cat "$f"; done
} | node "$CLAUDE_PROJECT_DIR/scripts/denylist-check.ts"; then
  exit 2
fi
exit 0
