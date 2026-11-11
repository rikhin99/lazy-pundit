#!/bin/sh
# PreToolUse hook on Bash: a commit message here is one long line, so
# `git log --oneline` prints whole messages (about 3k for three commits in
# #100's retro). A truncated subject gives the same list in a few lines.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

if printf '%s' "$cmd" | grep -Eq '(^|[;&|(] *)git +([^;&|]* )?log\b[^;&|]*--oneline'; then
  echo "Commit messages here are one long line, so --oneline prints them whole. List commits with \`git log --format='%h %<(100,trunc)%s'\`, and read one message with \`git log -1 <sha>\`." >&2
  exit 2
fi
exit 0
