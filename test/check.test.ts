import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, draft, type Problem, publish } from "../src/index.ts";
import { fearTheTurtle, rankingsDir } from "./support/workspace.ts";

const GUS = "## Gus Bus {team=sleeper:1}\n";

/** Drafts week 8, then lets the test edit the draft as the pundit would. */
async function drafted() {
  const ws = await fearTheTurtle(8);
  const { path } = await draft(ws.dir, ws.deps);
  const edit = async (change: (text: string) => string) =>
    writeFile(path, change(await readFile(path, "utf8")));
  const read = () => readFile(path, "utf8");
  return { ...ws, path, edit, read };
}

/** The 1-based line of the first line containing `needle`. */
function lineOf(text: string, needle: string): number {
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`no ${needle}`);
  return text.slice(0, at).split("\n").length;
}

describe("check", () => {
  test("a new draft checks clean and is left as it is", async () => {
    const { dir, deps, path, read } = await drafted();
    const before = await read();

    const result = await check(dir, deps);

    expect(result).toMatchObject({ week: 8, path, problems: [] });
    expect(await read()).toBe(before);
  });

  test("a pundit edit with a wrong number is a hard problem on its file line, and the file is left as it is", async () => {
    const { dir, deps, edit, read } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They won by 50 this week.\n`));
    const before = await read();

    const { problems } = await check(dir, deps);

    // Gus Bus beat Pylon Patrol 133.22 to 78.22 in week 8: a margin of 55.
    expect(problems).toEqual([
      expect.objectContaining({
        severity: "hard",
        team: "sleeper:1",
        section: "Gus Bus",
        line: lineOf(before, "They won by 50"),
        kind: "wrong",
        text: "50",
        reason: "w8.margin is 55",
      }),
    ]);
    expect(await read()).toBe(before);
  });

  test("a clear untagged claim is auto-tagged in the file, words unchanged", async () => {
    const { dir, deps, edit, read } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They won by 55 this week.\n`));

    const result = await check(dir, deps);

    expect(result.problems).toEqual([]);
    expect(result.autoTagged).toBe(1);
    const text = await read();
    expect(text).toContain(`${GUS}They won by [55]{ev=w8.margin} this week.\n`);

    // Checking again finds the tag already there.
    expect((await check(dir, deps)).autoTagged).toBe(0);
    expect(await read()).toBe(text);
  });

  test("a #3 claim goes stale with cause reorder when the pundit moves the team", async () => {
    const { dir, deps, edit, read } = await drafted();
    // Starting order: Bench Mob, Bye Bye Bea, Red Zone Rascals (#3), ...
    const RASCALS = "## Red Zone Rascals {team=sleeper:8}\n";
    await edit((t) => t.replace(RASCALS, `${RASCALS}Sitting at #3 for now.\n`));
    expect(await check(dir, deps)).toMatchObject({
      problems: [],
      autoTagged: 1,
    });
    expect(await read()).toContain("Sitting at [#3]{ev=place} for now.");

    // Move the Rascals below Frank's FAAB Fund, to 4th.
    await edit((t) => {
      const start = t.indexOf(RASCALS);
      const end = t.indexOf("## Frank's FAAB Fund");
      const section = t.slice(start, end);
      const rest = t.slice(0, start) + t.slice(end);
      const next = rest.indexOf("## Snap Judgement");
      return rest.slice(0, next) + section + rest.slice(next);
    });

    const { problems } = await check(dir, deps);

    expect(problems).toEqual([
      expect.objectContaining({
        severity: "hard",
        team: "sleeper:8",
        kind: "stale",
        cause: "reorder",
        id: "place",
        line: lineOf(await read(), "Sitting at"),
      }),
    ]);
  });
});

/** A confirm that records each question and gives one answer. */
function answering(answer: boolean) {
  const asked: Problem[][] = [];
  return {
    asked,
    confirm: async (hard: Problem[]) => {
      asked.push(hard);
      return answer;
    },
  };
}

