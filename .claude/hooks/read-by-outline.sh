#!/bin/sh
# PreToolUse hook on Read and Bash: a source or test file over 150 lines is
# read by range. `npm run outline -- <file>` lists each declaration's line
# range; read the ones you need with `sed -n a,bp` or Read's offset and limit.
# A whole-file read stays possible on purpose: `sed -n 1,999p <file>`.
input=$(cat)
msg="Read src/ and test/ files by range: run \`npm run outline -- <file>\`, then read the ranges you need with \`sed -n a,bp\` or Read's offset and limit. To rewrite most of a file, read it whole with \`sed -n 1,999p <file>\`."
long() { [ -f "$1" ] && [ "$(wc -l <"$1")" -gt 150 ]; }

case $(printf '%s' "$input" | jq -r '.tool_name') in
Read)
  path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
  limit=$(printf '%s' "$input" | jq -r '.tool_input.limit // ""')
  case $path in
  "$CLAUDE_PROJECT_DIR"/src/* | "$CLAUDE_PROJECT_DIR"/test/*)
    if [ -z "$limit" ] && long "$path"; then
      echo "$msg" >&2
      exit 2
    fi
    ;;
  esac
  ;;
Bash)
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
  # Each file argument of a `cat` that reads (not one writing with > or >>).
  for f in $(printf '%s' "$cmd" | grep -Eo '(^|[;&|(] *)cat( +[^ ;&|<>]+)+' | sed -E 's/^.*cat //'); do
    case $f in
    src/* | test/* | */src/* | */test/*)
      case $f in /*) p=$f ;; *) p="$CLAUDE_PROJECT_DIR/$f" ;; esac
      if long "$p"; then
        echo "$msg" >&2
        exit 2
      fi
      ;;
    esac
  done
  ;;
esac
exit 0
