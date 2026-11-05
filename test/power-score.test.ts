import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  check,
  DEFAULT_SETTINGS,
  draft,
  isSmallSample,
  methodForWeek,
  type PowerScoreMethod,
  type Problem,
  powerScores,
  refresh,
  startingOrder,
  WorkspaceFileError,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import {
  committed,
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  frontMatter,
  patchingTransport,
  published,
  statCorrection,
  writeSettings,
} from "./support/workspace.ts";

const sleeper = (order: number[]) => order.map((n) => `sleeper:${n}`);

/**
 * Each method's order, from the power-score prototype's own module run on the
 * committed snapshots (`git show prototype/power-score:…`), not from this code.
 */
const ORDERS: [Exclude<PowerScoreMethod, "ramped-blend">, number, number[]][] =
  [
    ["standings", 8, [3, 11, 8, 4, 12, 1, 10, 2, 5, 7, 6, 9]],
    ["ppg", 8, [3, 11, 2, 5, 12, 1, 8, 4, 7, 9, 6, 10]],
    ["all-play", 8, [3, 11, 2, 8, 4, 5, 1, 12, 9, 7, 6, 10]],
    ["form", 8, [3, 11, 2, 12, 5, 10, 4, 7, 1, 8, 9, 6]],
    ["ffwrapped", 8, [3, 11, 8, 2, 4, 12, 1, 5, 10, 7, 6, 9]],
    ["ffmwr", 8, [3, 8, 12, 10, 11, 5, 1, 2, 4, 7, 9, 6]],
    ["standings", 14, [3, 11, 4, 5, 7, 8, 12, 2, 10, 1, 9, 6]],
    ["ppg", 14, [11, 2, 5, 3, 7, 4, 8, 9, 12, 10, 1, 6]],
    ["all-play", 14, [11, 2, 3, 5, 4, 7, 9, 8, 1, 12, 10, 6]],
    ["form", 14, [7, 5, 10, 11, 4, 6, 9, 2, 1, 8, 12, 3]],
    ["ffwrapped", 14, [11, 3, 4, 2, 7, 5, 8, 10, 12, 1, 6, 9]],
    ["ffmwr", 14, [3, 5, 11, 12, 4, 10, 7, 8, 9, 1, 2, 6]],
  ];

describe("each power-score method's starting order", () => {
  test.each(ORDERS)("%s through week %i", async (method, week, order) => {
    const league = await committed(week);
    expect(startingOrder(league, week, { method })).toEqual(sleeper(order));
  });

  test.each([
    [1, [1, 8, 4, 5, 7, 12, 6, 10, 2, 9, 11, 3]],
    [8, [3, 11, 4, 8, 2, 12, 1, 5, 10, 7, 9, 6]],
    [14, [11, 4, 3, 5, 7, 2, 8, 12, 10, 1, 9, 6]],
  ])("the default ramped blend through week %i", async (week, order) => {
    const league = await committed(week);
    const used = methodForWeek(DEFAULT_SETTINGS, league, week);
    expect(startingOrder(league, week, used)).toEqual(sleeper(order));
  });
});

describe("the ramped blend's weights", () => {
  test.each([
    ["the first regular-season week", 1, { all_play: 5, form: 3, record: 2 }],
    // 7/13 of the way along a 14-week regular season.
    ["between", 8, { all_play: 3.92, form: 3, record: 4.69 }],
    ["the last regular-season week", 14, { all_play: 3, form: 3, record: 7 }],
    [
      "a playoff week, held at the last",
      16,
      { all_play: 3, form: 3, record: 7 },
    ],
    [
      "before any week is scored, held at the first",
      0,
      { all_play: 5, form: 3, record: 2 },
    ],
  ])("at %s (week %i)", async (_at, week, weights) => {
    const league = await committed(8);
    expect(methodForWeek(DEFAULT_SETTINGS, league, week)).toEqual({
      method: "ramped-blend",
      weights,
    });
  });

  test("a method with no weights records none", async () => {
    const league = await committed(8);
    expect(
      methodForWeek({ ...DEFAULT_SETTINGS, method: "form" }, league, 8),
    ).toEqual({ method: "form" });
  });
});