describe("publish confirm", () => {
  test("a hard problem asks first, and Back to editing publishes nothing", async () => {
    const { dir, deps, clipboard, edit } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They won by 50 this week.\n`));
    const { asked, confirm } = answering(false);

    const result = await publish(dir, deps, { confirm });

    expect(asked).toEqual([
      [expect.objectContaining({ kind: "wrong", reason: "w8.margin is 55" })],
    ]);
    expect(result).toMatchObject({ published: false, week: 8 });
    expect(result.problems).toEqual(asked[0]);
    const ranking = rankingsDir(dir);
    expect(existsSync(join(ranking, "week-08.published.md"))).toBe(false);
    expect(existsSync(join(ranking, "week-08.txt"))).toBe(false);
    expect(clipboard.copied).toEqual([]);
  });

  test("with no one to ask, a hard problem goes back to editing", async () => {
    const { dir, deps, edit } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They won by 50 this week.\n`));

    const result = await publish(dir, deps);

    expect(result.published).toBe(false);
    expect(existsSync(join(rankingsDir(dir), "week-08.txt"))).toBe(false);
  });

  test("Publish anyway publishes the words as written", async () => {
    const { dir, deps, edit } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They won by 50 this week.\n`));
    const { asked, confirm } = answering(true);

    const result = await publish(dir, deps, { confirm });

    expect(asked).toHaveLength(1);
    expect(result.published).toBe(true);
    expect(
      await readFile(join(rankingsDir(dir), "week-08.txt"), "utf8"),
    ).toContain("6. Gus Bus · 4-4\nThey won by 50 this week.\n6th in points");
  });

  test("--yes publishes without asking", async () => {
    const { dir, deps, edit } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They won by 50 this week.\n`));
    const { asked, confirm } = answering(false);

    const result = await publish(dir, deps, { yes: true, confirm });

    expect(asked).toEqual([]);
    expect(result).toMatchObject({
      published: true,
      problems: [expect.objectContaining({ severity: "hard" })],
    });
  });

  test("a clean draft publishes without asking", async () => {
    const { dir, deps } = await drafted();
    const { asked, confirm } = answering(false);

    const result = await publish(dir, deps, { confirm });

    expect(asked).toEqual([]);
    expect(result).toMatchObject({ published: true, problems: [] });
  });

  test("soft problems are listed without asking", async () => {
    const { dir, deps, edit } = await drafted();
    // Movement isn't measured yet, so movement wording can't be checked.
    await edit((t) => t.replace(GUS, `${GUS}They climb 2 spots.\n`));
    const { asked, confirm } = answering(false);

    const result = await publish(dir, deps, { confirm });

    expect(asked).toEqual([]);
    expect(result).toMatchObject({
      published: true,
      problems: [
        expect.objectContaining({ severity: "soft", team: "sleeper:1" }),
      ],
    });
  });

  test("the published text carries no tags", async () => {
    const { dir, deps, edit } = await drafted();
    await edit((t) =>
      t.replace(
        GUS,
        `${GUS}They won by 55, [a rivalry]{lore=manager:gus} and [a bet]{stakes=side-bets} later.\n`,
      ),
    );

    const result = await publish(dir, deps, { yes: true });

    if (!result.published) throw new Error("not published");
    expect(result.text).toContain(
      "6. Gus Bus · 4-4\nThey won by 55, a rivalry and a bet later.\n",
    );
    expect(result.text).not.toMatch(/[{}]|\]\{|ev=|team=/);
    // The frozen copy keeps the draft as checked, auto-tags included.
    expect(
      await readFile(join(rankingsDir(dir), "week-08.published.md"), "utf8"),
    ).toContain(
      "They won by [55]{ev=w8.margin}, [a rivalry]{lore=manager:gus}",
    );
  });

  test("a tag the tool can't read is a hard problem, not published silently", async () => {
    const { dir, deps, edit, read } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They are [4-4]{ev = record}.\n`));

    const result = await publish(dir, deps);

    expect(result).toMatchObject({
      published: false,
      problems: [
        expect.objectContaining({
          kind: "unreadable-tag",
          text: "[4-4]{ev = record}",
          line: lineOf(await read(), "They are"),
        }),
      ],
    });
  });
});
