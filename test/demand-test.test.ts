import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { draft, publish, stats } from "../src/index.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  atWeek,
  committed,
  fearTheTurtle,
  fixedClock,
  published,
  rankingsDir,
  withoutPublishRecord,
} from "./support/workspace.ts";

/**
 * The draft's text with its first team section moved to third place, so the
 * first three teams of the starting order are moved: 2 places, then 1 and 1.
 */
function firstToThird(text: string): string {
  const [head, ...teams] = text.split(/(?=^## .*\{team=)/m);
  const [a, b, c, ...rest] = teams;
  if (!head || !a || !b || !c) throw new Error("fewer than 3 teams");
  return [head, b, c, a, ...rest].join("");
}

/** The draft's text with a wrong record claim added to its first team's blurb. */
function withWrongRecord(text: string): string {
  return text.replace(
    /(^## .*\{team=[^}]+\}\n[^\n]*)/m,
    "$1 Perfect at [12-0]{ev=record}.",
  );
}

describe("stats", () => {
  test("a week drafted without an LLM: minutes to publish, moved teams, LLM unused and blurb problems", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    await writeFile(
      path,
      withWrongRecord(firstToThird(await readFile(path, "utf8"))),
    );
    await publish(
      dir,
      { ...deps, clock: fixedClock("2025-10-28T15:42:00.000Z") },
      { yes: true },
    );

    const summary = await stats(dir);

    expect(summary.weeks).toEqual([
      {
        season: 2025,
        week: 8,
        minutesToPublish: 42,
        movedTeams: 3,
        placesMoved: 4,
        llmUsed: false,
        blurbProblems: { hard: 1, soft: 0 },
      },
    ]);
  });

  test("a week the LLM drafted: the share of its words the frozen copy keeps, in order and section", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    deps.llm = scriptedLlm(await plainReply({ leaveOut: SECOND_TEAM }));
    deps.env.anthropicApiKey = KEY;
    const { path } = await draft(dir, deps);
    // 6 intro words and 11 blurbs of 5 (the left-out team keeps its stat
    // line): 61 LLM words. The intro keeps 3, the first team's blurb none.
    const text = (await readFile(path, "utf8"))
      .replace("What a week for everyone here.", "What a week.")
      .replace(
        `{team=${FIRST_TEAM}}\nSteady as ever this week.`,
        `{team=${FIRST_TEAM}}\nMine now.`,
      );
    await writeFile(path, text);
    await publish(dir, {
      ...deps,
      clock: fixedClock("2025-10-28T15:30:00.000Z"),
    });

    const summary = await stats(dir);

    expect(summary.weeks).toEqual([
      expect.objectContaining({
        minutesToPublish: 30,
        llmUsed: true,
        llmTextKept: 53 / 61,
      }),
    ]);
  });
});

describe("stats: a week drafted again", () => {
  /** Week 8 drafted by the LLM, then the draft deleted. */
  async function llmDraftDeleted() {
    const ws = await fearTheTurtle(8);
    ws.deps.llm = scriptedLlm(await plainReply({ leaveOut: SECOND_TEAM }));
    ws.deps.env.anthropicApiKey = KEY;
    const { path } = await draft(ws.dir, ws.deps);
    await rm(path);
    return { ...ws, path };
  }

  test("drafted again without the LLM, at the same second, it reports the LLM unused", async () => {
    const { dir, deps } = await llmDraftDeleted();
    delete deps.env.anthropicApiKey;
    await draft(dir, deps);
    await publish(dir, deps);

    expect((await stats(dir)).weeks).toEqual([
      expect.objectContaining({ llmUsed: false }),
    ]);
  });

  test("an LLM prose file from a later draft isn't measured against the frozen copy of an earlier one", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    deps.llm = scriptedLlm(
      await plainReply({ leaveOut: SECOND_TEAM }),
      await plainReply({ leaveOut: FIRST_TEAM }),
    );
    deps.env.anthropicApiKey = KEY;
    const { path } = await draft(dir, deps);
    await publish(dir, deps);
    await rm(path);
    await draft(dir, {
      ...deps,
      clock: fixedClock("2025-10-28T16:00:00.000Z"),
    });

    expect((await stats(dir)).weeks).toEqual([
      expect.objectContaining({ llmUsed: false }),
    ]);
  });
});

