import type { Environment } from "./deps.ts";
import type { TeamId } from "./league.ts";
import { type StatsTable, type StatsTableSort } from "./stats-table.ts";
/** What the full-screen Stats table shows: its sort (none is the draft's order) and the highlighted team. */
export interface StatsViewState {
    sort?: StatsTableSort;
    team: TeamId;
}
/** The keys the full-screen Stats table acts on, by readline's names: ←/→ change the sort, ↑/↓ move the highlight. */
declare const MOVES: readonly ["left", "right", "up", "down"];
export type StatsViewMove = (typeof MOVES)[number];
/**
 * The state after `move`: ←/→ step to the previous or next sort, from the
 * draft's order through each sort column its week offers (`sortsFor`), wrapping
 * round, with the highlight kept on its team; ↑/↓ move the highlight a row in
 * the order `tableFor` gives for the shown sort, stopping at the first and last.
 */
export declare function statsViewStep(state: StatsViewState, move: StatsViewMove, tableFor: (sort?: StatsTableSort) => StatsTable): StatsViewState;
/** How the full-screen Stats table is drawn: the terminal's size, and bold and reverse video unless `NO_COLOR`. */
export interface StatsViewLook {
    width: number;
    height: number;
    bold: boolean;
}
/**
 * The full-screen Stats table as the terminal's lines, `height` of them, none
 * wider than `width`: the header with the sort at its right, the column
 * headings and a row per team from the static table's own lines, the
 * highlighted row marked ▶, then the stats key wrapped to the width, and the
 * footer naming the keys on the last line. When the rows and key don't fit,
 * they scroll so the highlighted row shows, under the header and headings.
 */
export declare function renderStatsView(table: StatsTable, state: StatsViewState, look: StatsViewLook): string[];
/** The terminal the full-screen Stats table draws on and reads keys from. */
export interface StatsViewTerminal {
    input: NodeJS.ReadStream;
    output: NodeJS.WriteStream;
    env: Environment;
}
/**
 * `table` in a terminal: the latest draft's Stats table full screen on the
 * alternate screen, until `q` or Esc (exit code 0) or Ctrl-C (1, as a
 * cancelled setup exits). It checks the draft first, so a refusal throws
 * before any screen opens, and checks it once: each sort is built from that
 * check. A resize redraws to the new size. Closing puts the screen back as it
 * was, leaving nothing in the scrollback.
 */
export declare function statsView(workspaceDir: string, { input, output, env }: StatsViewTerminal): Promise<number>;
export {};
