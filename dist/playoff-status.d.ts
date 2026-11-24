import type { League, TeamId } from "./league.ts";
/** A settled playoff status. A team that's still alive has none. */
export type PlayoffStatus = "clinched_bye" | "clinched" | "eliminated";
/**
 * Each team's settled playoff status through `week`, from conservative bounds
 * on each team alone: its record with every remaining matchup lost, and with
 * every one won. The remaining pairings aren't used, so this can stay quiet a
 * week longer than an exact search, but it never makes a false claim.
 *
 * - Clinched (N spots): fewer than N other teams can finish level with the
 *   team or ahead of it. A clinched bye is the same test with N = the byes.
 * - Eliminated: at least as many teams as there are spots are sure to finish
 *   ahead of it.
 *
 * Finishing level counts against the team, since the tiebreak isn't known
 * yet. Once the regular season is over points for is known, so it decides a
 * level finish, and only a level finish on points for too stays open.
 *
 * Divisions and median scoring give no status: the standings don't recount
 * them, and a division winner's seed doesn't follow the record.
 */
export declare function playoffStatuses(league: League, week: number): Map<TeamId, PlayoffStatus>;
/**
 * The teams whose status changed in ranking week `week`, against the same
 * snapshot recomputed through the week before, in standings order. A team
 * that had a spot and now has a bye counts under `clinched`.
 */
export declare function settledThisWeek(league: League, week: number): {
    clinched: TeamId[];
    eliminated: TeamId[];
};
