import { isDeepStrictEqual } from "node:util";
import { coveredData } from "./data-hash.js";
import { standingsAsReported } from "./standings.js";
/**
 * The data changes from `old` to `next` through `throughWeek`, over what the
 * data hash covers, plus `inProgressWeek`'s matchups for a draft that let it
 * in. No changes means "data changed" doesn't apply.
 *
 * With median scoring or divisions, standings are as reported as of the fetch
 * (`standingsThrough`), so they move whenever a later week is scored. They
 * aren't compared there; a correction still shows in its week's scores.
 */
export function diff(old, next, throughWeek, inProgressWeek) {
    const a = coveredData(old, throughWeek, inProgressWeek);
    const b = coveredData(next, throughWeek, inProgressWeek);
    return [
        ...settingChanges(a, b),
        ...weekChanges(a, b),
        ...(standingsAsReported(old) || standingsAsReported(next)
            ? []
            : standingChanges(a, b)),
        ...transactionChanges(a, b),
    ];
}
function settingChanges(a, b) {
    return ["playoffTeams", "regularSeasonWeeks"].flatMap((setting) => a[setting] === b[setting]
        ? []
        : [
            {
                kind: "setting-changed",
                setting,
                from: a[setting],
                to: b[setting],
            },
        ]);
}
function weekChanges(a, b) {
    const weeks = [...new Set([...a.weeks, ...b.weeks].map((w) => w.week))].sort((x, y) => x - y);
    return weeks.flatMap((week) => {
        const was = a.weeks.find((w) => w.week === week);
        const now = b.weeks.find((w) => w.week === week);
        if (isDeepStrictEqual(was, now))
            return [];
        const changes = was && now ? sideChanges(was, now) : [];
        return changes.length > 0 ? changes : [{ kind: "matchups-changed", week }];
    });
}
/**
 * What changed for each team in a week whose pairings still match, in side
 * order. Anything else about the week differing leaves this empty.
 */
function sideChanges(was, now) {
    const { week } = was;
    const sides = (w) => w.matchups.flatMap((m) => [...m.sides]);
    const before = new Map(sides(was).map((s) => [s.team, s]));
    const changes = [];
    for (const side of sides(now)) {
        const { team } = side;
        const prior = before.get(team);
        if (!prior)
            continue;
        if (prior.result !== side.result) {
            changes.push({
                kind: "result-flipped",
                week,
                team,
                from: prior.result,
                to: side.result,
            });
        }
        if (prior.score !== side.score) {
            changes.push({
                kind: "score-changed",
                week,
                team,
                from: prior.score,
                to: side.score,
            });
        }
        if (!isDeepStrictEqual(prior.lineup, side.lineup)) {
            changes.push({ kind: "lineup-changed", week, team });
        }
    }
    return changes;
}
function standingChanges(a, b) {
    const teams = [
        ...new Set([...a.standings, ...b.standings].map((s) => s.team)),
    ];
    return teams.flatMap((team) => {
        const from = a.standings.find((s) => s.team === team);
        const to = b.standings.find((s) => s.team === team);
        return isDeepStrictEqual(from, to)
            ? []
            : [{ kind: "standing-changed", team, from, to }];
    });
}
function transactionChanges(a, b) {
    const missing = (from, other) => from.filter((t) => !other.some((o) => isDeepStrictEqual(o, t)));
    return [
        ...missing(a.transactions, b.transactions).map((transaction) => ({
            kind: "transaction-removed",
            transaction,
        })),
        ...missing(b.transactions, a.transactions).map((transaction) => ({
            kind: "transaction-added",
            transaction,
        })),
    ];
}
//# sourceMappingURL=data-diff.js.map