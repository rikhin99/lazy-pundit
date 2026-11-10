import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, test } from "vitest";
import {
  check,
  draft,
  renderStatsTable,
  STATS_TABLE_SORTS,
  type StatsTable,
  type StatsTableRow,
  sortProblem,
  statsTable,
  statsTableLook,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import {
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  frontMatter,
  type Json,
  patchingTransport,
  rankingsDir,
} from "./support/workspace.ts";

/** Week 8 as Sleeper showed it before scoring finished: week 7 is the last scored. */
async function midWeek8() {
  const ws = await fearTheTurtle(8);
  ws.deps.transport = patchingTransport(ws.deps.transport, {
    [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`]: (league: Json) => {
      league.settings.last_scored_leg = 7;
    },
  });
  return ws;
}

/** A draft's text with its team sections in reverse order. */
function reversed(text: string): string {
  const [head, ...sections] = text.split(/\n(?=## )/).map((s) => s.trimEnd());
  const teams = sections.filter((s) => s.includes("{team="));
  const rest = sections.filter((s) => !s.includes("{team="));
  return `${[head, ...rest, ...teams.reverse()].join("\n\n")}\n`;
}

/** The share of matchups won in a W-L or W-L-T record, a tie counting half. */
function winShare(record: string | undefined): number {
  const [w = 0, l = 0, t = 0] = (record ?? "").split("-").map(Number);
  return (w + t / 2) / (w + l + t);
}

/** A workspace with a week-10 draft, and its starting order. */
async function week10() {
  const ws = await fearTheTurtle(10);
  const { path } = await draft(ws.dir, ws.deps);
  const starting = frontMatter(await readFile(path, "utf8"))
    .starting_order as string[];
  return { ...ws, path, starting };
}

describe("the Stats table", () => {
  test("has one row per team in the file's order, with its stats from the draft's evidence", async () => {
    const { dir, starting } = await week10();

    const table = await statsTable(dir);

    expect(table.week).toBe(10);
    expect(table.dataWeek).toBe(10);
    expect(table.method).toBe("ramped blend");
    expect(table.rows.map((r) => r.team)).toEqual(starting);
    expect(table.rows.map((r) => r.place)).toEqual(
      starting.map((_, i) => i + 1),
    );
    expect(table.rows.map((r) => r.start)).toEqual(
      starting.map((_, i) => i + 1),
    );
    // Hand-checked from the week-10 fixture: 9-1, 1239.93 points over 10
    // weeks, weeks 8-10 of 126.89, 113.3 and 143.82, nine straight wins.
    expect(table.rows.find((r) => r.team === "sleeper:3")).toMatchObject({
      name: "Bench Mob",
      record: "9-1",
      rank: 1,
      ppg: 123.99,
      form: 128,
      streak: "W9",
    });
    expect(table.rows.find((r) => r.team === "sleeper:9")).toMatchObject({
      name: "Hail Mary Hustle",
      record: "2-8",
      rank: 12,
      ppg: 105.57,
      form: 103.28,
      streak: "W1",
    });
  });

  test("Place follows the file after the pundit moves a section, and Start doesn't", async () => {
    const { dir, path, starting } = await week10();
    const text = await readFile(path, "utf8");
    const [first, second] = starting as [string, string];
    // Swap the first two sections' tags, so the second team now heads the
    // file, and add a claim `check` would auto-tag.
    const edited = text
      .replace(`{team=${first}}`, "{team=FIRST}")
      .replace(`{team=${second}}`, `{team=${first}}`)
      .replace("{team=FIRST}", `{team=${second}}`)
      .replace("{team=sleeper:3}\n", "{team=sleeper:3}\nBench Mob are 9-1.\n");
    await writeFile(path, edited);

    const { rows } = await statsTable(dir);

    expect(await readFile(path, "utf8")).toBe(edited);
    expect(rows.slice(0, 2)).toMatchObject([
      { team: second, place: 1, start: 2 },
      { team: first, place: 2, start: 1 },
    ]);
  });

  test("a stat a team doesn't have yet is left out of its row", async () => {
    const ws = await fearTheTurtle(1);
    ws.deps.transport = patchingTransport(ws.deps.transport, {
      [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`]: (league: Json) => {
        league.settings.last_scored_leg = 0;
      },
    });
    await draft(ws.dir, ws.deps);

    const { week, rows } = await statsTable(ws.dir);

    expect(week).toBe(0);
    // Before any scored week the standings are empty too, so no team has a
    // single stat.
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "name",
        "place",
        "start",
        "team",
      ]);
    }
  });

  test.each([
    ["start", (r: StatsTableRow) => -r.start],
    ["record", (r: StatsTableRow) => winShare(r.record)],
    ["rank", (r: StatsTableRow) => -(r.rank as number)],
    ["ppg", (r: StatsTableRow) => r.ppg as number],
    ["all-play", (r: StatsTableRow) => winShare(r.allPlay)],
    ["form", (r: StatsTableRow) => r.form as number],
    ["luck", (r: StatsTableRow) => r.luck as number],
  ] as const)(
    "sorting by %s puts the best first, ties in the file's order",
    async (sort, goodness) => {
      const { dir, path, starting } = await week10();
      // Reverse the file, so the file's order differs from the starting order.
      await writeFile(path, reversed(await readFile(path, "utf8")));

      const { rows } = await statsTable(dir, { sort });

      expect(rows).toHaveLength(starting.length);
      for (const [a, b] of rows.slice(1).map((r, i) => [rows[i], r] as const)) {
        const [ga, gb] = [goodness(a as StatsTableRow), goodness(b)];
        expect(ga).toBeGreaterThanOrEqual(gb);
        if (ga === gb) expect((a as StatsTableRow).place).toBeLessThan(b.place);
      }
    },
  );

  test("the record sort has ties to keep in the file's order", async () => {
    const { dir } = await week10();

    const { rows } = await statsTable(dir, { sort: "record" });

    // Hand-checked from the week-10 fixture's records, the draft in its
    // starting order: 9-1, then 7-3 twice, 6-4, 5-5 twice, 4-6 four times,
    // 3-7 and 2-8, ties in the file's order.
    expect(rows.map((r) => [r.name, r.record])).toEqual([
      ["Bench Mob", "9-1"],
      ["Bye Bye Bea", "7-3"],
      ["Frank's FAAB Fund", "7-3"],
      ["Red Zone Rascals", "6-4"],
      ["Snap Judgement", "5-5"],
      ["Tank Brigade", "5-5"],
      ["Wendy's Wire", "4-6"],
      ["Baron Von Trade", "4-6"],
      ["Kim Possible Kicks", "4-6"],
      ["Gus Bus", "4-6"],
      ["Pylon Patrol", "3-7"],
      ["Hail Mary Hustle", "2-8"],
    ]);
  });

  test("an unknown sort is a problem that lists the valid ones", () => {
    expect(sortProblem("nope")).toBe(
      'There\'s no "nope" column to sort by; use start, record, rank, ppg, all-play, form or luck.',
    );
    for (const sort of STATS_TABLE_SORTS) {
      expect(sortProblem(sort)).toBeUndefined();
    }
  });

  test("with no draft, it refuses as check does", async () => {
    const { dir } = await fearTheTurtle(10);

    await expect(statsTable(dir)).rejects.toThrow(
      `No draft in ${rankingsDir(dir)}; run \`lazy-pundit draft\` first`,
    );
  });

  test.each([
    [
      "front matter that isn't valid YAML",
      (t: string) => t.replace("week: 10", "week: [10"),
    ],
    [
      "a missing team",
      (t: string) => t.replace(/## [^\n]*\{team=sleeper:4\}\n/, ""),
    ],
    [
      "a doubled team",
      (t: string) => t.replace("{team=sleeper:4}", "{team=sleeper:5}"),
    ],
    [
      "an unknown team",
      (t: string) => t.replace("{team=sleeper:4}", "{team=sleeper:99}"),
    ],
  ])(
    "%s is refused with check's message, and nothing is written",
    async (_, edit) => {
      const { dir, deps, path } = await week10();
      const broken = edit(await readFile(path, "utf8"));
      await writeFile(path, broken);
      const files = await readdir(dirname(path));
      const checked = await check(dir, deps).then(
        () => undefined,
        (e: Error) => e.message,
      );
      expect(checked).toBeDefined();

      await expect(statsTable(dir)).rejects.toThrow(checked);
      expect(await readFile(path, "utf8")).toBe(broken);
      expect(await readdir(dirname(path))).toEqual(files);
    },
  );

  test("a draft that lets in the in-progress week counts scored weeks only", async () => {
    const plain = await midWeek8();
    await draft(plain.dir, plain.deps);
    const withIt = await midWeek8();
    await draft(withIt.dir, withIt.deps, { includeInProgress: true });

    const table = await statsTable(withIt.dir);

    expect(table.week).toBe(7);
    expect(table.dataWeek).toBe(7);
    const stats = (t: StatsTable) =>
      new Map(t.rows.map(({ place: _, start: __, ...row }) => [row.team, row]));
    expect(stats(table)).toEqual(stats(await statsTable(plain.dir)));
    // Bench Mob through week 7: 6-1, with week 8's 126.89 left out of form.
    expect(stats(table).get("sleeper:3")).toMatchObject({
      record: "6-1",
      form: 133.65, // (122.74 + 162.9 + 115.32) / 3
    });
  });
});

