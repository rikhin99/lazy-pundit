#!/usr/bin/env bash
# Runs every drive-wizard.exp scenario, read from that script's own list, and
# fails when any one exits with another code than it should (9 when it timed
# out, 8 when the wizard ended early): 1 for one in that script's `cancelled`
# list, which ends with Ctrl-C, and 0 for every other. `folder` gets a new temp
# folder. Run it with `npm run -s drive:wizard:all`; CI runs it too.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/drive-wizard.exp"
scenarios=$(sed -n 's/^if {\$scenario ni {\(.*\)}} {$/\1/p' "$script")
cancelled=$(sed -n 's/^set cancelled {\(.*\)}$/\1/p' "$script")
if [ -z "$scenarios" ] || [ -z "$cancelled" ]; then
  echo "Couldn't read the scenario lists from $script." >&2
  exit 2
fi

expected_exit() {
  case " $cancelled " in
    *" $1 "*) echo 1 ;;
    *) echo 0 ;;
  esac
}

failed=()
for scenario in $scenarios; do
  args=("$scenario")
  if [ "$scenario" = folder ]; then
    folder="$(mktemp -d)"
    args+=("$folder")
  fi
  log="$(mktemp)"
  expect "$script" "${args[@]}" >"$log" 2>&1
  code=$?
  want=$(expected_exit "$scenario")
  if [ "$code" -eq "$want" ]; then
    echo "ok    $scenario (exit $code)"
  else
    echo "FAIL  $scenario (exit $code, should be $want)"
    tail -n 20 "$log"
    failed+=("$scenario")
  fi
  rm -f "$log"
  if [ "$scenario" = folder ]; then rm -rf "$folder"; fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "Failed: ${failed[*]}" >&2
  exit 1
fi
