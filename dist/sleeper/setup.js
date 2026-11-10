import { z } from "zod";
import { FetchError, platformRequest } from "../snapshot.js";
import { SLEEPER_API } from "./api.js";
/**
 * Reads one payload for the setup steps, nothing recorded. Undefined when
 * Sleeper has no such thing: an unknown league answers 404 and an unknown user
 * `null` with a 200. Its docs also list 400. Any other failure is a `FetchError`.
 */
async function lookUp(transport, url) {
    const res = await platformRequest(transport, { url });
    if (res.status === 400 || res.status === 404)
        return undefined;
    if (res.status < 200 || res.status >= 300) {
        throw new FetchError(`GET ${url} returned ${res.status}`);
    }
    let payload;
    try {
        payload = JSON.parse(new TextDecoder().decode(res.body));
    }
    catch (cause) {
        throw new FetchError(`GET ${url} returned invalid JSON`, { cause });
    }
    return payload ?? undefined;
}
const leagueSchema = z.object({
    sport: z.string().optional(),
    scoring_settings: z.record(z.string(), z.unknown()).nullish(),
});
const userSchema = z.object({ user_id: z.string() });
const userLeaguesSchema = z.array(z.object({
    league_id: z.string(),
    name: z.string(),
    season: z.string(),
    total_rosters: z.number().int().nonnegative(),
}));
/**
 * A user's football leagues in a season, or undefined if Sleeper has no such
 * user. Listing takes the account's numeric ID, so the username is looked up first.
 */
export async function sleeperUserLeagues(transport, username, season) {
    const userUrl = `${SLEEPER_API}/user/${encodeURIComponent(username)}`;
    const user = await lookUp(transport, userUrl);
    if (user === undefined)
        return undefined;
    const { user_id } = parsedPayload(userSchema, user, userUrl);
    const url = `${SLEEPER_API}/user/${encodeURIComponent(user_id)}/leagues/nfl/${season}`;
    const leagues = parsedPayload(userLeaguesSchema, (await lookUp(transport, url)) ?? [], url);
    return leagues.map((l) => ({
        leagueId: l.league_id,
        name: l.name,
        season: l.season,
        teams: l.total_rosters,
    }));
}
function parsedPayload(schema, payload, url) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
        throw new FetchError(`GET ${url} answered in a shape this version can't read. Check for a newer Lazy Pundit.`, { cause: parsed.error });
    }
    return parsed.data;
}
/** What Sleeper says about one league, or undefined if it has no such league. */
export async function sleeperLeagueKind(transport, leagueId) {
    const url = `${SLEEPER_API}/league/${encodeURIComponent(leagueId)}`;
    const payload = await lookUp(transport, url);
    if (payload === undefined)
        return undefined;
    const league = parsedPayload(leagueSchema, payload, url);
    return {
        sport: league.sport,
        pointValues: Object.keys(league.scoring_settings ?? {}).length > 0,
    };
}
//# sourceMappingURL=setup.js.map