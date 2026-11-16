#!/bin/sh
# PreToolUse hook on Bash: `npm run mutate` runs on its own, one per command
# (docs/agents/ticket-workflow.md, step 2). Chained or looped mutations break
# on the shell: in #59 part (b) a loop split pairs on the code's `||`, and in
# #120 an `echo ===` between two calls stopped the second. In #93 a check for
# loops matched a `for (` line in a heredoc's script, so the rule is now the
# whole command: quoted arguments and `2>&1` aside, nothing chains or pipes.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
printf '%s' "$cmd" | grep -Eq 'npm +run +(-s +)?mutate' || exit 0
rest=$(printf '%s' "$cmd" |
  perl -0777 -pe 's/'"'"'[^'"'"']*'"'"'//g; s/"(?:[^"\\]|\\.)*"//g; s/[0-9]*>&[0-9]+//g; s/\s+$//')
if printf '%s' "$rest" | grep -q '[;&|`]' ||
  printf '%s' "$rest" | grep -q '\$(' ||
  [ "$(printf '%s\n' "$rest" | wc -l | tr -d ' ')" -gt 1 ]; then
  echo "Run \`npm run -s mutate\` on its own in a Bash call, one mutation per call: send several calls in one response instead." >&2
  exit 2
fi
exit 0
