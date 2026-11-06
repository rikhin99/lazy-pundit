#!/bin/sh
# PreToolUse hook on Read and Bash: a source or test file over 150 lines is
# read by range. `npm run outline -- <file>` lists each declaration's line
# range; read the ones you need with `sed -n a,bp` or Read's offset and limit.
# One Bash command reads at most 150 lines of src/ and test/ in all, summed
# over its `cat`s and `sed -n` ranges, so a ticket's code isn't read whole a
# few files at a time. To rewrite most of a file, read that one file whole
# with `sed -n 1,999p <file>`, alone in its command.
#
# GLOSSARY.md is read by section too, never whole: in #56 part (a) one `cat`
# of it beside the module map cost 16.8k, the ticket's largest jump.
input=$(cat)
gmsg="Read GLOSSARY.md by section: list the sections with \`grep -n '^## ' GLOSSARY.md\`, read the ticket's own with \`sed -n a,bp GLOSSARY.md\` or Read's offset and limit, and run \`grep -n -i -A3 '<noun>' GLOSSARY.md\` for each other noun."
msg="Read src/ and test/ files by range: run \`npm run outline -- <file>\`, then read only the functions you need with \`sed -n a,bp\` or Read's offset and limit (150 lines per command at most). To rewrite most of a file, read that one file whole with \`sed -n 1,999p <file>\`, alone in its command."
lines() { if [ -f "$1" ]; then wc -l <"$1" | tr -d ' '; else echo 0; fi; }
abs() { case $1 in /*) echo "$1" ;; *) echo "$CLAUDE_PROJECT_DIR/$1" ;; esac; }
srcfile() { case $1 in src/* | test/* | */src/* | */test/*) return 0 ;; esac; return 1; }

case $(printf '%s' "$input" | jq -r '.tool_name') in
Read)
  path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
  limit=$(printf '%s' "$input" | jq -r '.tool_input.limit // ""')
  if [ "$path" = "$CLAUDE_PROJECT_DIR/GLOSSARY.md" ] && [ -z "$limit" ]; then
    echo "$gmsg" >&2
    exit 2
  fi
  case $path in
  "$CLAUDE_PROJECT_DIR"/src/* | "$CLAUDE_PROJECT_DIR"/test/*)
    if [ -z "$limit" ] && [ "$(lines "$path")" -gt 150 ]; then
      echo "This file has $(lines "$path") lines; the limit is 150. $msg" >&2
      exit 2
    fi
    ;;
  esac
  ;;
Bash)
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
  # `head -N <file>` and `cat <file> | head -N` read N lines: count them as
  # `sed -n 1,Np <file>`.
  cmd=$(printf '%s' "$cmd" | sed -E \
    -e 's/cat +([^ ;&|<>]+) *\| *head +(-n +)?-?([0-9]+)/sed -n 1,\3p \1/g' \
    -e 's/head +(-n +)?-?([0-9]+) +([^ ;&|<>-][^ ;&|<>]*)/sed -n 1,\2p \3/g')
  total=0
  files=0
  # Each file argument of a `cat` that reads (not one writing with > or >>).
  for f in $(printf '%s' "$cmd" | grep -Eo '(^|[;&|(] *)cat( +[^ ;&|<>]+)+' | sed -E 's/^.*cat //'); do
    case $f in GLOSSARY.md | */GLOSSARY.md)
      echo "$gmsg" >&2
      exit 2
      ;;
    esac
    if srcfile "$f"; then
      total=$((total + $(lines "$(abs "$f")")))
      files=$((files + 1))
    fi
  done
  # Each `sed -n a,bp <file>` range, capped at the file's length.
  for r in $(printf '%s' "$cmd" | grep -Eo "sed -n '?[0-9]+,[0-9]+p'? +[^ ;&|<>]+" | sed -E "s/sed -n '?([0-9]+),([0-9]+)p'? +/\1,\2,/"); do
    a=${r%%,*}
    rest=${r#*,}
    b=${rest%%,*}
    f=${rest#*,}
    if srcfile "$f"; then
      n=$(lines "$(abs "$f")")
      [ "$b" -gt "$n" ] && b=$n
      [ "$b" -ge "$a" ] && total=$((total + b - a + 1))
      files=$((files + 1))
    fi
  done
  # One file read whole on its own is the rewrite escape hatch.
  if [ "$total" -gt 150 ] && ! { [ "$files" -eq 1 ] && printf '%s' "$cmd" | grep -Eq "sed -n '?1,999p"; }; then
    echo "This command reads $total lines of src/ and test/; the limit is 150. $msg" >&2
    exit 2
  fi
  ;;
esac
exit 0