describe("stats: files it can't use", () => {
  test("a draft deleted after publishing and drafted again is timed from the new draft's start", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    await publish(dir, {
      ...deps,
      clock: fixedClock("2025-10-28T15:10:00.000Z"),
    });
    await rm(path);
    await draft(dir, {
      ...deps,
      clock: fixedClock("2025-10-29T09:00:00.000Z"),
    });
    await publish(dir, {
      ...deps,
      clock: fixedClock("2025-10-29T09:25:00.000Z"),
    });

    expect((await stats(dir)).weeks).toEqual([
      expect.objectContaining({ minutesToPublish: 25 }),
    ]);
  });

  test("an unreadable file is named, and a broken draft doesn't stop the summary", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    deps.llm = scriptedLlm(await plainReply({ leaveOut: SECOND_TEAM }));
    deps.env.anthropicApiKey = KEY;
    const { path } = await draft(dir, deps);
    await published(dir, deps);
    await writeFile(path, "no front matter\n");
    await writeFile(
      join(rankingsDir(dir), "week-08.llm.md"),
      "---\nformat: 1\n---\n",
    );

    expect((await stats(dir)).text).toBe(
      [
        "Lazy Pundit demand-test summary: 1 published ranking week",
        "2025 week 8: 0 min to publish · no teams moved · LLM unused · 0 hard and 0 soft blurb problems",
        "Median: 0 min to publish · no teams moved · LLM used in 0 of 1 week · 0 hard and 0 soft blurb problems",
        "Couldn't read 2025/week-08.llm.md: ✖ Invalid input: expected number, received undefined\n  → at season\n✖ Invalid input: expected number, received undefined\n  → at week\n✖ Invalid input: expected string, received undefined\n  → at created_at",
      ].join("\n"),
    );
  });
});

describe("stats: the pasteable summary", () => {
  test("a line per published week, then the medians, with a republish timed from the first publish", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const at = (iso: string) => ({ ...deps, clock: fixedClock(iso) });
    // Week 8: the LLM's draft, the intro cut and one blurb rewritten.
    deps.llm = scriptedLlm(await plainReply({ leaveOut: SECOND_TEAM }));
    deps.env.anthropicApiKey = KEY;
    const week8 = await draft(dir, deps);
    await writeFile(
      week8.path,
      (await readFile(week8.path, "utf8"))
        .replace("What a week for everyone here.", "What a week.")
        .replace(
          `{team=${FIRST_TEAM}}\nSteady as ever this week.`,
          `{team=${FIRST_TEAM}}\nMine now.`,
        ),
    );
    await publish(dir, at("2025-10-28T15:30:00.000Z"));
    delete deps.env.anthropicApiKey;
    // Week 9: stat lines, three teams moved and a wrong claim.
    const week9 = await draft(dir, atWeek(at("2025-11-04T15:00:00.000Z"), 9));
    await writeFile(
      week9.path,
      withWrongRecord(firstToThird(await readFile(week9.path, "utf8"))),
    );
    await publish(dir, atWeek(at("2025-11-04T15:50:00.000Z"), 9), {
      yes: true,
    });
    // Week 10: published as drafted, then again an hour later.
    await draft(dir, atWeek(at("2025-11-11T15:00:00.000Z"), 10));
    await publish(dir, atWeek(at("2025-11-11T15:20:00.000Z"), 10));
    await publish(dir, atWeek(at("2025-11-11T16:20:00.000Z"), 10));

    const summary = await stats(dir);

    expect(summary.text).toBe(
      [
        "Lazy Pundit demand-test summary: 3 published ranking weeks",
        "2025 week 8: 30 min to publish · no teams moved · LLM used, 87% of its text kept · 0 hard and 0 soft blurb problems",
        "2025 week 9: 50 min to publish · 3 teams moved, 4 places in all · LLM unused · 1 hard and 0 soft blurb problems",
        "2025 week 10: 20 min to publish · no teams moved · LLM unused · 0 hard and 0 soft blurb problems",
        "Median: 30 min to publish · no teams moved · LLM used in 1 of 3 weeks, 87% of its text kept · 0 hard and 0 soft blurb problems",
      ].join("\n"),
    );
  });

  test("a frozen copy from before the publish record says what wasn't recorded", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    await draft(dir, deps);
    const { publishedPath } = await published(dir, deps);
    await writeFile(
      publishedPath,
      withoutPublishRecord(await readFile(publishedPath, "utf8")),
    );

    expect((await stats(dir)).text).toBe(
      [
        "Lazy Pundit demand-test summary: 1 published ranking week",
        "2025 week 8: minutes to publish not recorded · no teams moved · LLM unused · blurb problems not recorded",
        "Median: minutes to publish not recorded · no teams moved · LLM used in 0 of 1 week · blurb problems not recorded",
      ].join("\n"),
    );
  });

  test("with nothing published, it says so", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    await draft(dir, deps);

    expect((await stats(dir)).text).toBe(
      "Lazy Pundit demand-test summary: no published ranking weeks yet",
    );
  });
});

const KEY = "sk-ant-api03-test-key";
const FIRST_TEAM = "sleeper:1";
const SECOND_TEAM = "sleeper:2";

/**
 * A reply with claim-free prose, so every section passes the LLM gate: a
 * 6-word intro and a 5-word blurb for every team but `leaveOut`.
 */
async function plainReply({ leaveOut }: { leaveOut: string }): Promise<string> {
  const { teams } = await committed(8);
  return [
    "## {intro}\nWhat a week for everyone here.",
    ...teams
      .filter((t) => t.id !== leaveOut)
      .map((t) => `## {team=${t.id}}\nSteady as ever this week.`),
  ].join("\n\n");
}
