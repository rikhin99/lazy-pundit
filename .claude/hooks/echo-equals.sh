#!/bin/sh
# PreToolUse hook on Bash: zsh reads an unquoted word starting with `=` as a
# command's path, so `echo =====` fails with "===== not found" and stops the
# rest of the line. In #127 a separator between two reads cost a re-run; in
# #120 one between two mutate calls stopped the second.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

if printf '%s' "$cmd" | grep -Eq '(^|[;&|( ])echo +='; then
  echo "zsh reads an unquoted word starting with \`=\` as a command's path, so \`echo ===\` fails with \"not found\". Use a separator such as \`echo ---\` or quote it: \`echo '==='\`." >&2
  exit 2
fi
exit 0
