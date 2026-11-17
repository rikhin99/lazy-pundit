/** ESPN's undocumented fantasy football read API. */
export const ESPN_API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
/** One league season's base URL. An ESPN league keeps its ID across seasons. */
export function espnLeagueUrl(season, leagueId) {
    return `${ESPN_API}/seasons/${encodeURIComponent(season)}/segments/0/leagues/${encodeURIComponent(leagueId)}`;
}
/**
 * The requests a fetch makes, each a set of views on the league URL. The views
 * are in the URL itself, since ESPN takes the `view` parameter repeated.
 */
export const ESPN_VIEWS = {
    /** Settings, teams with standings, status, and the members who manage them. */
    league: ["mSettings", "mTeam", "mStatus", "mNav"],
    /** Every matchup of the season, without lineups. */
    schedule: ["mMatchup"],
    /** Current rosters, with injury status. */
    rosters: ["mRoster"],
    transactions: ["mTransactions2"],
    /** One week's matchups with lineups and players' points (`scoringPeriodId`). */
    boxscores: ["mMatchupScore", "mScoreboard"],
};
/** The URL that asks for `views` of the league. */
export function espnViewUrl(base, views) {
    return `${base}?${views.map((v) => `view=${v}`).join("&")}`;
}
//# sourceMappingURL=api.js.map