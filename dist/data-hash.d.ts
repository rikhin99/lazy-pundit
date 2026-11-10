import type { League } from "./league.ts";
/**
 * SHA-256 of the league data a ranking for `throughWeek` stands on, as
 * canonical JSON: the scored weeks up to it (matchups, scores, results,
 * lineups, byes), transactions up to it, the standings through it (with
 * rank, seed and tiebreaks), and the playoff spot count and regular-season
 * length. Names, managers, current rosters, injuries,
 * player details and any in-progress week are left out, so only a change that
 * counts as "data changed" changes it.
 *
 * Snapshot IDs end with this hash, so changing what it covers changes every
 * committed fixture ID: rebuild them (see fixtures/sleeper/README.md).
 */
export declare function dataHash(league: League, throughWeek: number): string;
/**
 * The data a ranking for `throughWeek` stands on, which the data hash covers.
 * `inProgressWeek` adds that week's matchups, for a draft that let it in.
 */
export declare function coveredData(league: League, throughWeek: number, inProgressWeek?: number): {
    playoffTeams: number;
    regularSeasonWeeks: number;
    standings: import("./standings.ts").TeamStanding[];
    weeks: {
        week: number;
        byes: (`espn:${string}` | `sleeper:${string}`)[];
        matchups: {
            kind: import("./league.ts").MatchupKind;
            round?: number;
            sides: {
                team: import("./league.ts").TeamId;
                score: number;
                result?: import("./league.ts").Result;
                tiebreak?: true;
                lineup: {
                    player: string;
                    slot: string;
                    points: number;
                }[];
            }[];
        }[];
    }[];
    transactions: import("./league.ts").Transaction[];
};
