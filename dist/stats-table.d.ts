import { type CheckedDraft } from "./check.ts";
import type { Environment } from "./deps.ts";
import { type Injury } from "./evidence-pack.ts";
import type { TeamId } from "./league.ts";
/**
 * One team's row in the Stats table. A stat the team doesn't have yet, such
 * as a streak before any decided matchup, is left out.
 */
export interface StatsTableRow {
    /** The team's place in the draft as the file stands. */
    place: number;
    /** Its starting place; none in a week-0 draft, which has no starting order. */
    start?: number;
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
    /** Its points for through the ranking week. */
    pointsFor?: number;
    /** Its injured starters and bench players in the draft's snapshot, `[]` when nobody is hurt. */
    injuries: Injury[];
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
export declare const STATS_TABLE_SORTS: readonly ["start", "record", "rank", "ppg", "all-play", "form", "luck"];
export type StatsTableSort = (typeof STATS_TABLE_SORTS)[number];
/** Why `value` can't be a sort column, or nothing when it can. */
export declare function sortProblem(value: string): string | undefined;
/** The sorts a week's Stats table offers: every one but `start` at week 0, which has no starting order. */
export declare function sortsFor(week: number): readonly StatsTableSort[];
/** A Stats table the draft can't give: a sort by Start at week 0. Refused before anything is shown. */
export declare class StatsTableRefusal extends Error {
    name: string;
}
/**
 * The Stats table for the latest draft, read from the snapshot it records
 * through its ranking week. It reads the draft with `check`'s parse and checks,
 * so it refuses what `check` refuses, and writes nothing. The rows are in the
 * draft's order, or best first by `sort` with ties in the draft's order.
 */
export declare function statsTable(workspaceDir: string, opts?: {
    sort?: StatsTableSort;
}): Promise<StatsTable>;
/**
 * The Stats table for a draft its caller has already checked, as `statsTable`
 * gives it, so a caller that shows the problems list too checks it once.
 */
export declare function statsTableFrom({ ranking, league, order }: CheckedDraft, opts?: {
    sort?: StatsTableSort;
}): StatsTable;
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
export declare function statsTableLook(out: {
    isTTY?: boolean;
    columns?: number;
}, env: Environment): StatsTableLook;
/** The mark for a stat a team doesn't have yet. */
export declare const MISSING = "\u2014";
/** A column: its heading, its cell for a row, and whether it aligns right. */
interface Column {
    heading: string;
    cell: (r: StatsTableRow) => string;
    right?: true;
}
/**
 * The columns after a row's place and name: its starting place and stats, as
 * the terminal prints them and the Check tab's stats panel shows them.
 */
export declare const STAT_COLUMNS: Column[];
/**
 * The stats key: a line each saying what all-play, form and luck mean, under
 * the terminal's table and on the Check tab.
 */
export declare const STATS_KEY: readonly ["All-play: your record if you'd played every team every week, not just your opponent. It shows how good your scores are, without the luck of who you drew.", "Form: your average points over your last three weeks played.", "Luck: your wins minus the wins your all-play record would expect. Above 0, you've won more than your scores earned."];
/**
 * The Stats table as terminal text: the header naming the week, the data's
 * last week and the method, a blank line, the column headings and a line per
 * row, then a blank line and the stats key. With a `width`, a long team name
 * is cut with "…" so each row fits; the key is printed whole.
 */
export declare function renderStatsTable(table: StatsTable, look: StatsTableLook): string;
/** `text` in bold, when the look allows it. */
export declare function bold(text: string, on: boolean): string;
/** The heading of the column `sort` sorts by, as the table shows it ("PPG" for `ppg`). */
export declare function sortHeading(sort: StatsTableSort): string;
/** The Stats table's header: the week, the data's last week and the method. */
export declare function statsTableHeader(table: StatsTable): string;
/**
 * The Stats table's column headings and a line per row, each cell padded to
 * its column. With a `width`, a long team name is cut with "…" so each line
 * fits, though never below the "Team" heading's length.
 */
export declare function statsTableLines(table: StatsTable, width?: number): string[];
/** `text` cut to `width` with "…" at the end, if it's longer. */
export declare function cut(text: string, width: number): string;
/** A number to two decimal places, or the missing mark. */
export declare function decimal(n: number | undefined): string;
/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, 21st. */
export declare function ordinal(n: number): string;
export {};
