import { lastPublished } from "./ranking-file.js";
/**
 * The movement baseline for ranking week `week`: the season's latest frozen
 * copy of an earlier ranking week, so republishing `week` never moves it.
 * None before the season's first publish.
 */
export async function movementBaseline(dir, week) {
    const last = await lastPublished(dir, week);
    if (!last)
        return undefined;
    const order = orderEvidence(last.ranking, undefined);
    const places = new Map(Object.entries(order).map(([team, e]) => [team, e.place]));
    return { week: last.week, places };
}
/**
 * A team's movement to `place`: places climbed since the baseline (negative
 * for a fall), or `new` with no place in it or no baseline at all.
 */
export function moveOf(baseline, team, place) {
    const was = baseline?.places.get(team);
    return was === undefined ? "new" : was - place;
}
/**
 * Each team's order evidence: its place, movement and group, read from the
 * ranking's current order.
 */
export function orderEvidence(ranking, baseline) {
    const order = {};
    let place = 0;
    let group;
    for (const e of ranking.entries) {
        if (e.kind === "group") {
            group = e.label;
            continue;
        }
        place += 1;
        const team = e.team;
        order[team] = {
            place,
            move: moveOf(baseline, team, place),
            ...(group ? { group } : {}),
        };
    }
    return order;
}
/** Movement as the league reads it after a team's record: (▲2), (▼1), (—), (new). */
export function movementMark(move) {
    if (move === "new")
        return "(new)";
    if (move === 0)
        return "(—)";
    return move > 0 ? `(▲${move})` : `(▼${-move})`;
}
//# sourceMappingURL=movement.js.map