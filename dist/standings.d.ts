import type { League, Standing, TeamId } from "./league.ts";
/** One team's record and points, before any order is put on them. */
type Line = Standing & {
    team: TeamId;
};
/** One team's line in the standings through a week. */
export interface TeamStanding extends Line {
    /**
     * The team's position in the standings, from 1 (not its place in a
     * ranking). Null with divisions.
     */
    rank: number | null;
    /**
     * The playoff seed the rank gives, or null outside the playoff spots and
     * with divisions.
     */
    seed: number | null;
    /**
     * Set when another team has the same win percentage: the rule that placed
     * this team among them. `unbroken` means one of them also has the same
     * points for, so their order is by team ID and says nothing. Never set
     * with divisions.
     */
    tiebreak?: Tiebreak;
}
export type Tiebreak = "points_for" | "unbroken";
/**
 * The standings through `week`, in order: each team's W-L-T and points for
 * and against, rebuilt from the scored regular-season matchups up to and
 * including it. A bye gives no result.
 *
 * With median scoring or divisions the recount is skipped and every week
 * gets the standings as reported in the snapshot (spec #37): the matchups don't
 * hold median results, and with divisions the standings stay as the
 * platform reports them.
 *
 * The order is Sleeper's: win percentage (a tie counts as half a win), then
 * points for. Sleeper reports neither rank nor seed, so both come from it.
 * How this was confirmed, and what's still unknown, is in
 * docs/research/sleeper-standings.md.
 * With divisions Sleeper's division seeding isn't modelled, so there's no
 * rank, seed or tiebreak; the list is still sorted by record, so the draft's
 * starting order has one to start from.
 */
export declare function standingsThrough(league: League, week: number): TeamStanding[];
/**
 * Whether the league's standings are as reported as of the fetch for every
 * week, not rebuilt through a week: median scoring or divisions.
 */
export declare function standingsAsReported(league: League): boolean;
export declare function winPercentage(s: Standing): number;
export {};