describe("ties", () => {
  // Week 0 has no results, so every team's score is level under every method.
  test.each([
    "standings",
    "ppg",
    "all-play",
    "form",
    "ffwrapped",
    "ffmwr",
    "ramped-blend",
  ] as const)("%s falls back on the standings' order", async (method) => {
    const league = await committed(8);
    const weights = { all_play: 5, form: 3, record: 2 };
    const used = method === "ramped-blend" ? { method, weights } : { method };
    // By team ID, as the standings leave level teams.
    expect(startingOrder(league, 0, used)).toEqual(
      sleeper([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    );
  });

  test("a level score goes to the team with more points for", async () => {
    // Weeks 1-8 form is unique, so level the top two by hand-picked weights:
    // record alone leaves 5-3 teams sleeper:8 (875.85) and sleeper:4 (866.11) level.
    const league = await committed(8);
    const used = {
      method: "ramped-blend" as const,
      weights: { all_play: 0, form: 0, record: 1 },
    };
    const scores = powerScores(league, 8, used);
    expect(scores.get("sleeper:8")).toBe(scores.get("sleeper:4"));
    const order = startingOrder(league, 8, used);
    expect(order.indexOf("sleeper:8")).toBeLessThan(order.indexOf("sleeper:4"));
  });

  test("a blend level but for float noise still goes to points for", async () => {
    // At 1/1/1 through week 8, Gus Bus (876.16) and Baron Von Trade (891.03)
    // have the same percentile total: 13/33 each, however the sum is ordered.
    const league = await committed(8);
    const used = {
      method: "ramped-blend" as const,
      weights: { all_play: 1, form: 1, record: 1 },
    };
    const scores = powerScores(league, 8, used);
    expect(scores.get("sleeper:1")).toBe(scores.get("sleeper:5"));
    const order = startingOrder(league, 8, used);
    expect(order.indexOf("sleeper:5")).toBeLessThan(order.indexOf("sleeper:1"));
  });
});

describe("the pundit settings and a draft", () => {
  test("with no settings file, a draft uses and records the ramped blend", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    const fm = frontMatter(await readFile(path, "utf8"));
    expect(fm.power_score).toEqual({
      method: "ramped-blend",
      weights: { all_play: 3.92, form: 3, record: 4.69 },
    });
    expect(fm.starting_order).toEqual(
      sleeper([3, 11, 4, 8, 2, 12, 1, 5, 10, 7, 9, 6]),
    );
  });

  test("changing the settings file changes the next draft's order and record", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    await writeSettings(dir, "method: form");
    const { path } = await draft(dir, deps);
    const fm = frontMatter(await readFile(path, "utf8"));
    expect(fm.power_score).toEqual({ method: "form" });
    expect(fm.starting_order).toEqual(
      sleeper([3, 11, 2, 12, 5, 10, 4, 7, 1, 8, 9, 6]),
    );
  });

  test("tuned weights drive the blend, and the same weights at both ends don't ramp", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const flat = "{all_play: 0, form: 0, record: 1}";
    await writeSettings(
      dir,
      `method: ramped-blend\nweights:\n  first_week: ${flat}\n  last_week: ${flat}`,
    );
    const { path } = await draft(dir, deps);
    const fm = frontMatter(await readFile(path, "utf8"));
    expect(fm.power_score).toEqual({
      method: "ramped-blend",
      weights: { all_play: 0, form: 0, record: 1 },
    });
    // Record alone is the standings, whose order the prototype gave above.
    expect(fm.starting_order).toEqual(
      sleeper([3, 11, 8, 4, 12, 1, 10, 2, 5, 7, 6, 9]),
    );
  });

  test.each([
    ["an unknown method", "method: vibes"],
    ["an unknown key", "methd: form"],
    [
      "weights too small to survive being worked out for a week",
      "weights:\n  first_week: {all_play: 0.001, form: 0, record: 0}\n  last_week: {all_play: 0.001, form: 0, record: 0}",
    ],
    [
      "weights that are all zero",
      "weights:\n  first_week: {all_play: 0, form: 0, record: 0}\n  last_week: {all_play: 3, form: 3, record: 7}",
    ],
    [
      "one end of the ramp missing",
      "weights:\n  first_week: {all_play: 1, form: 1, record: 1}",
    ],
  ])("%s stops the draft before any fetch", async (_what, text) => {
    const { dir, deps } = await fearTheTurtle(8);
    await writeSettings(dir, text);
    await expect(draft(dir, deps)).rejects.toThrow(WorkspaceFileError);
    await expect(readdir(join(dir, ".snapshots"))).rejects.toThrow();
  });
});

