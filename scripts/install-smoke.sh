#!/usr/bin/env bash
# Installs HEAD the way a pundit would and runs it: in a throwaway clone,
# `npm run release` tags a release commit, then `npm i -g` installs it by
# `#semver:^0` into an empty prefix with a clean HOME, with the npm in use and
# with npm 12 (which needs --allow-git=all). Each install must list every
# command in --help, and doctor must exit 0. Only committed work is tested.
# Nothing is pushed, and the repo's own tags are left alone.
#
#   npm run -s install:smoke
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/lazy-pundit-smoke.XXXX")
trap 'rm -rf "$T"' EXIT
COMMANDS=(init setup draft refresh check publish stats doctor transcripts)

git clone -q "$REPO" "$T/src"
cd "$T/src"
git checkout -q -B main "$(git -C "$REPO" rev-parse HEAD)"
VERSION=$(node -p 'require("./package.json").version')
git tag -d "v$VERSION" >/dev/null 2>&1 || true
npm ci --ignore-scripts --no-audit --no-fund >/dev/null
GIT_AUTHOR_NAME=smoke GIT_AUTHOR_EMAIL=smoke@localhost \
  GIT_COMMITTER_NAME=smoke GIT_COMMITTER_EMAIL=smoke@localhost \
  npm run -s release -- "$VERSION" >/dev/null

# npm 12 wants Node 24.15 or later; the repo's engine-strict would refuse it on
# an older Node 24, which still runs it (with a warning).
mkdir -p "$T/npm12"
npm i --prefix "$T/npm12" npm@12 --engine-strict=false --no-audit --no-fund \
  >/dev/null 2>&1 || { echo "install-smoke: couldn't install npm 12" >&2; exit 1; }

export HOME="$T/home" XDG_CONFIG_HOME="$T/home/.config" XDG_CACHE_HOME="$T/home/.cache"
mkdir -p "$HOME" "$T/elsewhere"

smoke() { # <label> <npm> [flags…]
  local label=$1 npm=$2 prefix="$T/prefix-$1"
  shift 2
  "$npm" i -g "$@" --prefix "$prefix" --no-audit --no-fund \
    "git+file://$T/src#semver:^0" >/dev/null 2>&1 ||
    { echo "install-smoke: $label: install failed" >&2; exit 1; }
  local bin="$prefix/bin/lazy-pundit" help
  help=$("$bin" --help)
  for c in "${COMMANDS[@]}"; do
    grep -qE "^  $c( |$)" <<<"$help" ||
      { echo "install-smoke: $label: --help has no $c" >&2; exit 1; }
  done
  (cd "$T/elsewhere" && "$bin" doctor >/dev/null) ||
    { echo "install-smoke: $label: doctor failed" >&2; exit 1; }
  echo "install-smoke: $label: installed $VERSION, --help and doctor ran"
}

smoke "npm-$(npm -v)" npm
smoke "npm-$("$T/npm12/node_modules/.bin/npm" -v 2>/dev/null)" \
  "$T/npm12/node_modules/.bin/npm" --allow-git=all
