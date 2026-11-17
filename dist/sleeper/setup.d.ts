import type { Transport } from "../transport.ts";
/** A league in a platform account's pick list. */
export interface LeagueChoice {
    leagueId: string;
    name: string;
    season: string;
    teams: number;
}
/**
 * A user's football leagues in a season, or undefined if Sleeper has no such
 * user. Listing takes the account's numeric ID, so the username is looked up first.
 */
export declare function sleeperUserLeagues(transport: Transport, username: string, season: string): Promise<LeagueChoice[] | undefined>;
/** What a league's own payload says about whether the tool can rank it. */
export interface LeagueKind {
    sport: string | undefined;
    /** Whether the league scores by points, the only kind the tool models. */
    pointValues: boolean;
}
/** What Sleeper says about one league, or undefined if it has no such league. */
export declare function sleeperLeagueKind(transport: Transport, leagueId: string): Promise<LeagueKind | undefined>;
