import type { LineupEntry, LineupSlot, NflPlayer } from "./league.ts";
/**
 * The points of the best possible lineup a team could have started from its
 * week's roster: every starting slot filled by an eligible player, each
 * player used once. A player is eligible by any of their positions in
 * `players` (the league's `players`), or by their lineup position. Exact,
 * not greedy, so multi-position players and flex slots can't mislead it.
 */
export declare function bestLineupPoints(lineup: LineupEntry[], slots: LineupSlot[], players: Record<string, NflPlayer>): number;
