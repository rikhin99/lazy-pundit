#!/bin/sh
# PreToolUse hook on Bash: module-map.md's rows and CHANGELOG.md's bullets are
# each one long line, so a grep or sed on them prints whole rows (6.2k for one
# module-map grep and 3.3k for a CHANGELOG sed in #110's retro). A grep with
# -o and a window around the term, or for headings, gives the same in a line.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

if printf '%s' "$cmd" | grep -Eq '(grep|sed|cat|head|tail)\b[^;&|]*(module-map\.md|CHANGELOG\.md)'; then
  if printf '%s' "$cmd" | grep -Eq "grep +([^;&|]* )?-[A-Za-z]*o|grep +([^;&|]* )?['\"]?\^#|\| *cut "; then
    exit 0
  fi
  echo "module-map.md and CHANGELOG.md hold one long line per row or bullet, so this prints them whole. Clip to the term: \`grep -n -o '.\\{0,120\\}<term>.\\{0,120\\}' <file>\`, list headings with \`grep -n '^#' <file>\`, or pipe through \`cut -c1-200\`." >&2
  exit 2
fi
exit 0
