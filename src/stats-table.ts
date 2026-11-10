import { checkDraft } from "./check.ts";
import type { Environment } from "./deps.ts";
import { buildEvidencePack } from "./evidence-pack.ts";
import type { TeamId } from "./league.ts";
import type { PowerScoreRecord } from "./power-score.ts";
import type { EvidenceValue, OrderEvidence } from "./validator/types.ts";

/**
 * One team's row in the Stats table. A stat the team doesn't have yet, such
 * as a streak before any decided matchup, is left out.
 */
export interface StatsTableRow {
  /** The team's place in the draft as the file stands. */
  place: number;
  /** Its starting place. */
  start: number;
  team: TeamId;
  name: string;
  record?: string;
  /** Its rank in the standings. */
  rank?: number;
  ppg?: number;
  allPlay?: string;
  form?: number;
  luck?: number;
  streak?: string;
}

/** The Stats table for the latest draft: the rows and what its header names. */
export interface StatsTable {
  /** The draft's ranking week. */
  week: number;
  /** The last week the stats count: the ranking week, never the in-progress week. */
  dataWeek: number;
  /** The power-score method the starting order came from, as the header names it. */
  method: string;
  /** One per team, in the draft's current order. */
  rows: StatsTableRow[];
}

/** The columns the Stats table can be sorted by. */
export const STATS_TABLE_SORTS = [
  "start",
  "record",
  "rank",
  "ppg",
  "all-play",
  "form",
  "luck",
] as const;

export type StatsTableSort = (typeof STATS_TABLE_SORTS)[number];

/** Why `value` can't be a sort column, or nothing when it can. */
export function sortProblem(value: string): string | undefined {
  if ((STATS_TABLE_SORTS as readonly string[]).includes(value)) return;
  const valid = `${STATS_TABLE_SORTS.slice(0, -1).join(", ")} or ${STATS_TABLE_SORTS.at(-1)}`;
  return `There's no "${value}" column to sort by; use ${valid}.`;
}

/**
 * How good a row is for each sort, higher being better: the lowest Start and
 * Rank, the highest of the rest, with win percentage for the two records. A
 * team without the stat goes last.
 */
const GOODNESS: Record<
  StatsTableSort,
  (r: StatsTableRow) => number | undefined
> = {
  start: (r) => -r.start,
  record: (r) => winShare(r.record),
  rank: (r) => (r.rank === undefined ? undefined : -r.rank),
  ppg: (r) => r.ppg,
  "all-play": (r) => winShare(r.allPlay),
  form: (r) => r.form,
  luck: (r) => r.luck,
};

/** The share of matchups won in a `W-L` or `W-L-T` record, a tie counting half. */
function winShare(record: string | undefined): number | undefined {
  if (record === undefined) return undefined;
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
export async function statsTable(
  workspaceDir: string,
  opts: { sort?: StatsTableSort } = {},
): Promise<StatsTable> {
  const { ranking, league, order } = await checkDraft(workspaceDir, {
    autoTag: false,
  });
  const week = ranking.meta.week;
  // Through the ranking week alone, so an in-progress week a draft let in
  // adds nothing.
  const pack = buildEvidencePack(league, week);
  const names = new Map<string, string>(
    league.teams.map((t) => [t.id, t.name]),
  );
  const starts = ranking.meta.starting_order;
  const rows = (Object.entries(order) as [TeamId, OrderEvidence][])
    .map(([team, { place }]): StatsTableRow => {
      const ev = pack.teams[team] ?? {};
      return {
        place,
        start: starts.indexOf(team) + 1,
        team,
        name: names.get(team) ?? team,
        ...text("record", ev.record),
        ...number("rank", ev.standing),
        ...number("ppg", ev.ppg),
        ...text("allPlay", ev.allplay),
        ...number("form", ev.form3),
        ...number("luck", ev.luck),
        ...text("streak", ev.streak),
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
function bestFirst(
  rows: StatsTableRow[],
  goodness: (r: StatsTableRow) => number | undefined,
): StatsTableRow[] {
  const score = (r: StatsTableRow) => goodness(r) ?? -Infinity;
  return [...rows].sort((a, b) => score(b) - score(a));
}

/** `{ [key]: value }` for a text stat the team has, else nothing. */
function text<K extends string>(key: K, value: EvidenceValue | undefined) {
  return typeof value === "string"
    ? ({ [key]: value } as Record<K, string>)
    : {};
}

/** `{ [key]: value }` for a number stat the team has, else nothing. */
function number<K extends string>(key: K, value: EvidenceValue | undefined) {
  return typeof value === "number"
    ? ({ [key]: value } as Record<K, number>)
    : {};
}

/** How the Stats table is printed: cut to a terminal's width, the header bold. */
export interface StatsTableLook {
  /** The widest a row may be; none for output that isn't a terminal. */
  width?: number;
  bold: boolean;
}

/**
 * The look for output to `out`: a terminal's width and a bold header unless
 * `NO_COLOR` is set; plain columns for output that isn't a terminal.
 */
export function statsTableLook(
  out: { isTTY?: boolean; columns?: number },
  env: Environment,
): StatsTableLook {
  if (!out.isTTY) return { bold: false };
  return {
    ...(out.columns ? { width: out.columns } : {}),
    bold: env.noColor !== true,
  };
}

const MISSING = "—";

/** Each column: its heading, its cell for a row, and whether it aligns right. */
const COLUMNS: {
  heading: string;
  cell: (r: StatsTableRow) => string;
  right?: true;
}[] = [
  { heading: "#", cell: (r) => String(r.place), right: true },
  { heading: "Start", cell: (r) => String(r.start), right: true },
  { heading: "Team", cell: (r) => r.name },
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

const TEAM = COLUMNS.findIndex((c) => c.heading === "Team");
const GAP = "  ";

/**
 * The Stats table as terminal text: the header naming the week, the data's
 * last week and the method, a blank line, the column headings and a line per
 * row. With a `width`, a long team name is cut with "…" so each row fits.
 */
export function renderStatsTable(
  table: StatsTable,
  look: StatsTableLook,
): string {
  const header = `Week ${table.week} draft · data through week ${table.dataWeek} · method: ${table.method}`;
  const cells = [
    COLUMNS.map((c) => c.heading),
    ...table.rows.map((r) => COLUMNS.map((c) => c.cell(r))),
  ];
  const widths = COLUMNS.map((_, i) =>
    Math.max(...cells.map((line) => (line[i] as string).length)),
  );
  if (look.width !== undefined) {
    const total =
      widths.reduce((a, b) => a + b, 0) + GAP.length * (widths.length - 1);
    const over = total - look.width;
    if (over > 0) {
      const team = widths[TEAM] as number;
      widths[TEAM] = Math.max("Team".length, team - over);
    }
  }
  const lines = cells.map((line) =>
    line
      .map((cell, i) => {
        const width = widths[i] as number;
        const text = cut(cell, width);
        return COLUMNS[i]?.right ? text.padStart(width) : text.padEnd(width);
      })
      .join(GAP)
      .trimEnd(),
  );
  const title = look.bold ? `\x1b[1m${header}\x1b[22m` : header;
  return `${[title, "", ...lines].join("\n")}\n`;
}

/** `text` cut to `width` with "…" at the end, if it's longer. */
function cut(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/** A number to two decimal places, or the missing mark. */
function decimal(n: number | undefined): string {
  return n === undefined ? MISSING : n.toFixed(2);
}

/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, 21st. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** A method as the header names it, such as "ramped blend". */
function methodName(record: PowerScoreRecord): string {
  return record.method === "ramped-blend" ? "ramped blend" : record.method;
}
