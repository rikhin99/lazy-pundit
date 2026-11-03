#!/bin/sh
# PreToolUse hook on Bash: source and test files change through the Edit tool,
# which fails loudly when its text doesn't match. Blocked: an in-place sed or
# perl edit naming src/ or test/, and a python script that writes to a quoted
# src/ or test/ path. A python script that only reads, or writes elsewhere
# (docs, the scratchpad), runs.
cmd=$(jq -r '.tool_input.command // ""')
msg="Edit src/ and test/ files with the Edit tool: it fails loudly on a miss, unlike an in-place shell edit."
if printf '%s' "$cmd" | grep -Eq '(sed|perl) +-[a-zA-Z]*i' &&
  printf '%s' "$cmd" | grep -Eq '(^|[ "'"'"'/])(src|test)/'; then
  echo "$msg" >&2
  exit 2
fi
if printf '%s' "$cmd" | grep -Eq 'python3? +(-c|-) ' &&
  printf '%s' "$cmd" | grep -Eq '\.write\(|write_text\(|write_bytes\(' &&
  printf '%s' "$cmd" | grep -Eq "[\"']([^\"' ]*/)?(src|test)/[^\"']*[\"']"; then
  echo "$msg" >&2
  exit 2
fi
exit 0
