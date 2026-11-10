#!/bin/sh
# PreToolUse hook on Bash: a commit message written by a heredoc in the same
# command as `git commit` hides the commit from `npm run trace`, which skips
# commands naming the scratchpad (scripts/trace-context.ts, isRepoCommit).
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

if printf '%s' "$cmd" | grep -Eq '<<' &&
  printf '%s' "$cmd" | grep -Eq '(^|[;&|(] *)git +commit\b'; then
  echo "Write the commit message with the Write tool to a file in the scratchpad folder, then run \`git commit -F <file>\` as its own command, so \`npm run trace\` finds the commit." >&2
  exit 2
fi
exit 0
