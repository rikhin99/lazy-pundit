/** ESPN's undocumented fantasy football read API. */
export declare const ESPN_API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
/** One league season's base URL. An ESPN league keeps its ID across seasons. */
export declare function espnLeagueUrl(season: string, leagueId: string): string;
/**
 * The requests a fetch makes, each a set of views on the league URL. The views
 * are in the URL itself, since ESPN takes the `view` parameter repeated.
 */
export declare const ESPN_VIEWS: {
    /** Settings, teams with standings, status, and the members who manage them. */
    readonly league: readonly ["mSettings", "mTeam", "mStatus", "mNav"];
    /** Every matchup of the season, without lineups. */
    readonly schedule: readonly ["mMatchup"];
    /** Current rosters, with injury status. */
    readonly rosters: readonly ["mRoster"];
    readonly transactions: readonly ["mTransactions2"];
    /** One week's matchups with lineups and players' points (`scoringPeriodId`). */
    readonly boxscores: readonly ["mMatchupScore", "mScoreboard"];
};
/** The URL that asks for `views` of the league. */
export declare function espnViewUrl(base: string, views: readonly string[]): string;
