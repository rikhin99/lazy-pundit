import { z } from "zod";
import { dataHash } from "../data-hash.js";
import { FetchError, lastSnapshotReader, platformRequest, SnapshotRecorder, } from "../snapshot.js";
import { requestUrl } from "../transport.js";
import { ESPN_VIEWS, espnLeagueUrl, espnViewUrl } from "./api.js";
import { lastScoredWeekOf, normalizeEspn } from "./normalizer.js";
/** Only the league fields the fetcher needs to decide what else to fetch. */
const leagueSchema = z.object({
    id: z.number().int(),
    seasonId: z.number().int(),
    /** The current week; past the last one once the season is over. */
    scoringPeriodId: z.number().int().nonnegative(),
    status: z.object({ finalScoringPeriod: z.number().int().positive() }),
});
/** Only the schedule fields that say which weeks are scored. */
const scheduleSchema = z.object({
    schedule: z.array(z.object({
        matchupPeriodId: z.number().int(),
        winner: z.string(),
        away: z.unknown().optional(),
    })),
});
/**
 * Fetches one ESPN league season through the transport and writes it as a
 * snapshot. Every request must succeed, or nothing is written.
 */
export async function fetchEspnSnapshot(opts) {
    return (await fetchEspn(opts)).write();
}
/**
 * Fetches one ESPN league season through the transport, writing no snapshot
 * unless the caller asks. Every request must succeed. A rejected cookie (401)
 * and a league ESPN doesn't know (404) each stop it with their own fix.
 */
export async function fetchEspn(opts) {
    const headers = opts.cookie
        ? { Cookie: `espn_s2=${opts.cookie.value}` }
        : {};
    const recorder = new SnapshotRecorder(opts.transport, headers);
    const base = espnLeagueUrl(opts.season, opts.leagueId);
    const leagueUrl = espnViewUrl(base, ESPN_VIEWS.league);
    const res = await platformRequest(opts.transport, {
        url: leagueUrl,
        params: {},
        headers,
    });
    if (res.status === 401) {
        throw new FetchError(rejectedCookie(opts), {
            fix: opts.cookie?.from === "env" ? "espn_env" : "setup_espn",
        });
    }
    if (res.status === 404) {
        throw new FetchError(`ESPN has no league ${opts.leagueId} in ${opts.season}`, { fix: "league_id" });
    }
    if (res.status < 200 || res.status >= 300) {
        throw new FetchError(`GET ${requestUrl({ url: leagueUrl })} returned ${res.status}`);
    }
    const parsed = leagueSchema.safeParse(parseJson(res.body));
    if (!parsed.success) {
        throw new FetchError(`ESPN league ${opts.leagueId} is not a league payload`, { cause: parsed.error, fix: "update" });
    }
    recorder.put(leagueUrl, res.body);
    const league = parsed.data;
    const scheduleUrl = espnViewUrl(base, ESPN_VIEWS.schedule);
    const schedule = scheduleSchema.safeParse(parseJson(await recorder.get(scheduleUrl)));
    if (!schedule.success) {
        throw new FetchError(`ESPN league ${opts.leagueId} sent a schedule this version can't read`, { cause: schedule.error, fix: "update" });
    }
    const leagueId = String(league.id);
    const season = String(league.seasonId);
    const weeks = Math.min(league.scoringPeriodId, league.status.finalScoringPeriod);
    const kept = opts.full
        ? undefined
        : await keptWeeks({ snapshotsDir: opts.snapshotsDir, leagueId, season, scheduleUrl }, lastScoredWeekOf(schedule.data), opts.clock.now());
    // ESPN answers a transactions request with one week's only, so like box
    // scores they're asked for week by week.
    const weekly = [ESPN_VIEWS.boxscores, ESPN_VIEWS.transactions].map((views) => espnViewUrl(base, views));
    await Promise.all([
        recorder.get(espnViewUrl(base, ESPN_VIEWS.rosters)),
        ...weekly.flatMap((url) => Array.from({ length: weeks }, async (_, i) => {
            const params = { scoringPeriodId: String(i + 1) };
            const body = await kept?.(i + 1, url, params);
            if (!body)
                return recorder.get(url, params);
            recorder.put(url, body, params);
            return body;
        })),
    ]);
    const snapshot = recorder.snapshot({ platform: "espn", leagueId, season });
    const normalized = normalizeEspn(snapshot);
    return {
        snapshot,
        league: normalized,
        write: () => recorder.write({
            snapshotsDir: opts.snapshotsDir,
            clock: opts.clock,
            platform: "espn",
            leagueId,
            season,
            idHash: dataHash(normalized, normalized.lastScoredWeek),
        }),
    };
}
/**
 * Checks a cookie, or none, live with one request for an ESPN league's own
 * payload, as `doctor` does: read, rejected (401), a league ESPN doesn't
 * know (404), or why it couldn't be checked.
 */
export async function checkEspnCookie(transport, cookie, league) {
    const url = espnViewUrl(espnLeagueUrl(league.season, league.leagueId), ESPN_VIEWS.league);
    try {
        const res = await platformRequest(transport, {
            url,
            params: {},
            headers: cookie === undefined ? {} : { Cookie: `espn_s2=${cookie}` },
        });
        if (res.status === 401)
            return "rejected";
        if (res.status === 404)
            return "no league";
        if (res.status >= 200 && res.status < 300)
            return "ok";
        return { unreachable: `GET ${requestUrl({ url })} returned ${res.status}` };
    }
    catch (err) {
        return { unreachable: err.message };
    }
}
/** The 401's message: which cookie ESPN refused, or that none was sent. */
function rejectedCookie(opts) {
    const cookie = opts.cookie;
    if (!cookie) {
        return `ESPN refused league ${opts.leagueId} without a cookie: it's a private league`;
    }
    const which = cookie.savedAt !== undefined
        ? `saved ${cookie.savedAt}`
        : "from LAZY_PUNDIT_ESPN_S2";
    return `ESPN cookie rejected (${which})`;
}
/**
 * A routine fetch's reuse: for a week's box scores or transactions, the payload
 * from the season's last snapshot, or nothing when the week must be fetched. Fetched
 * are the last 2 scored weeks, every week after them, and any week the last
 * snapshot didn't hold as scored. Nothing is reused (a full fetch) when
 * `lastSnapshotReader` finds no recent snapshot.
 */
async function keptWeeks(opts, scored, now) {
    const read = await lastSnapshotReader(opts.snapshotsDir, { platform: "espn", leagueId: opts.leagueId, season: opts.season }, now);
    if (!read)
        return undefined;
    const lastSchedule = scheduleSchema.safeParse(parseJson((await read(opts.scheduleUrl)) ?? new Uint8Array()));
    if (!lastSchedule.success)
        return undefined;
    const firstFetched = Math.min(scored - 1, lastScoredWeekOf(lastSchedule.data) + 1);
    return async (week, url, params) => week < firstFetched ? read(url, params) : undefined;
}
function parseJson(body) {
    try {
        return JSON.parse(new TextDecoder().decode(body));
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=fetcher.js.map