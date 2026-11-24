import { checkDraft } from "./check.js";
import { buildEvidencePack, teamInjuries, } from "./evidence-pack.js";
/** The columns the Stats table can be sorted by. */
export const STATS_TABLE_SORTS = [
    "start",
    "record",
    "rank",
    "ppg",
    "all-play",
    "form",
    "luck",
];
/** Why `value` can't be a sort column, or nothing when it can. */
export function sortProblem(value) {
    if (STATS_TABLE_SORTS.includes(value))
        return;
    return `There's no "${value}" column to sort by; use ${sortList(STATS_TABLE_SORTS)}.`;
}
/** The sorts a week's Stats table offers: every one but `start` at week 0, which has no starting order. */
export function sortsFor(week) {
    return week === 0
        ? STATS_TABLE_SORTS.filter((s) => s !== "start")
        : STATS_TABLE_SORTS;
}
/** `sorts` as a refusal lists them: "record, rank … or luck". */
function sortList(sorts) {
    return `${sorts.slice(0, -1).join(", ")} or ${sorts.at(-1)}`;
}
/** A Stats table the draft can't give: a sort by Start at week 0. Refused before anything is shown. */
export class StatsTableRefusal extends Error {
    name = "StatsTableRefusal";
}
/**
 * How good a row is for each sort, higher being better: the lowest Start and
 * Rank, the highest of the rest, with win percentage for the two records. A
 * team without the stat goes last.
 */
const GOODNESS = {
    start: (r) => (r.start === undefined ? undefined : -r.start),
    record: (r) => winShare(r.record),
    rank: (r) => (r.rank === undefined ? undefined : -r.rank),
    ppg: (r) => r.ppg,
    "all-play": (r) => winShare(r.allPlay),
    form: (r) => r.form,
    luck: (r) => r.luck,
};
/** The share of matchups won in a `W-L` or `W-L-T` record, a tie counting half. */
function winShare(record) {
    if (record === undefined)
        return undefined;
    const [w = 0, l = 0, t = 0] = record.split("-").map(Number);
    const matchups = w + l + t;
    return matchups === 0 ? undefined : (w + t / 2) / matchups;
}
/**
 * The Stats table for the latest draft, read from the snapshot it records
 * through its ranking week. It reads the draft with `check`'s parse and checks,
 * so it refuses what `check` refuses, and writes nothing. The rows are in the
 * draft's order, or best first by `sort` with ties in the draft's order.
 */
export async function statsTable(workspaceDir, opts = {}) {
    return statsTableFrom(await checkDraft(workspaceDir, { autoTag: false }), opts);
}
/**
 * The Stats table for a draft its caller has already checked, as `statsTable`
 * gives it, so a caller that shows the problems list too checks it once.
 */
export function statsTableFrom({ ranking, league, order }, opts = {}) {
    const week = ranking.meta.week;
    if (opts.sort && !sortsFor(week).includes(opts.sort)) {
        throw new StatsTableRefusal(`A preseason draft has no starting order, so there's no Start to sort by; use ${sortList(sortsFor(week))}.`);
    }
    // Through the ranking week alone, so an in-progress week a draft let in
    // adds nothing.
    const pack = buildEvidencePack(league, week);
    const names = new Map(league.teams.map((t) => [t.id, t.name]));
    // A week-0 draft records the platform order, which is no starting order.
    const starts = week === 0 ? [] : ranking.meta.starting_order;
    const rows = Object.entries(order)
        .map(([team, { place }]) => {
        const ev = pack.teams[team] ?? {};
        return {
            place,
            ...(starts.includes(team) && { start: starts.indexOf(team) + 1 }),
            team,
            name: names.get(team) ?? team,
            ...text("record", ev.record),
            ...number("rank", ev.standing),
            ...number("ppg", ev.ppg),
            ...text("allPlay", ev.allplay),
            ...number("form", ev.form3),
            ...number("luck", ev.luck),
            ...text("streak", ev.streak),
            ...number("pointsFor", ev.pf),
            injuries: teamInjuries(league, team),
        };
    })
        .sort((a, b) => a.place - b.place);
    return {
        week,
        dataWeek: week,
        method: methodName(ranking.meta.power_score),
        rows: opts.sort ? bestFirst(rows, GOODNESS[opts.sort]) : rows,
    };
}
/** `rows` best first by `goodness`, those without it last; a stable sort keeps ties in order. */
function bestFirst(rows, goodness) {
    const score = (r) => goodness(r) ?? -Infinity;
    return [...rows].sort((a, b) => score(b) - score(a));
}
/** `{ [key]: value }` for a text stat the team has, else nothing. */
function text(key, value) {
    return typeof value === "string"
        ? { [key]: value }
        : {};
}
/** `{ [key]: value }` for a number stat the team has, else nothing. */
function number(key, value) {
    return typeof value === "number"
        ? { [key]: value }
        : {};
}
/**
 * The look for output to `out`: a terminal's width and a bold header unless
 * `NO_COLOR` is set; plain columns for output that isn't a terminal.
 */
