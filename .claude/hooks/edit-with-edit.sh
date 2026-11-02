#!/bin/sh
# PreToolUse hook on Bash: source and test files change through the Edit tool,
# which fails loudly when its text doesn't match. An in-place sed, perl or
# python edit on src/ or test/ is blocked.
cmd=$(jq -r '.tool_input.command // ""')
if printf '%s' "$cmd" | grep -Eq '(sed|perl) +-[a-zA-Z]*i|python3? +(-c|-) ' &&
  printf '%s' "$cmd" | grep -Eq '(^|[ "'"'"'/])(src|test)/'; then
  echo "Edit src/ and test/ files with the Edit tool: it fails loudly on a miss, unlike an in-place shell edit." >&2
  exit 2
fi
exit 0
