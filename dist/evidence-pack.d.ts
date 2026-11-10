import { type League, type TeamId } from "./league.ts";
import type { EvidencePack } from "./validator/types.ts";
/**
 * The evidence pack for the ranking week `week`, built from the model only:
 * every scored week up to and including it and the transactions in those
 * weeks. The in-progress week, any later week and draft picks are left out.
 *
 * Weekly stats (`w<N>.…`) cover the ranking week, or a team's last played
 * week when it had no matchup in the ranking week. All-play, form, luck and
 * the lineup stats count only the weeks a team played.
 *
 * `inProgressWeek` (`--include-in-progress`) lets that week in, but only as
 * its own weekly matchup stats, with a result only once it's scored (a later
 * snapshot of the same draft): everything else, the playoff status and the
 * week's transactions included, stays through the ranking week.
 */
export declare function buildEvidencePack(league: League, week: number, inProgressWeek?: number): EvidencePack;
export declare function injuredPlayers(league: League, team: TeamId): import("./league.ts").NflPlayer[];
/** Competition ranks, highest value first: tied teams share the better rank. */
export declare function ranks(values: [TeamId, number][]): Map<TeamId, number>;
/** "A", "A and B", "A, B and C". */
export declare function list(names: string[]): string;
