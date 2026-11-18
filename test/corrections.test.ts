import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, type Deps, draft, refresh } from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  atWeek,
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  fixedClock,
  frontMatter,
  highScore,
  patchingTransport,
  published,
  rankingsDir,
  statCorrection,
  withoutReminder,
  writeLeagueFile,
} from "./support/workspace.ts";

const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;

/** Week 7: Red Zone Rascals 111.58, Hail Mary Hustle 101.28. */
const FLIPPED =
  "[Correction from week 7: Hail Mary Hustle beat Red Zone Rascals 116.28–111.58, which Red Zone Rascals won 111.58–101.28]{ev=w7.correction}";

/** Fresh data with a week-7 stat correction: `points` more for roster `rosterId`. */
function week7Corrected(deps: Deps, rosterId = 9, points = 15): Deps {
  return {
    ...deps,
    transport: patchingTransport(deps.transport, {
      [`${LEAGUE}/matchups/7`]: statCorrection(rosterId, points),
    }),
  };
}

/** Fear The Turtle with week 7 drafted and published on the data as it was. */
async function week7Published() {
  const ws = await fearTheTurtle(7);
  await draft(ws.dir, ws.deps);
  await published(ws.dir, ws.deps);
  return ws;
}

/** The intro section's text in a ranking file. */
function introOf(text: string): string {
  return /## Intro \{intro\}\n([\s\S]*?)\n+(?=## )/.exec(text)?.[1] ?? "";
}

