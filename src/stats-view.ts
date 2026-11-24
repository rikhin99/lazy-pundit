import { emitKeypressEvents } from "node:readline";
import { checkDraft } from "./check.ts";
import type { Environment } from "./deps.ts";
import type { TeamId } from "./league.ts";
import {
  bold,
  cut,
  STATS_KEY,
  type StatsTable,
  type StatsTableSort,
  sortHeading,
  sortsFor,
  statsTableFrom,
  statsTableHeader,
  statsTableLines,
} from "./stats-table.ts";

/** What the full-screen Stats table shows: its sort (none is the draft's order) and the highlighted team. */
export interface StatsViewState {
  sort?: StatsTableSort;
  team: TeamId;
}

/** The keys the full-screen Stats table acts on, by readline's names: ←/→ change the sort, ↑/↓ move the highlight. */
const MOVES = ["left", "right", "up", "down"] as const;

export type StatsViewMove = (typeof MOVES)[number];

/**
 * The state after `move`: ←/→ step to the previous or next sort, from the
 * draft's order through each sort column its week offers (`sortsFor`), wrapping
 * round, with the highlight kept on its team; ↑/↓ move the highlight a row in
 * the order `tableFor` gives for the shown sort, stopping at the first and last.
 */
export function statsViewStep(
  state: StatsViewState,
  move: StatsViewMove,
  tableFor: (sort?: StatsTableSort) => StatsTable,
): StatsViewState {
  if (move === "left" || move === "right") {
    const sorts = [undefined, ...sortsFor(tableFor(state.sort).week)];
    const at = sorts.indexOf(state.sort);
    const next =
      sorts[(at + (move === "right" ? 1 : -1) + sorts.length) % sorts.length];
    return { ...(next ? { sort: next } : {}), team: state.team };
  }
  const rows = tableFor(state.sort).rows;
  const at = rows.findIndex((r) => r.team === state.team);
  // Past the first or last row there's none, and the highlight stays.
  const next = rows[at + (move === "down" ? 1 : -1)];
  return next ? { ...state, team: next.team } : state;
}

/** How the full-screen Stats table is drawn: the terminal's size, and bold and reverse video unless `NO_COLOR`. */
export interface StatsViewLook {
  width: number;
  height: number;
  bold: boolean;
}

const FOOTER = "←/→ sort  ↑/↓ move  q quit";
const MARK = "▶ ";

/**
 * The full-screen Stats table as the terminal's lines, `height` of them, none
 * wider than `width`: the header with the sort at its right, the column
 * headings and a row per team from the static table's own lines, the
 * highlighted row marked ▶, then the stats key wrapped to the width, and the
 * footer naming the keys on the last line. When the rows and key don't fit,
 * they scroll so the highlighted row shows, under the header and headings.
 */
export function renderStatsView(
  table: StatsTable,
  state: StatsViewState,
  look: StatsViewLook,
): string[] {
  const { width, height } = look;
  const sortText = state.sort
    ? `sort: ${sortHeading(state.sort)} ▾`
    : "sort: draft order";
  const room = width - sortText.length - 2;
  const header =
    room > 0
      ? `${cut(statsTableHeader(table), room).padEnd(room)}  ${sortText}`
      : cut(sortText, width);
  const [headings = "", ...rows] = statsTableLines(
    table,
    width - MARK.length,
  ).map((line) => cut(line, width - MARK.length));
  const highlight = table.rows.findIndex((r) => r.team === state.team);
  const scrolled = [
    ...rows.map((line, i) =>
      i === highlight
        ? reverse(`${MARK}${line}`, width, look.bold)
        : `${" ".repeat(MARK.length)}${line}`,
    ),
    "",
    ...STATS_KEY.flatMap((line) => wrap(line, width)),
  ];
  const top = [
    bold(header, look.bold),
    "",
    `${" ".repeat(MARK.length)}${headings}`,
  ];
  const space = Math.max(0, height - top.length - 1);
  const offset = Math.max(0, highlight - space + 1);
  const body = scrolled.slice(offset, offset + space);
  const filler = Array<string>(space - body.length).fill("");
  return [...top, ...body, ...filler, cut(FOOTER, width)].slice(-height);
}

/** `line` in reverse video across the whole `width`, when the look allows it. */
function reverse(line: string, width: number, on: boolean): string {
  return on ? `\x1b[7m${line.padEnd(width)}\x1b[27m` : line;
}

/** `text` broken at spaces into lines no wider than `width`; a word wider than it is cut. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = "";
    }
    line = line ? `${line} ${word}` : cut(word, width);
  }
  return [...lines, line];
}

/** The terminal the full-screen Stats table draws on and reads keys from. */
export interface StatsViewTerminal {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  env: Environment;
}

// The alternate screen with the cursor hidden, and back to the screen as it was.
const OPEN = "\x1b[?1049h\x1b[?25l";
const CLOSE = "\x1b[?25h\x1b[?1049l";

/**
 * `table` in a terminal: the latest draft's Stats table full screen on the
 * alternate screen, until `q` or Esc (exit code 0) or Ctrl-C (1, as a
 * cancelled setup exits). It checks the draft first, so a refusal throws
 * before any screen opens, and checks it once: each sort is built from that
 * check. A resize redraws to the new size. Closing puts the screen back as it
 * was, leaving nothing in the scrollback.
 */
export async function statsView(
  workspaceDir: string,
  { input, output, env }: StatsViewTerminal,
): Promise<number> {
  const checked = await checkDraft(workspaceDir, { autoTag: false });
  const tables = new Map<StatsTableSort | undefined, StatsTable>();
  const tableFor = (sort?: StatsTableSort): StatsTable => {
    const built =
      tables.get(sort) ?? statsTableFrom(checked, sort ? { sort } : {});
    tables.set(sort, built);
    return built;
  };
  const first = tableFor().rows[0];
  let state: StatsViewState = { team: first?.team ?? ("" as TeamId) };
  const draw = () => {
    const lines = renderStatsView(tableFor(state.sort), state, {
      width: output.columns || 80,
      height: output.rows || 24,
      bold: env.noColor !== true,
    });
    // Each line clears what an earlier, wider draw left after it.
    output.write(`\x1b[H${lines.map((l) => `${l}\x1b[K`).join("\n")}`);
  };
  return new Promise((resolve) => {
    const close = (code: number) => {
      input.off("keypress", onKey);
      output.off("resize", draw);
      input.setRawMode(false);
      input.pause();
      output.write(CLOSE);
      resolve(code);
    };
    const onKey = (
      _: string | undefined,
      key?: { name?: string; ctrl?: boolean },
    ) => {
      if (key?.ctrl && key.name === "c") return close(1);
      if (key?.name === "q" || key?.name === "escape") return close(0);
      const move = MOVES.find((m) => m === key?.name);
      if (move) {
        state = statsViewStep(state, move, tableFor);
        draw();
      }
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKey);
    output.on("resize", draw);
    output.write(`${OPEN}\x1b[2J`);
    draw();
  });
}
