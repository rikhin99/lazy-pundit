# A longer wait for the players file

Every platform request waits the same 30 seconds for its whole answer (`PLATFORM_WAIT_MS`), the Sleeper players file included. It doesn't get a longer wait of its own, a separate error, or a fall-back to a stale cached copy.

## Why this is out of scope

The players file looked like the one request that could run out of time: it's several MB, against a few KB for a league payload. Measured on 2026-11-09, it came down as 2.6 MB in 0.4 seconds. Running out of 30 seconds needs a link slower than about 90 KB/s (roughly 0.7 Mbit/s) for the whole download.

The players file is also rarely fetched. It's kept in the operator's cache and only fetched again when the cached copy is missing, more than 7 days old, or doesn't name a player in the league's matchups. When a fetch fails for any reason, a fetching command already continues from the last complete snapshot and tells the pundit to refresh once fetching works. So a time-out would mostly show up on a first `init` over a very slow link, which nobody has seen.

A second wait constant, or a stale-copy fall-back, would be code and tests kept for a failure there's no evidence of.

## When to look again

If anyone actually gets "GET https://api.sleeper.app/v1/players/nfl got no answer in 30 seconds", reopen this. Start from a measured download on that link rather than a guessed wait.

## Prior requests

- #87: "The players file gets the same 30-second wait as a small league payload"