describe("refresh and a changed method", () => {
  async function drafted() {
    const ws = await fearTheTurtle(8);
    const { path } = await draft(ws.dir, ws.deps);
    return { ...ws, path, read: () => readFile(path, "utf8") };
  }
  const body = (text: string) => text.slice(text.indexOf("\n---\n"));

  test("with no data change it recomputes the order and record, and nothing else", async () => {
    const { dir, deps, read } = await drafted();
    const before = await read();
    const snapshot = frontMatter(before).snapshot;
    const snapshots = await readdir(join(dir, ".snapshots"));
    await writeSettings(dir, "method: form");

    const result = await refresh(dir, deps);

    const after = await read();
    const fm = frontMatter(after);
    expect(result.methodChanged).toBe(true);
    expect(result.changes).toEqual([]);
    expect(fm.power_score).toEqual({ method: "form" });
    expect(fm.starting_order).toEqual(
      sleeper([3, 11, 2, 12, 5, 10, 4, 7, 1, 8, 9, 6]),
    );
    expect(fm.snapshot).toBe(snapshot);
    expect(fm.data_as_of).toBe(frontMatter(before).data_as_of);
    expect(fm.earlier_snapshots).toBeUndefined();
    expect(body(after)).toBe(body(before));
    expect(await readdir(join(dir, ".snapshots"))).toEqual(snapshots);
    expect(result.newlyStale).toEqual([]);
  });

  test("the moved teams are measured against the new order", async () => {
    const { dir, deps } = await drafted();
    await writeSettings(dir, "method: form");

    const { problems } = await refresh(dir, deps);

    // Drafted on the blend, Frank's FAAB Fund (sleeper:4) stands 3rd in the
    // file; form has them 7th.
    const moved = problems.find(
      (p) => p.kind === "moved" && p.team === "sleeper:4",
    );
    expect(moved?.reason).toMatch(/7/);
  });

  test("with the settings as drafted it only moves checked_at", async () => {
    const { dir, deps, read } = await drafted();
    const before = frontMatter(await read());

    const result = await refresh(dir, deps);

    const after = frontMatter(await read());
    expect(result.methodChanged).toBe(false);
    expect({ ...after, checked_at: "" }).toEqual({ ...before, checked_at: "" });
  });

  test("a data change and a changed method land together, on the new data", async () => {
    const { dir, deps, read } = await drafted();
    await writeSettings(dir, "method: standings");
    const transport = patchingTransport(deps.transport, {
      [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}/matchups/8`]:
        statCorrection(3, -10),
    });

    const result = await refresh(dir, { ...deps, transport });

    const fm = frontMatter(await read());
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.methodChanged).toBe(true);
    expect(fm.power_score).toEqual({ method: "standings" });
    // Bench Mob flipped to 6-2 on 972.81, behind Bye Bye Bea's 6-2 on 976.25.
    expect((fm.starting_order as string[]).slice(0, 2)).toEqual(
      sleeper([11, 3]),
    );
  });

  test("a bad settings file stops the refresh with the draft untouched", async () => {
    const { dir, deps, read } = await drafted();
    const before = await read();
    await writeSettings(dir, "method: vibes");

    await expect(refresh(dir, deps)).rejects.toThrow(WorkspaceFileError);

    expect(await read()).toBe(before);
  });
});

describe("the small-sample flag", () => {
  const flags = (problems: Problem[]) =>
    problems.filter((p) => p.kind === "small-sample");

  test.each([
    [0, false],
    [1, true],
    [4, true],
    [5, false],
  ])("week %i is a small sample: %s", (week, small) => {
    expect(isSmallSample(week)).toBe(small);
  });

  test("a week-1 draft carries it, as a soft league item", async () => {
    const { dir, deps } = await fearTheTurtle(1);
    const { problems } = await draft(dir, deps);
    expect(flags(problems)).toEqual([
      expect.objectContaining({
        severity: "soft",
        team: null,
        section: "League",
        line: null,
      }),
    ]);
  });

  test("a week-8 draft doesn't", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { problems } = await draft(dir, deps);
    expect(flags(problems)).toEqual([]);
  });

  test("check lists it too, and refresh", async () => {
    const { dir, deps } = await fearTheTurtle(1);
    await draft(dir, deps);
    expect(flags((await check(dir, deps)).problems)).toHaveLength(1);
    expect(flags((await refresh(dir, deps)).problems)).toHaveLength(1);
  });

  test("it never reaches the published outputs, and asks nothing at publish", async () => {
    const { dir, deps, clipboard } = await fearTheTurtle(1);
    const { path } = await draft(dir, deps);
    const flag = flags((await check(dir, deps)).problems)[0];

    const result = await published(dir, deps);

    const frozen = await readFile(
      path.replace(/\.md$/, ".published.md"),
      "utf8",
    );
    for (const output of [result.text, frozen, clipboard.copied.at(-1)]) {
      expect(output).toBeDefined();
      expect(output).not.toContain(flag?.reason);
      expect(output).not.toMatch(/small.sample/i);
    }
  });
});
