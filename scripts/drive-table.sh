#!/usr/bin/env bash
# `npm run -s drive:table -- <scenario>`: runs scripts/drive-table.exp's
# scenario in a fresh fixture workspace drafted at week 10, in a temp home, so
# nothing is fetched. `all` runs every scenario, each in its own workspace,
# and exits with the first failure's code.
set -uo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
SCENARIOS="keys escape ctrl-c resize sort no-draft missing-team"

run() {
  (
    set -e
    HOME=$(mktemp -d)
    export HOME
    cd "$repo"
    eval "$(npm run -s fixture:workspace -- 10)"
    unset NO_COLOR
    expect "$repo/scripts/drive-table.exp" "$1" "$repo"
  )
}

if [ "${1:-}" = "all" ]; then
  for s in $SCENARIOS; do
    run "$s" || exit $?
  done
  exit 0
fi
run "${1:?usage: drive-table.sh <scenario>|all}"
