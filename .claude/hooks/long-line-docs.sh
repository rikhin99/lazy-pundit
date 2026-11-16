#!/bin/sh
# PreToolUse hook on Bash: module-map.md's rows and CHANGELOG.md's bullets are
# each one long line, so a grep or sed on them prints whole rows (6.2k for one
# module-map grep and 3.3k for a CHANGELOG sed in #110's retro). A grep with
# a `| cut` clip, or for headings, gives the same in a line (a `-o` window can
# hit ugrep's complexity limit, #83's retro).
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

if printf '%s' "$cmd" | grep -Eq '(grep|sed|cat|head|tail)\b[^;&|]*(module-map\.md|CHANGELOG\.md)'; then
  if printf '%s' "$cmd" | grep -Eq "grep +([^;&|]* )?-[A-Za-z]*o|grep +([^;&|]* )?['\"]?\^#|\| *cut "; then
    exit 0
  fi
  echo "module-map.md and CHANGELOG.md hold one long line per row or bullet, so this prints them whole. Clip each matching line: \`grep -n -E '<term>' <file> | cut -c1-200\`, or list headings with \`grep -n '^#' <file>\`. A window such as \`grep -o '.\\{0,120\\}<term>.\\{0,120\\}'\` can fail with ugrep's \"exceeds complexity limits\" on long or case-blind patterns." >&2
  exit 2
fi
exit 0
