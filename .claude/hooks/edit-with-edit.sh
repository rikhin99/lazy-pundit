#!/bin/sh
# PreToolUse hook on Bash: source and test files change through the Edit tool,
# which fails loudly when its text doesn't match. Blocked: an in-place sed or
# perl edit naming src/ or test/ in its own command (split on &&, || and
# newlines, never on ; or |, which a sed script may hold), so a vitest run of
# a test/ file beside a sed -i of scripts/ passes; and a python script that
# writes and names a quoted path starting at src/ or test/ (bare, ./ or the
# repo's absolute path).
# A python script that only reads, or writes elsewhere (docs, scripts, the
# scratchpad), runs, even when the text it writes quotes a src/ path, such as
# "$repo/src/cli.ts" in scripts/drive-wizard.exp.
cmd=$(jq -r '.tool_input.command // ""')
msg="Edit src/ and test/ files with the Edit tool: it fails loudly on a miss, unlike an in-place shell edit. Send each change as its own Edit call, all in one message; to rewrite most of a file, Write it whole."
if printf '%s\n' "$cmd" | awk '{ gsub(/&&|\|\|/, "\n"); print }' |
  grep -E '(sed|perl) +-[a-zA-Z0-9]*i' |
  grep -Eq '(^|[ "'"'"'/])(src|test)/'; then
  echo "$msg" >&2
  exit 2
fi
repo=$(printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}" | sed 's/[].[*^$\\]/\\&/g')
if printf '%s' "$cmd" | grep -Eq 'python3? +(-c|-) ' &&
  printf '%s' "$cmd" | grep -Eq '\.write\(|write_text\(|write_bytes\(' &&
  printf '%s' "$cmd" | grep -Eq "[\"'](\./|$repo/)?(src|test)/[^\"']*[\"']"; then
  echo "$msg" >&2
  exit 2
fi
exit 0
