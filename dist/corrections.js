import { diff } from "./data-diff.js";
import { normalizeSnapshot } from "./normalize.js";
import { lastPublished } from "./ranking-file.js";
import { readSnapshot, unreadableSnapshotWhy } from "./snapshot.js";
import { triggerWinnerChanges, winnersText } from "./stakes.js";
import { rankingsDir, snapshotsDir } from "./workspace.js";
/**
 * The drastic corrections in `league`, a draft's data for `week`: its data
 * against the snapshot behind the season's latest published ranking before
 * `week`, through that ranking's week. Nothing is stored, so they stop once a
 * ranking on the corrected data is published. A snapshot that's gone, damaged
 * or no longer normalizes gives the can't-compare item instead.
 */
export async function corrections(ws, week, league, stakes) {
    const last = await lastPublished(rankingsDir(ws), week);
    if (!last)
        return { items: {} };
    const id = last.ranking.meta.snapshot;
    let old;
    try {
        old = normalizeSnapshot(await readSnapshot(snapshotsDir(ws), id));
    }
    catch (err) {
        return {
            items: {},
            cantCompare: `can't compare with \`${id}\`, the week ${last.week} ranking's snapshot: ${unreadableSnapshotWhy(err)}, so a drastic correction to week ${last.week} or earlier won't show`,
        };
    }
    const names = new Map(league.teams.map((t) => [t.id, t.name]));
    const name = (team) => names.get(team) ?? team;
    const parts = new Map();
    const add = (w, part) => parts.set(w, [...(parts.get(w) ?? []), part]);
    const flipped = new Set();
    for (const change of diff(old, league, last.week)) {
        if (change.kind !== "result-flipped")
            continue;
        const now = matchupOf(league, change.week, change.team);
        const then = matchupOf(old, change.week, change.team);
        if (!now || !then)
            continue;
        // One item per matchup, though each side is its own change.
        const key = `${change.week}:${now.sides.map((s) => s.team).join()}`;
        if (flipped.has(key))
            continue;
        flipped.add(key);
        add(change.week, `${result(now, name)}, ${was(then, name)}`);
    }
    for (const c of triggerWinnerChanges(stakes, old, league, last.week)) {
        add(c.week, `${c.rule.name} went to ${winnersText(c.to, names)}, not ${winnersText(c.from, names)}`);
    }
    return {
        items: Object.fromEntries([...parts.entries()]
            .sort(([a], [b]) => a - b)
            .map(([w, p]) => [`w${w}.correction`, p.join("; ")])),
    };
}
/**
 * The week intro's line for each correction item, oldest week first, each
 * tagged to its item: `[Correction from week 7: …]{ev=w7.correction}`.
 */
export function correctionLines(items) {
    return Object.entries(items).map(([id, value]) => lineFor(id, value));
}
/**
 * The reason for each correction item a draft's `text` cites nowhere, such as
 * one a `refresh` found after the draft was written: the league won't hear of
 * it unless the pundit adds its line.
 */
export function uncarriedCorrections(items, text) {
    return Object.entries(items)
        .filter(([id]) => !text.includes(`{ev=${id}}`))
        .map(([id, value]) => `week ${weekOf(id)} has a drastic correction the draft doesn't carry, so the league won't hear of it: put ${lineFor(id, value)} at the top of the intro`);
}
function lineFor(id, value) {
    return `[Correction from week ${weekOf(id)}: ${value}]{ev=${id}}`;
}
function weekOf(id) {
    return /^w(\d+)\./.exec(id)?.[1];
}
function matchupOf(league, week, team) {
    return league.weeks
        .find((w) => w.week === week)
        ?.matchups.find((m) => m.sides.some((s) => s.team === team));
}
/** "A beat B 116.28–111.58", "A and B tied 100–100" or "A and B have no result". */
function result(m, name) {
    const [a, b] = m.sides;
    const won = winner(m);
    if (won) {
        const lost = won === a ? b : a;
        return `${name(won.team)} beat ${name(lost.team)} ${score(won, lost)}`;
    }
    return a.result === "T"
        ? `${name(a.team)} and ${name(b.team)} tied ${score(a, b)}`
        : `${name(a.team)} and ${name(b.team)} have no result`;
}
/** What the matchup was: "which A won 111.58–101.28", "which was a 100–100 tie". */
function was(m, name) {
    const [a, b] = m.sides;
    const won = winner(m);
    if (won) {
        return `which ${name(won.team)} won ${score(won, won === a ? b : a)}`;
    }
    return a.result === "T"
        ? `which was a ${score(a, b)} tie`
        : "which had no result";
}
function winner(m) {
    return m.sides.find((s) => s.result === "W");
}
function score(first, second) {
    return `${first.score}–${second.score}`;
}
//# sourceMappingURL=corrections.js.map