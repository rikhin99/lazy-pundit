import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, test } from "vitest";
import {
  draft,
  STATS_TABLE_SORTS,
  type StatsTable,
  type StatsTableSort,
  type StatsViewTerminal,
  statsView,
} from "../src/index.ts";
import { STATS_KEY } from "../src/stats-table.ts";
import {
  renderStatsView,
  type StatsViewState,
  statsViewStep,
} from "../src/stats-view.ts";
import { fearTheTurtle } from "./support/workspace.ts";

const ROWS: StatsTable["rows"] = [
  {
    place: 1,
    start: 2,
    team: "sleeper:3",
    name: "Bench Mob",
    record: "9-1",
    rank: 1,
    ppg: 123.99,
    allPlay: "80-30",
    form: 128,
    luck: 1.36,
    streak: "W9",
    injuries: [],
  },
  {
    place: 2,
    start: 1,
    team: "sleeper:11",
    name: "The Extremely Long Team Name Of Bye Bye Bea",
    record: "7-3",
    rank: 2,
    ppg: 125.4,
    allPlay: "79-31",
    form: 133.2,
    luck: -0.05,
    streak: "L1",
    injuries: [],
  },
  {
    place: 3,
    start: 3,
    team: "sleeper:9",
    name: "Hail Mary Hustle",
    injuries: [],
  },
];

/** The table as `statsTableFrom` would give it for `sort`: here, PPG reverses the first two. */
function tableFor(sort?: StatsTableSort): StatsTable {
  const rows = sort === "ppg" ? [ROWS[1], ROWS[0], ROWS[2]] : [...ROWS];
  return {
    week: 10,
    dataWeek: 10,
    method: "ramped blend",
    rows: rows as StatsTable["rows"],
  };
}

const TITLE = "Week 10 draft · data through week 10 · method: ramped blend";
const FOOTER = "←/→ sort  ↑/↓ move  q quit";