const TABLE: StatsTable = {
  week: 10,
  dataWeek: 10,
  method: "ramped blend",
  rows: [
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
    },
    { place: 3, start: 3, team: "sleeper:9", name: "Hail Mary Hustle" },
  ],
};

describe("the Stats table as terminal text", () => {
  test("is the header, the column headings, then a line per row", () => {
    expect(renderStatsTable(TABLE, { bold: false })).toBe(
      [
        "Week 10 draft · data through week 10 · method: ramped blend",
        "",
        "#  Start  Team                                         Record  Rank     PPG  All-play    Form   Luck  Streak",
        "1      2  Bench Mob                                    9-1     1st   123.99  80-30     128.00   1.36  W9",
        "2      1  The Extremely Long Team Name Of Bye Bye Bea  7-3     2nd   125.40  79-31     133.20  -0.05  L1",
        "3      3  Hail Mary Hustle                             —       —          —  —              —      —  —",
        "",
      ].join("\n"),
    );
  });

  test("cuts a long team name with … so each row fits the width", () => {
    const lines = renderStatsTable(TABLE, { bold: false, width: 80 }).split(
      "\n",
    );

    for (const line of lines.slice(2)) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
    expect(lines[3]).toBe(
      "1      2  Bench Mob        9-1     1st   123.99  80-30     128.00   1.36  W9",
    );
    expect(lines[4]).toBe(
      "2      1  The Extremely …  7-3     2nd   125.40  79-31     133.20  -0.05  L1",
    );
  });

  test("bolds the header alone", () => {
    const [header, ...rest] = renderStatsTable(TABLE, { bold: true }).split(
      "\n",
    );

    expect(header).toBe(
      "\x1b[1mWeek 10 draft · data through week 10 · method: ramped blend\x1b[22m",
    );
    expect(rest.join("\n")).not.toContain("\x1b");
  });

  test.each([
    [
      "a terminal",
      { isTTY: true, columns: 100 },
      {},
      { width: 100, bold: true },
    ],
    [
      "a terminal under NO_COLOR",
      { isTTY: true, columns: 100 },
      { noColor: true as const },
      { width: 100, bold: false },
    ],
    ["output that isn't a terminal", { isTTY: false }, {}, { bold: false }],
  ])("on %s, the table's look follows", (_, out, env, look) => {
    expect(statsTableLook(out, { nodeVersion: "v24.0.0", ...env })).toEqual(
      look,
    );
  });
});
