# A live run by hand

A `ready-for-human` ticket the maintainer runs against a live league, with the agent writing the steps and reading the pastes. It tests HEAD's build, never the installed `lazy-pundit` (the last release), in a config folder of its own.

## Set up, in one terminal

```sh
cd <repo> && npm run build
export T=~/Developer/lazy-pundit-testing           # outside the repo, not a git folder
export XDG_CONFIG_HOME=$T/live-config && mkdir -p $XDG_CONFIG_HOME
alias lp="node <repo>/dist/cli.js"
echo "env cookie: ${LAZY_PUNDIT_ESPN_S2:+SET}"     # must print nothing after the colon
```

A cookie in `LAZY_PUNDIT_ESPN_S2` takes the place of any stored one, so a run that tests the no-cookie path starts with it unset (`unset LAZY_PUNDIT_ESPN_S2`). In #110 one left in the shell made the first `init` read a private league with no prompt.

## Writing the steps

- Take each expected line from the source: `git grep -n '<words of the message>' src/` names the command that prints it. In #110 a line from the ticket's text, printed only by `capture:espn`, was expected from `draft`.
- At `init`'s folder question, type a folder under `$T`.
- In a new workspace the first fetch is `lp draft`, which with no key makes no LLM call. `refresh` needs a draft first.
- An `espn_s2` is copied from `https://fantasy.espn.com` in the browser's cookie table, as init's cookie help says. In a shell, read it with `read -rs "LAZY_PUNDIT_ESPN_S2?espn_s2: " && export LAZY_PUNDIT_ESPN_S2`, so it stays out of history.
- The agent checks a file's mode with `ls -l` and never opens `credentials.yaml`. Pastes come with names replaced, and GitHub text uses `<league ID>`.

## Ending

The run ends at its results comment on the ticket: each check run, and each difference from the expected lines as a ticket (`ready-for-agent` when it's clear). The fixes are built in a fresh `/implement`. Then `rm -rf` everything under `$T` the run made, since `live-config` holds the cookie.