export function statsTableLook(out, env) {
    if (!out.isTTY)
        return { bold: false };
    return {
        ...(out.columns ? { width: out.columns } : {}),
        bold: env.noColor !== true,
    };
}
/** The mark for a stat a team doesn't have yet. */
export const MISSING = "—";
/**
 * The columns after a row's place and name: its starting place and stats, as
 * the terminal prints them and the Check tab's stats panel shows them.
 */
export const STAT_COLUMNS = [
    {
        heading: "Start",
        cell: (r) => (r.start === undefined ? MISSING : String(r.start)),
        right: true,
    },
    { heading: "Record", cell: (r) => r.record ?? MISSING },
    {
        heading: "Rank",
        cell: (r) => (r.rank === undefined ? MISSING : ordinal(r.rank)),
    },
    { heading: "PPG", cell: (r) => decimal(r.ppg), right: true },
    { heading: "All-play", cell: (r) => r.allPlay ?? MISSING },
    { heading: "Form", cell: (r) => decimal(r.form), right: true },
    { heading: "Luck", cell: (r) => decimal(r.luck), right: true },
    { heading: "Streak", cell: (r) => r.streak ?? MISSING },
];
/**
 * The stats key: a line each saying what all-play, form and luck mean, under
 * the terminal's table and on the Check tab.
 */
export const STATS_KEY = [
    "All-play: your record if you'd played every team every week, not just your opponent. It shows how good your scores are, without the luck of who you drew.",
    "Form: your average points over your last three weeks played.",
    "Luck: your wins minus the wins your all-play record would expect. Above 0, you've won more than your scores earned.",
];
/** Each column of the terminal's table. */
const COLUMNS = [
    { heading: "#", cell: (r) => String(r.place), right: true },
    ...STAT_COLUMNS.slice(0, 1),
    { heading: "Team", cell: (r) => r.name },
    ...STAT_COLUMNS.slice(1),
];
const TEAM = COLUMNS.findIndex((c) => c.heading === "Team");
const GAP = "  ";
/**
 * The Stats table as terminal text: the header naming the week, the data's
 * last week and the method, a blank line, the column headings and a line per
 * row, then a blank line and the stats key. With a `width`, a long team name
 * is cut with "…" so each row fits; the key is printed whole.
 */
export function renderStatsTable(table, look) {
    const header = statsTableHeader(table);
    const lines = statsTableLines(table, look.width);
    const title = bold(header, look.bold);
    return `${[title, "", ...lines, "", ...STATS_KEY].join("\n")}\n`;
}
/** `text` in bold, when the look allows it. */
export function bold(text, on) {
    return on ? `\x1b[1m${text}\x1b[22m` : text;
}
/** The heading of the column `sort` sorts by, as the table shows it ("PPG" for `ppg`). */
export function sortHeading(sort) {
    return (STAT_COLUMNS.find((c) => c.heading.toLowerCase() === sort)?.heading ?? sort);
}
/** The Stats table's header: the week, the data's last week and the method. */
export function statsTableHeader(table) {
    return `Week ${table.week} draft · data through week ${table.dataWeek} · method: ${table.method}`;
}
/**
 * The Stats table's column headings and a line per row, each cell padded to
 * its column. With a `width`, a long team name is cut with "…" so each line
 * fits, though never below the "Team" heading's length.
 */
export function statsTableLines(table, width) {
    const cells = [
        COLUMNS.map((c) => c.heading),
        ...table.rows.map((r) => COLUMNS.map((c) => c.cell(r))),
    ];
    const widths = COLUMNS.map((_, i) => Math.max(...cells.map((line) => line[i].length)));
    if (width !== undefined) {
        const total = widths.reduce((a, b) => a + b, 0) + GAP.length * (widths.length - 1);
        const over = total - width;
        if (over > 0) {
            const team = widths[TEAM];
            widths[TEAM] = Math.max("Team".length, team - over);
        }
    }
    return cells.map((line) => line
        .map((cell, i) => {
        const w = widths[i];
        const text = cut(cell, w);
        return COLUMNS[i]?.right ? text.padStart(w) : text.padEnd(w);
    })
        .join(GAP)
        .trimEnd());
}
/** `text` cut to `width` with "…" at the end, if it's longer. */
export function cut(text, width) {
    return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}
/** A number to two decimal places, or the missing mark. */
export function decimal(n) {
    return n === undefined ? MISSING : n.toFixed(2);
}
/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, 21st. */
export function ordinal(n) {
    const teen = n % 100 >= 11 && n % 100 <= 13;
    const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
    return `${n}${suffix}`;
}
/** A method as the header names it, such as "ramped blend". */
function methodName(record) {
    return record.method === "ramped-blend" ? "ramped blend" : record.method;
}
//# sourceMappingURL=stats-table.js.map