describe("the full-screen Stats table", () => {
  test("draws the header with the sort, the rows in the file's order with the first highlighted, the stats key and the footer", () => {
    const state: StatsViewState = { team: "sleeper:3" };
    const screen = renderStatsView(tableFor(), state, {
      width: 120,
      height: 16,
      bold: false,
    });
    expect(screen).toEqual([
      `${TITLE}${" ".repeat(120 - TITLE.length - "sort: draft order".length)}sort: draft order`,
      "",
      "  #  Start  Team                                         Record  Rank     PPG  All-play    Form   Luck  Streak",
      "▶ 1      2  Bench Mob                                    9-1     1st   123.99  80-30     128.00   1.36  W9",
      "  2      1  The Extremely Long Team Name Of Bye Bye Bea  7-3     2nd   125.40  79-31     133.20  -0.05  L1",
      "  3      3  Hail Mary Hustle                             —       —          —  —              —      —  —",
      "",
      // The first key line is longer than 120, so it wraps at a space.
      "All-play: your record if you'd played every team every week, not just your opponent. It shows how good your scores are,",
      "without the luck of who you drew.",
      STATS_KEY[1],
      STATS_KEY[2],
      "",
      "",
      "",
      "",
      FOOTER,
    ]);
  });

  test("at week 0 draws — in Start for every team, and the stats key under the rows", () => {
    const rows = ROWS.map(({ start: _, ...row }) => row);
    const screen = renderStatsView(
      { week: 0, dataWeek: 0, method: "ramped blend", rows },
      { team: "sleeper:3" },
      { width: 120, height: 12, bold: false },
    );

    expect(screen.slice(2, 10)).toEqual([
      "  #  Start  Team                                         Record  Rank     PPG  All-play    Form   Luck  Streak",
      "▶ 1      —  Bench Mob                                    9-1     1st   123.99  80-30     128.00   1.36  W9",
      "  2      —  The Extremely Long Team Name Of Bye Bye Bea  7-3     2nd   125.40  79-31     133.20  -0.05  L1",
      "  3      —  Hail Mary Hustle                             —       —          —  —              —      —  —",
      "",
      "All-play: your record if you'd played every team every week, not just your opponent. It shows how good your scores are,",
      "without the luck of who you drew.",
      "Form: your average points over your last three weeks played.",
    ]);
  });

  test("names the sort column best first, from the column's heading", () => {
    const [header] = renderStatsView(
      tableFor("all-play"),
      { sort: "all-play", team: "sleeper:3" },
      { width: 100, height: 16, bold: false },
    );

    expect(header).toMatch(/ {2}sort: All-play ▾$/);
    expect(header).toHaveLength(100);
  });

  test("bolds the header and shows the highlight in reverse video, unless NO_COLOR", () => {
    const screen = renderStatsView(
      tableFor(),
      { team: "sleeper:11" },
      { width: 120, height: 16, bold: true },
    );

    expect(screen[0]?.startsWith("\x1b[1mWeek 10 draft ")).toBe(true);
    expect(screen[0]?.endsWith("\x1b[22m")).toBe(true);
    expect(screen[4]?.startsWith("\x1b[7m▶ 2 ")).toBe(true);
    expect(screen[4]?.endsWith("\x1b[27m")).toBe(true);
    // The reverse video runs the whole width, not just the row's text.
    expect(
      screen[4]?.replace("\x1b[7m", "").replace("\x1b[27m", ""),
    ).toHaveLength(120);
    expect(screen[3]).not.toContain("\x1b");
  });

  test("cuts every line to a narrow terminal, so none wraps", () => {
    const screen = renderStatsView(
      tableFor(),
      { team: "sleeper:3" },
      { width: 40, height: 20, bold: false },
    );

    expect(screen).toHaveLength(20);
    for (const line of screen) expect(line.length).toBeLessThanOrEqual(40);
    expect(screen[3]).toMatch(/^▶ 1 .*…$/);
    expect(screen[0]).toMatch(/… {2}sort: draft order$/);
    expect(screen.at(-1)).toBe(FOOTER);
  });

  test("in a short terminal, scrolls the rows so the highlight shows, keeping the header and headings", () => {
    const screen = renderStatsView(
      tableFor(),
      { team: "sleeper:9" },
      { width: 120, height: 6, bold: false },
    );

    expect(screen).toHaveLength(6);
    expect(screen[0]).toMatch(/^Week 10 draft/);
    expect(screen[2]).toMatch(/^ {2}# +Start/);
    expect(screen[3]).toMatch(/^ {2}2 /);
    expect(screen[4]).toMatch(/^▶ 3 .*Hail Mary Hustle/);
    expect(screen[5]).toBe(FOOTER);
  });
});

describe("a key in the full-screen Stats table", () => {
  test("→ goes from the file's order through each sort column and back, and ← the other way", () => {
    let state: StatsViewState = { team: "sleeper:3" };
    const sorts: (StatsTableSort | undefined)[] = [];
    for (let i = 0; i <= STATS_TABLE_SORTS.length; i++) {
      state = statsViewStep(state, "right", tableFor);
      sorts.push(state.sort);
    }

    expect(sorts).toEqual([...STATS_TABLE_SORTS, undefined]);
    expect(statsViewStep({ team: "sleeper:3" }, "left", tableFor).sort).toBe(
      "luck",
    );
    expect(
      statsViewStep({ sort: "start", team: "sleeper:3" }, "left", tableFor)
        .sort,
    ).toBeUndefined();
  });

  test("↑/↓ move the highlight a row in the shown order, stopping at the ends", () => {
    const down = statsViewStep({ team: "sleeper:3" }, "down", tableFor);
    const sortedDown = statsViewStep(
      { sort: "ppg", team: "sleeper:3" },
      "down",
      tableFor,
    );

    expect(down.team).toBe("sleeper:11");
    expect(sortedDown.team).toBe("sleeper:9");
    expect(statsViewStep({ team: "sleeper:3" }, "up", tableFor).team).toBe(
      "sleeper:3",
    );
    expect(statsViewStep({ team: "sleeper:9" }, "down", tableFor).team).toBe(
      "sleeper:9",
    );
  });

  test("at week 0, → and ← skip Start, which a preseason draft hasn't got", () => {
    const preseason = (sort?: StatsTableSort): StatsTable => ({
      ...tableFor(sort),
      week: 0,
      dataWeek: 0,
    });
    let state: StatsViewState = { team: "sleeper:3" };
    const sorts: (StatsTableSort | undefined)[] = [];
    for (let i = 0; i < 7; i++) {
      state = statsViewStep(state, "right", preseason);
      sorts.push(state.sort);
    }

    expect(sorts).toEqual([
      "record",
      "rank",
      "ppg",
      "all-play",
      "form",
      "luck",
      undefined,
    ]);
    expect(
      statsViewStep({ sort: "record", team: "sleeper:3" }, "left", preseason)
        .sort,
    ).toBeUndefined();
  });

  test("a re-sort keeps the highlight on the same team", () => {
    expect(statsViewStep({ team: "sleeper:11" }, "right", tableFor)).toEqual({
      sort: "start",
      team: "sleeper:11",
    });
  });
});

const RESTORE = "\x1b[?25h\x1b[?1049l";

/**
 * A terminal for `statsView`: its input takes keys by `press`, and its
 * output keeps what's written and throws `failure` on write number `failOn`,
 * and with `keepFailing` an EIO on every write after it, as a closed tab does.
 */
function fakeTerminal(failOn?: number, { keepFailing = false } = {}) {
  const failure = new Error("drawing failed");
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    rawModes: [] as boolean[],
    setRawMode(mode: boolean) {
      this.rawModes.push(mode);
      return this;
    },
  });
  const written: string[] = [];
  const output = Object.assign(new EventEmitter(), {
    columns: 100,
    rows: 30,
    write(text: string) {
      written.push(text);
      if (written.length === failOn) throw failure;
      if (keepFailing && failOn && written.length > failOn) {
        throw new Error("write EIO");
      }
      return true;
    },
  });
  const terminal = {
    input,
    output,
    env: { nodeVersion: "v24.1.0" },
  } as unknown as StatsViewTerminal;
  const press = (name: string) => input.emit("keypress", undefined, { name });
  const restores = () => written.filter((w) => w.includes(RESTORE)).length;
  return { terminal, input, output, written, press, restores, failure };
}

