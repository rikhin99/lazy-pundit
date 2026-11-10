import type { TeamId } from "./league.ts";
import { type RankingFile } from "./ranking-file.ts";
import type { OrderEvidence } from "./validator.ts";
/**
 * The movement baseline: the frozen copy movement is measured against, as
 * each team's place in it, with its ranking week.
 */
export interface MovementBaseline {
    week: number;
    places: Map<TeamId, number>;
}
/**
 * The movement baseline for ranking week `week`: the season's latest frozen
 * copy of an earlier ranking week, so republishing `week` never moves it.
 * None before the season's first publish.
 */
export declare function movementBaseline(dir: string, week: number): Promise<MovementBaseline | undefined>;
/**
 * A team's movement to `place`: places climbed since the baseline (negative
 * for a fall), or `new` with no place in it or no baseline at all.
 */
export declare function moveOf(baseline: MovementBaseline | undefined, team: TeamId, place: number): number | "new";
/**
 * Each team's order evidence: its place, movement and group, read from the
 * ranking's current order.
 */
export declare function orderEvidence(ranking: RankingFile, baseline: MovementBaseline | undefined): Record<TeamId, OrderEvidence>;
/** Movement as the league reads it after a team's record: (▲2), (▼1), (—), (new). */
export declare function movementMark(move: number | "new"): string;
