import type { League } from "../league.ts";
import type { Snapshot } from "../snapshot.ts";
/**
 * The last week whose head-to-head matchups all have a winner, counting from
 * week 1. ESPN has no finality field, and a bye (a home side only) never gets
 * a winner. The fetcher and the normalizer both use this one rule.
 */
export declare function lastScoredWeekOf(schedule: {
    schedule: {
        matchupPeriodId: number;
        winner: string;
        away?: unknown;
    }[];
}): number;
/** Turns one ESPN snapshot into the league model. Pure. */
export declare function normalizeEspn(snapshot: Snapshot): League;
