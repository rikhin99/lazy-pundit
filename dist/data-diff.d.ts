import type { League, LeagueSettings, Result, TeamId, Transaction } from "./league.ts";
import { type TeamStanding } from "./standings.ts";
/** One difference between two snapshots through a ranking week. */
export type DataChange = {
    kind: "result-flipped";
    week: number;
    team: TeamId;
    from: Result | undefined;
    to: Result | undefined;
} | {
    kind: "score-changed";
    week: number;
    team: TeamId;
    from: number;
    to: number;
} | {
    kind: "lineup-changed";
    week: number;
    team: TeamId;
}
/** The pairings, byes or bracket details differ, not only a team's numbers. */
 | {
    kind: "matchups-changed";
    week: number;
} | {
    kind: "standing-changed";
    team: TeamId;
    from: TeamStanding | undefined;
    to: TeamStanding | undefined;
} | {
    kind: "transaction-added";
    transaction: Transaction;
} | {
    kind: "transaction-removed";
    transaction: Transaction;
} | {
    kind: "setting-changed";
    setting: keyof Pick<LeagueSettings, "playoffTeams" | "regularSeasonWeeks">;
    from: number;
    to: number;
};
/**
 * The data changes from `old` to `next` through `throughWeek`, over what the
 * data hash covers, plus `inProgressWeek`'s matchups for a draft that let it
 * in. No changes means "data changed" doesn't apply.
 *
 * With median scoring or divisions, standings are as reported as of the fetch
 * (`standingsThrough`), so they move whenever a later week is scored. They
 * aren't compared there; a correction still shows in its week's scores.
 */
export declare function diff(old: League, next: League, throughWeek: number, inProgressWeek?: number): DataChange[];
