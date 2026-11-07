import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { check, type Deps, draft, refresh } from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import {
  FEAR_THE_TURTLE_ID,
  frontMatter,
  type Json,
  onStandings,
  patchingTransport,
  statCorrection,
} from "./support/workspace.ts";

const GUS = "## Gus Bus {team=sleeper:1}\n";

/** Week 8 as Sleeper showed it before scoring finished: week 7 is the last scored. */
async function midWeek8() {
  const ws = await onStandings(8);
  ws.deps.transport = patchingTransport(ws.deps.transport, {
    [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`]: (league: Json) => {
      league.settings.last_scored_leg = 7;
    },
  });
  return ws;
}

/** Adds `words` to Gus Bus's blurb, as the pundit would. */
async function addToGus(path: string, words: string) {
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replace(GUS, `${GUS}${words}\n`));
}

const WARNING =
  "week 8 is in progress, so this is a week 7 draft without it; `--include-in-progress` adds it as provisional";

describe("drafting while a week is in progress", () => {
  test("warns and builds through the last scored week", async () => {
    const { dir, deps } = await midWeek8();

    const result = await draft(dir, deps);

    expect(result.week).toBe(7);
    expect(result.warnings).toContain(WARNING);
    const fm = frontMatter(await readFile(result.path, "utf8"));
    expect(fm.week).toBe(7);
    expect(fm).not.toHaveProperty("in_progress_week");
  });

  test("with no week in progress, says nothing about it", async () => {
    const { dir, deps } = await onStandings(8);

    const result = await draft(dir, deps);

    expect(result.warnings.join("\n")).not.toContain("in progress");
  });

  test("without --include-in-progress, the week's stats are no evidence", async () => {
    const { dir, deps } = await midWeek8();
    const { path } = await draft(dir, deps);
    await addToGus(path, "They have [133.22]{ev=w8.points} so far.");

    const { problems } = await check(dir, deps);

    expect(problems).toContainEqual(
      expect.objectContaining({ kind: "unknown-id", id: "w8.points" }),
    );
  });
});

describe("--include-in-progress", () => {
  test("records the week and keeps the draft's week the last scored one", async () => {
    const { dir, deps } = await midWeek8();

    const result = await draft(dir, deps, { includeInProgress: true });

    expect(result.week).toBe(7);
    const fm = frontMatter(await readFile(result.path, "utf8"));
    expect(fm).toMatchObject({ week: 7, in_progress_week: 8 });
    expect(result.warnings).toContain(
      "week 8 is in progress: its stats are in this week 7 draft, and every claim citing them is provisional",
    );
  });

  test("stat lines stay on the ranking week, so a fresh draft has no provisional claim", async () => {
    const plain = await midWeek8();
    const withWeek = await midWeek8();
    const body = async (path: string) =>
      (await readFile(path, "utf8")).replace(/^---[\s\S]*?\n---\n/, "");

    const without = await draft(plain.dir, plain.deps);
    const result = await draft(withWeek.dir, withWeek.deps, {
      includeInProgress: true,
    });

    expect(await body(result.path)).toBe(await body(without.path));
    expect(result.problems.filter((p) => p.kind === "provisional")).toEqual([]);
  });

  test("marks a claim that agrees with the week's stats provisional, and one that doesn't wrong", async () => {
    const { dir, deps } = await midWeek8();
    const { path } = await draft(dir, deps, { includeInProgress: true });
    await addToGus(
      path,
      "They have [133.22]{ev=w8.points} so far, up by [50]{ev=w8.margin}.",
    );

    const { problems } = await check(dir, deps);

    expect(problems).toContainEqual({
      severity: "soft",
      team: "sleeper:1",
      section: "Gus Bus",
      line: expect.any(Number),
      text: "133.22",
      kind: "provisional",
      reason:
        "week 8 is still in progress, so this can change once it's scored",
      id: "w8.points",
    });
    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: "hard",
        kind: "wrong",
        id: "w8.margin",
      }),
    );
  });

  test("refresh compares the in-progress week, so a claim it changes goes stale", async () => {
    const { dir, deps } = await midWeek8();
    const { path } = await draft(dir, deps, { includeInProgress: true });
    await addToGus(path, "They have [133.22]{ev=w8.points} so far.");
    const moreScoring: Deps = {
      ...deps,
      transport: patchingTransport(deps.transport, {
        [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}/matchups/8`]:
          statCorrection(1, 1.8),
      }),
    };

    const result = await refresh(dir, moreScoring);

    expect(result.changes).not.toEqual([]);
    expect(result.newlyStale).toContainEqual(
      expect.objectContaining({ text: "133.22", kind: "stale" }),
    );
    const fm = frontMatter(await readFile(path, "utf8"));
    expect(fm).toMatchObject({ week: 7, in_progress_week: 8 });
  });

  test("once the week is scored, refresh keeps its claims, no longer provisional, and says to start its draft", async () => {
    const { dir, deps } = await midWeek8();
    const { path } = await draft(dir, deps, { includeInProgress: true });
    await addToGus(path, "They have [133.22]{ev=w8.points} so far.");
    const scored = await onStandings(8);

    const result = await refresh(dir, scored.deps);

    expect(result.scoredWeek).toBe(8);
    expect(result.newlyStale).toEqual([]);
    expect(result.problems.filter((p) => p.text === "133.22")).toEqual([]);
  });

  test("with no week in progress, records nothing", async () => {
    const { dir, deps } = await onStandings(8);

    const result = await draft(dir, deps, { includeInProgress: true });

    const fm = frontMatter(await readFile(result.path, "utf8"));
    expect(fm).not.toHaveProperty("in_progress_week");
  });
});
