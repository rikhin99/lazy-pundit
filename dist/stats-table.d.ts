import type { Environment } from "./deps.ts";
import type { TeamId } from "./league.ts";
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
export declare const STATS_TABLE_SORTS: readonly ["start", "record", "rank", "ppg", "all-play", "form", "luck"];
export type StatsTableSort = (typeof STATS_TABLE_SORTS)[number];
/** Why `value` can't be a sort column, or nothing when it can. */
export declare function sortProblem(value: string): string | undefined;
/**
 * The Stats table for the latest draft, read from the snapshot it records
 * through its ranking week. It reads the draft with `check`'s parse and checks,
 * so it refuses what `check` refuses, and writes nothing. The rows are in the
 * draft's order, or best first by `sort` with ties in the draft's order.
 */
export declare function statsTable(workspaceDir: string, opts?: {
    sort?: StatsTableSort;
}): Promise<StatsTable>;
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
/**
 * The Stats table as terminal text: the header naming the week, the data's
 * last week and the method, a blank line, the column headings and a line per
 * row. With a `width`, a long team name is cut with "…" so each row fits.
 */
export declare function renderStatsTable(table: StatsTable, look: StatsTableLook): string;