const SIGNALS = ["SIGTERM", "SIGHUP"] as const;
const signalListeners = () => SIGNALS.map((s) => process.listenerCount(s));

describe("how the full-screen Stats table ends", () => {
  let dir: string;
  beforeAll(async () => {
    const ws = await fearTheTurtle(10);
    await draft(ws.dir, ws.deps);
    dir = ws.dir;
  });

  test("q restores the screen once and leaves no signal listener of its own on process", async () => {
    const before = signalListeners();
    const t = fakeTerminal();
    const ended = statsView(dir, t.terminal);
    await expect.poll(() => t.written.length).toBe(2);
    t.press("q");
    await expect(ended).resolves.toBe(0);
    expect(t.restores()).toBe(1);
    expect(t.input.rawModes).toEqual([true, false]);
    expect(signalListeners()).toEqual(before);
  });

  test.each([
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const)(
    "%s restores the screen once, turns raw mode off and ends with %i",
    async (signal, code) => {
      const before = signalListeners();
      const t = fakeTerminal();
      const ended = statsView(dir, t.terminal);
      await expect.poll(() => t.written.length).toBe(2);
      process.emit(signal);
      process.emit(signal);
      await expect(ended).resolves.toBe(code);
      expect(t.restores()).toBe(1);
      expect(t.input.rawModes).toEqual([true, false]);
      expect(signalListeners()).toEqual(before);
    },
  );

  test("an error drawing after a key restores the screen once, turns raw mode off and rejects with it", async () => {
    const before = signalListeners();
    // Writes: the screen opened, the first draw, then the redraw after ↓.
    const t = fakeTerminal(3);
    const ended = statsView(dir, t.terminal);
    await expect.poll(() => t.written.length).toBe(2);
    t.press("down");
    await expect(ended).rejects.toBe(t.failure);
    expect(t.restores()).toBe(1);
    expect(t.input.rawModes).toEqual([true, false]);
    t.press("q");
    expect(t.restores()).toBe(1);
    expect(signalListeners()).toEqual(before);
  });

  test("SIGHUP from a closed tab still ends with 129 when the terminal can't be written or errors after", async () => {
    // Writes: the screen opened, the first draw; the restore then fails.
    const t = fakeTerminal(3, { keepFailing: true });
    const ended = statsView(dir, t.terminal);
    await expect.poll(() => t.written.length).toBe(2);
    process.emit("SIGHUP");
    await expect(ended).resolves.toBe(129);
    expect(t.input.rawModes).toEqual([true, false]);
    // Node reports a failed write to a terminal later, as an error event.
    expect(() => t.output.emit("error", new Error("write EIO"))).not.toThrow();
  });

  test("an error drawing that leaves every later write failing still rejects with the drawing's error", async () => {
    const t = fakeTerminal(3, { keepFailing: true });
    const ended = statsView(dir, t.terminal);
    await expect.poll(() => t.written.length).toBe(2);
    t.press("down");
    await expect(ended).rejects.toBe(t.failure);
    expect(t.input.rawModes).toEqual([true, false]);
  });

  test("an error in the first draw restores the screen and rejects with it", async () => {
    const before = signalListeners();
    const t = fakeTerminal(2);
    await expect(statsView(dir, t.terminal)).rejects.toBe(t.failure);
    expect(t.restores()).toBe(1);
    expect(t.input.rawModes).toEqual([true, false]);
    expect(signalListeners()).toEqual(before);
  });

  test("an error in a redraw on a resize restores the screen and rejects with it", async () => {
    const t = fakeTerminal(3);
    const ended = statsView(dir, t.terminal);
    await expect.poll(() => t.written.length).toBe(2);
    t.output.emit("resize");
    await expect(ended).rejects.toBe(t.failure);
    expect(t.restores()).toBe(1);
    expect(t.input.rawModes).toEqual([true, false]);
    const writes = t.written.length;
    t.output.emit("resize");
    expect(t.written.length).toBe(writes);
  });
});
