import { describe, expect, test } from "vitest";
import {
  STATS_TABLE_SORTS,
  type StatsTable,
  type StatsTableSort,
} from "../src/index.ts";
import { STATS_KEY } from "../src/stats-table.ts";
import {
  renderStatsView,
  type StatsViewState,
  statsViewStep,
} from "../src/stats-view.ts";

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

  test("a re-sort keeps the highlight on the same team", () => {
    expect(statsViewStep({ team: "sleeper:11" }, "right", tableFor)).toEqual({
      sort: "start",
      team: "sleeper:11",
    });
  });
});
