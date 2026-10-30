# Yahoo Fantasy API: terms, limits, auth, categories, history

Issue: #2. Researched 2026-10-29. Primary sources only (Yahoo-owned pages). Pages were read through a summarizing fetch tool, so quotes are as relayed by that tool; re-check wording before relying on it legally. Anything not found is marked **UNVERIFIED**.

Sources:
- [S1] https://sports.yahoo.com/developer (old developer.yahoo.com/fantasysports/guide/ 308-redirects here)
- [S2] https://sports.yahoo.com/developer/docs/ (API docs; only the first ~100k of ~180k chars read in full, the remainder read for specific topics only)
- [S3] https://sports.yahoo.com/developer/access/ (application form)
- [S4] https://developer.yahoo.com/oauth2/guide/flows_authcode/
- [S5] https://developer.yahoo.com/oauth2/guide/
- [S6] https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html (Yahoo Terms; first 100k of 125k chars read)

## 1. What the terms allow for a local CLI

- Access is by application, not self-serve. Developers submit organization, product and use-case details; the Yahoo Fantasy Sports team reviews each one; incomplete submissions "will be closed without further correspondence" [S1, S3].
- The form asks for the intended user base, "including where access is limited to personal or single league use", so personal use is an anticipated category [S3]. It does not state that personal use is exempt from review or approved by default.
- Access requires agreeing to an "API Access and Use Agreement" restricting e.g. multiple accounts and reverse engineering [S1]. The agreement text is not linked on that page: **UNVERIFIED (agreement text not read)**. The form also says submitting means agreeing to "Yahoo's Terms and Privacy Policy" [S3].
- General Yahoo Terms [S6]: automated access ("robots, spiders, scrapers, data mining tools") is prohibited "without our express, prior permission" (s.2(d)(9)); "high volume activity" without written consent is prohibited (s.2(m)); commercial reuse of Services/APIs is prohibited without written permission (s.2(e), 2(h)); building a database/archive/data feed from Service data, or a service competing with Yahoo's, is prohibited (s.2(d)(10)); APIs are licensed as "personal, royalty-free, non-transferable, non-assignable, revocable, and non-exclusive" (s.2(i)). Do not access via methods other than the provided interface and instructions (s.2(e)).
- Inference (mine, not a Yahoo statement): a personal, read-only CLI using an approved key and the official API fits the "personal" license language; scraping the website, building a redistributable dataset, or any commercial use does not.
- Read-only: "The Yahoo Fantasy Sports API currently provides read access only"; write access is currently unavailable [S3].
- Attribution: sample responses carry "Data provided by Yahoo! and STATS, LLC"; a Yahoo Fantasy logo is offered for attribution [S1, S2]. Whether attribution is mandatory: **UNVERIFIED**.
- Support: Yahoo promises none (s.2(j)); it may charge fees (s.2(k)) [S6].

## 2. Rate limits

- No numeric limits published. Yahoo "monitors usage and may temporarily throttle or limit access if usage is excessive over short periods" [S1].
- No rate-limit text found in the API docs read [S2]. Specific limits and error codes: **UNVERIFIED**.
- Practical (inference): cache locally and keep request volume low.

## 3. OAuth for a local CLI

- The API requires OAuth 2.0 [S2]. Register an app asking for private user data and "Read" access for Fantasy Sports; you get a consumer key/secret to keep secret [S2]. Registration is gated by the application in section 1 [S3].
- Auth code flow [S4]: token endpoint `POST https://api.login.yahoo.com/oauth2/get_token`, `Authorization: Basic base64(client_id:client_secret)`, `application/x-www-form-urlencoded`.
- Redirect URI: [S4] says the callback should be `oob` when "the user should not be redirected to your server" and does not mention localhost. Whether `http://localhost` or `https` redirects are accepted, and whether `oob` is still accepted for new apps: **UNVERIFIED**. Yahoo's guide describes only server-side and client-side client profiles [S5]; no native/CLI profile is documented.
- Scopes: **UNVERIFIED** (not on pages read).
- Data visibility: a user can only read private leagues they belong to, or public leagues [S2].

## 4. Token refresh

- Access token lifetime is 1 hour (`expires_in` 3600) [S4].
- The refresh token has "a long lifetime" (exact duration **UNVERIFIED**; [S5] gives none) and is used with `grant_type=refresh_token` at the same endpoint [S4].
- The server "may issue a new refresh token", revoking the old one, so the CLI must persist whichever refresh token it last received [S4].
- The user can revoke access in Yahoo account settings, invalidating the refresh token [S4].

## 5. Category (basketball) leagues

- Docs expose per-game `stat_categories` ("Detailed description of all available stat categories for the game") and league `/settings` covering "scoring type, roster positions, stat categories and modifiers" [S2].
- `scoring_type` sample value is `head` (H2H); roto is referred to in MLB sample text. The full enum, and how H2H-categories vs roto vs points leagues are distinguished for basketball: **UNVERIFIED**. NBA is not mentioned in the API docs themselves (only in site navigation) [S2], so the `nba` game_code is **UNVERIFIED** from primary docs (docs give `nfl`, `mlb` as examples).

## 6. Past seasons

- Game keys are a numeric `game_id` (e.g. 461 for 2025 NFL) or a `game_code`; a bare game_code resolves to the current season [S2].
- Find a past season's id with `/games;game_codes=<code>;seasons=<season>`; list all seasons with `/games;game_codes=<code>`; a `seasons=2024,2025` filter is supported [S2].
- League key format is `{game_key}.l.{league_id}`, e.g. `461.l.1000` [S2], so a past league is reached with that season's game_id.
- Docs show 2019 and 2020 data examples [S2]. How far back data is retained, and whether your own old leagues remain accessible: **UNVERIFIED**.

## Open questions to resolve empirically
1. Is a personal key approved in practice, and how fast?
2. Accepted redirect URIs for a CLI (localhost vs oob).
3. Actual throttle behavior and error codes.
4. NBA game_code, scoring_type enum, retention depth.
5. The full API Access and Use Agreement text.