describe("a drastic correction", () => {
  test("a week-7 result flipped after week 7 was published opens the week-8 intro, and checks", async () => {
    const ws = await week7Published();

    const result = await draft(ws.dir, week7Corrected(atWeek(ws.deps, 8)));

    const text = await readFile(result.path, "utf8");
    const intro = introOf(text);
    expect(intro.split("\n")[0]).toBe(FLIPPED);
    expect(intro).toContain("Week high:");
    expect(withoutReminder(result.problems)).toEqual([]);
    const checked = await check(ws.dir);
    expect(withoutReminder(checked.problems)).toEqual([]);
  });

  test("a correction refresh finds, which the draft doesn't carry, is a league item naming the line to add", async () => {
    const ws = await week7Published();
    await draft(ws.dir, atWeek(ws.deps, 8));

    const result = await refresh(ws.dir, week7Corrected(atWeek(ws.deps, 8)));

    expect(
      result.problems.filter((p) => p.kind === "correction-missing"),
    ).toEqual([
      {
        severity: "soft",
        team: null,
        section: "League",
        line: null,
        text: "",
        kind: "correction-missing",
        reason: `week 7 has a drastic correction the draft doesn't carry, so the league won't hear of it: put ${FLIPPED} at the top of the intro`,
      },
    ]);
    const path = join(rankingsDir(ws.dir), "week-08.md");
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace("## Intro {intro}\n", `## Intro {intro}\n${FLIPPED}\n`),
    );
    const checked = await check(ws.dir);
    expect(checked.problems.map((p) => p.kind)).not.toContain(
      "correction-missing",
    );
  });

  test("a correction that reverts after the draft is a wrong line to delete", async () => {
    const ws = await week7Published();
    const result = await draft(ws.dir, week7Corrected(atWeek(ws.deps, 8)));

    const refreshed = await refresh(ws.dir, atWeek(ws.deps, 8));

    expect(
      refreshed.problems
        .filter((p) => p.section === "Intro")
        .map((p) => [p.severity, p.kind, p.text, p.reason]),
    ).toEqual([
      [
        "hard",
        "wrong",
        FLIPPED.replace(/^\[|\]\{ev=w7\.correction\}$/g, ""),
        "no drastic correction to week 7 is found now, so this line is out of date: delete it",
      ],
    ]);
    const text = await readFile(result.path, "utf8");
    await writeFile(result.path, text.replace(`${FLIPPED}\n`, ""));
    const checked = await check(ws.dir);
    expect(checked.problems.filter((p) => p.section === "Intro")).toEqual([]);
  });

  test("a win corrected to a tie says so", async () => {
    const ws = await week7Published();

    const result = await draft(
      ws.dir,
      week7Corrected(atWeek(ws.deps, 8), 9, 10.3),
    );

    const intro = introOf(await readFile(result.path, "utf8"));
    expect(intro.split("\n")[0]).toBe(
      "[Correction from week 7: Red Zone Rascals and Hail Mary Hustle tied 111.58–111.58, which Red Zone Rascals won 111.58–101.28]{ev=w7.correction}",
    );
  });

  test("a changed trigger winner is a correction too", async () => {
    const ws = await fearTheTurtle(7);
    await writeLeagueFile(ws.dir, `house-rules:\n${highScore()}`);
    await draft(ws.dir, ws.deps);
    await published(ws.dir, ws.deps);

    // Week 7's high: Bye Bye Bea 165.84. Tank Brigade, 132.96, already won.
    const result = await draft(
      ws.dir,
      week7Corrected(atWeek(ws.deps, 8), 10, 40),
    );

    const intro = introOf(await readFile(result.path, "utf8"));
    expect(intro.split("\n")[0]).toBe(
      "[Correction from week 7: Weekly high score went to Tank Brigade, not Bye Bye Bea]{ev=w7.correction}",
    );
    expect(withoutReminder(result.problems)).toEqual([]);
  });

  test("with the intro off, the correction line stands alone above the teams", async () => {
    const ws = await week7Published();
    await writePersona(
      ws.dir,
      "---\nformat: 1\npreset: broadcast\nintro: off\n---\n",
    );

    const result = await draft(ws.dir, week7Corrected(atWeek(ws.deps, 8)));

    expect(introOf(await readFile(result.path, "utf8"))).toBe(FLIPPED);
  });

  test("the LLM's intro follows the correction line, and the LLM is told not to repeat it", async () => {
    const ws = await week7Published();
    const llm = scriptedLlm("## {intro}\nWhat a week.");
    const deps = { ...week7Corrected(atWeek(ws.deps, 8)), llm };
    deps.env.anthropicApiKey = "sk-ant-api03-test-key";

    const result = await draft(ws.dir, deps);

    expect(introOf(await readFile(result.path, "utf8"))).toBe(
      `${FLIPPED}\nWhat a week.`,
    );
    const prompt = llm.requests[0]?.prompt ?? "";
    expect(prompt).toContain(
      "w7.correction: Hail Mary Hustle beat Red Zone Rascals 116.28–111.58, which Red Zone Rascals won 111.58–101.28",
    );
    expect(prompt).toContain("## Corrections");
  });

  test("a draft with no correction gives the LLM no corrections part", async () => {
    const ws = await week7Published();
    const llm = scriptedLlm("## {intro}\nWhat a week.");
    const deps = { ...atWeek(ws.deps, 8), llm };
    deps.env.anthropicApiKey = "sk-ant-api03-test-key";

    const result = await draft(ws.dir, deps);

    expect(introOf(await readFile(result.path, "utf8"))).toBe("What a week.");
    expect(llm.requests[0]?.prompt).not.toMatch(/correction/i);
  });

  test("stops once a ranking built on the corrected data is published", async () => {
    const ws = await week7Published();
    const corrected = week7Corrected({
      ...atWeek(ws.deps, 8),
      clock: fixedClock("2025-10-29T15:00:00.000Z"),
    });
    await draft(ws.dir, corrected);
    await published(ws.dir, corrected);

    // Week 9's routine fetch keeps week 7 from the corrected week-8 snapshot,
    // the season's last.
    const result = await draft(ws.dir, {
      ...atWeek(ws.deps, 9),
      clock: fixedClock("2025-11-04T15:00:00.000Z"),
    });

    const text = await readFile(result.path, "utf8");
    expect(text).not.toContain("Correction from");
    expect(withoutReminder(result.problems)).toEqual([]);
  });

  test("a published ranking's snapshot that no longer normalizes gives the can't-compare item, and the draft carries on", async () => {
    const ws = await week7Published();
    const id = await publishedSnapshot(ws.dir, 7);
    const manifest = join(ws.dir, ".snapshots", id, "manifest.json");
    const json = JSON.parse(await readFile(manifest, "utf8"));
    json.requests = json.requests.filter(
      (r: { url: string }) => !r.url.endsWith("/rosters"),
    );
    await writeFile(manifest, JSON.stringify(json));

    const result = await draft(ws.dir, week7Corrected(atWeek(ws.deps, 8)));

    expect(withoutReminder(result.problems)).toEqual([
      {
        severity: "soft",
        team: null,
        section: "League",
        line: null,
        text: "",
        kind: "cant-compare",
        reason: expect.stringMatching(
          new RegExp(
            `^can't compare with \`${id}\`, the week 7 ranking's snapshot: this version can't read it \\(Snapshot ${id} has no payload for .*/rosters\\), so a drastic correction to week 7 or earlier won't show$`,
          ),
        ),
      },
    ]);
    expect(await readFile(result.path, "utf8")).not.toContain(
      "Correction from",
    );
  });

  test("a published ranking's snapshot that's damaged gives the can't-compare item", async () => {
    const ws = await week7Published();
    const id = await publishedSnapshot(ws.dir, 7);
    await writeFile(join(ws.dir, ".snapshots", id, "manifest.json"), "{");

    const result = await draft(ws.dir, atWeek(ws.deps, 8));

    expect(withoutReminder(result.problems).map((p) => p.reason)).toEqual([
      `can't compare with \`${id}\`, the week 7 ranking's snapshot: it's damaged in the snapshots folder, so a drastic correction to week 7 or earlier won't show`,
    ]);
  });

  test("a published ranking's snapshot that's gone gives the can't-compare item, in check too", async () => {
    const ws = await week7Published();
    const id = await publishedSnapshot(ws.dir, 7);
    await rm(join(ws.dir, ".snapshots", id), { recursive: true });

    await draft(ws.dir, atWeek(ws.deps, 8));
    const result = await check(ws.dir);

    expect(withoutReminder(result.problems).map((p) => p.reason)).toEqual([
      `can't compare with \`${id}\`, the week 7 ranking's snapshot: it's missing from the snapshots folder, so a drastic correction to week 7 or earlier won't show`,
    ]);
  });
});

/** The snapshot a week's frozen copy names. */
async function publishedSnapshot(dir: string, week: number): Promise<string> {
  const path = join(
    rankingsDir(dir),
    `week-${String(week).padStart(2, "0")}.published.md`,
  );
  return frontMatter(await readFile(path, "utf8")).snapshot as string;
}

async function writePersona(dir: string, text: string): Promise<void> {
  await mkdir(join(dir, "pundits", "rikhin"), { recursive: true });
  await writeFile(join(dir, "pundits", "rikhin", "persona.md"), text);
}
