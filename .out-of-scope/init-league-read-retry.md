# Asking again when init's league read fails

When `init`'s league data step can't read the league because the request fails (no answer in 30 seconds, no connection, a server error), `init` ends with the `FetchError`'s message and exit 1. Nothing is written. It doesn't say "no answer" and offer to try again or retype the league ID, the way a 401 or 404 does (`SetupRefusal`, `CookieRefusal`).

## Why this is out of scope

A 401 or 404 gets a second try because the pundit can fix it right there: paste a cookie, or fix a mistyped ID. A request that gets no answer has nothing for the pundit to fix at the prompt. The only fix is trying again once the connection works.

Running `lazy-pundit init` again costs almost nothing. The league data step is the first step. The handles and lore steps read the league it fetched, so a failure there loses only the platform choice and the league ID. The worry in the ticket was that "a flaky connection throws away the answers given so far", but nothing has been answered yet that's worth keeping.

A retry loop would add another prompt branch, with wizard scenarios and replays that fail on purpose, for a failure nobody has reported. The same reasoning kept the players file from getting a longer wait (`players-file-timeout.md`).

## When to look again

Look again if the league data step moves after steps that take real answers (handles, lore), or if a tester reports `init` ending on "got no answer" or a connection error at the league step.

## Prior requests

- #109: "A league read with no answer at setup asks again instead of ending init"
