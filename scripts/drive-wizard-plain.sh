#!/usr/bin/env bash
# `npm run -s drive:wizard:plain -- <scenario>`: drive-wizard.exp with only the
# lines a reader needs: each answered prompt (◇) and its answer, each log line
# (● info, ◆ success, ▲ warning, ■ error or cancel), the closing message, HOME
# and EXIT. The raw run is about five times longer, a redraw per keystroke; use
# `npm run -s drive:wizard` for it when debugging a scenario's timing.
# Exits with the scenario's code.
set -uo pipefail

raw=$(expect "$(dirname "$0")/drive-wizard.exp" "$@" 2>&1)
code=$?
printf '%s\n' "$raw" |
  LC_ALL=C sed -E $'s/\x1b\\[[0-9;?]*[A-Za-z]//g' |
  tr -d '\r' |
  awk '
    # A ◆ line is a success log when a bare "│" follows it, and an open
    # prompt (redrawn later as ◇) otherwise.
    pending != "" { if ($0 == "│") print pending; pending = "" }
    # A line clack wrapped, with no symbol of its own, belongs to the last kept one.
    cont && $0 != "" && $0 !~ /^(│|└|┌|◇|◆|●|■|▲)/ && $0 !~ /^(HOME|EXIT) / { print; next }
    # A log line of several lines: each one after the first is "│  <text>".
    logged && /^│  ./ { print; next }
    { cont = 0; logged = 0 }
    answer {
      answer = 0
      if ($0 ~ /^│  ./ && $0 !~ /^│  _$/) { print; next }
    }
    /◇  / { sub(/^.*◇/, "◇"); print; answer = 1; cont = 1; next }
    /◆  / { sub(/^.*◆/, "◆"); pending = $0; next }
    /●  / { sub(/^.*●/, "●"); print; cont = 1; logged = 1; next }
    /▲  / { sub(/^.*▲/, "▲"); print; cont = 1; logged = 1; next }
    /■  / { sub(/^.*■/, "■"); print; cont = 1; logged = 1; next }
    /^└  ./ { print; next }
    /^[A-Z]/ { print }
  '
exit "$code"
