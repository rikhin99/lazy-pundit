import type { TeamId } from "./league.ts";
import { lastPublished, type RankingFile } from "./ranking-file.ts";
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
export async function movementBaseline(
  dir: string,
  week: number,
): Promise<MovementBaseline | undefined> {
  const last = await lastPublished(dir, week);
  if (!last) return undefined;
  const order = orderEvidence(last.ranking, undefined);
  const places = new Map<TeamId, number>(
    Object.entries(order).map(([team, e]) => [team as TeamId, e.place]),
  );
  return { week: last.week, places };
}

/**
 * A team's movement to `place`: places climbed since the baseline (negative
 * for a fall), or `new` with no place in it or no baseline at all.
 */
export function moveOf(
  baseline: MovementBaseline | undefined,
  team: TeamId,
  place: number,
): number | "new" {
  const was = baseline?.places.get(team);
  return was === undefined ? "new" : was - place;
}

/**
 * Each team's order evidence: its place, movement and group, read from the
 * ranking's current order.
 */
export function orderEvidence(
  ranking: RankingFile,
  baseline: MovementBaseline | undefined,
): Record<TeamId, OrderEvidence> {
  const order: Record<TeamId, OrderEvidence> = {};
  let place = 0;
  let group: string | undefined;
  for (const e of ranking.entries) {
    if (e.kind === "group") {
      group = e.label;
      continue;
    }
    place += 1;
    const team = e.team as TeamId;
    order[team] = {
      place,
      move: moveOf(baseline, team, place),
      ...(group ? { group } : {}),
    };
  }
  return order;
}

/** Movement as the league reads it after a team's record: (▲2), (▼1), (—), (new). */
export function movementMark(move: number | "new"): string {
  if (move === "new") return "(new)";
  if (move === 0) return "(—)";
  return move > 0 ? `(▲${move})` : `(▼${-move})`;
}
