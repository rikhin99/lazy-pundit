#!/bin/sh
# PreToolUse hook on Bash: one `npm run mutate` per command
# (docs/agents/ticket-workflow.md, step 2). Chained or looped mutations break
# on the shell: in #59 part (b) a loop split pairs on the code's `||`, and in
# #120 an `echo ===` between two calls stopped the second.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
count=$(printf '%s' "$cmd" | grep -Eo 'npm +run +(-s +)?mutate' | wc -l | tr -d ' ')
if [ "$count" -gt 1 ] ||
  { [ "$count" -eq 1 ] && printf '%s' "$cmd" | grep -Eq '(^|[;&|(] *)(for|while) '; }; then
  echo "Run one \`npm run -s mutate\` per Bash call, with no loop: send several calls in one response instead." >&2
  exit 2
fi
exit 0
