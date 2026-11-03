import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { check, type Deps, draft, publish } from "../src/index.ts";
import { atWeek, fearTheTurtle, rankingsDir } from "./support/workspace.ts";

/** Publishes and expects it to go through. */
async function published(dir: string, deps: Deps) {
  const result = await publish(dir, deps);
  if (!result.published) throw new Error("held back to editing");
  return result;
}

/** The YAML front matter of a Markdown file. */
function frontMatter(text: string): Record<string, unknown> {
  return parse(text.split("---\n")[1] ?? "");
}

/** Each team's line in the plain text: "N. Name · record (movement)". */
function teamLines(text: string): string[] {
  return text.split("\n").filter((l) => /^\d+\. /.test(l));
}

/** Moves the section headed `heading` to just before `before`'s heading. */
function moveSection(text: string, heading: string, before: string): string {
  const start = text.indexOf(`## ${heading} {`);
  const end = text.indexOf("\n## ", start + 1) + 1 || text.length;
  const section = text.slice(start, end);
  const rest = text.slice(0, start) + text.slice(end);
  const at = rest.indexOf(`## ${before} {`);
  return rest.slice(0, at) + section + rest.slice(at);
}

/** A workspace with week 7 published as drafted, then week 8 drafted. */
async function week8AfterWeek7() {
  const ws = await fearTheTurtle(7);
  await draft(ws.dir, ws.deps);
  await published(ws.dir, ws.deps);
  const deps = atWeek(ws.deps, 8);
  const { path } = await draft(ws.dir, deps);
  const edit = async (change: (text: string) => string) =>
    writeFile(path, change(await readFile(path, "utf8")));
  const read = () => readFile(path, "utf8");
  return { dir: ws.dir, deps, path, edit, read };
}

describe("movement", () => {
  test("publishing week 8 after week 7 shows each team's movement since week 7", async () => {
    const { dir, deps } = await week8AfterWeek7();

    const { text } = await published(dir, deps);

    // Week 7's order: Bench Mob, Bye Bye Bea, Red Zone Rascals, Snap
    // Judgement, Frank's FAAB Fund, Wendy's Wire, Baron Von Trade, Gus Bus,
    // Pylon Patrol, Tank Brigade, Kim Possible Kicks, Hail Mary Hustle.
    expect(teamLines(text)).toEqual([
      "1. Bench Mob · 7-1 (—)",
      "2. Bye Bye Bea · 6-2 (—)",
      "3. Red Zone Rascals · 5-3 (—)",
      "4. Frank's FAAB Fund · 5-3 (▲1)",
      "5. Snap Judgement · 4-4 (▼1)",
      "6. Gus Bus · 4-4 (▲2)",
      "7. Tank Brigade · 4-4 (▲3)",
      "8. Wendy's Wire · 3-5 (▼2)",
      "9. Baron Von Trade · 3-5 (▼2)",
      "10. Kim Possible Kicks · 3-5 (▲1)",
      "11. Pylon Patrol · 3-5 (▼2)",
      "12. Hail Mary Hustle · 1-7 (—)",
    ]);
    // The baseline is the previous week, so the header doesn't name it.
    expect(text).not.toContain("Movement since");
  });

  test("publishing week 9 with week 8 skipped shows movement since week 7", async () => {
    const ws = await fearTheTurtle(7);
    await draft(ws.dir, ws.deps);
    await published(ws.dir, ws.deps);
    const deps = atWeek(ws.deps, 9);
    await draft(ws.dir, deps);

    const { text } = await published(ws.dir, deps);

    expect(text).toMatch(
      /^🏈 FEAR THE TURTLE POWER RANKINGS\nafter Week 9 · by rikhin\nMovement since week 7\n\n/,
    );
    expect(teamLines(text).slice(3, 8)).toEqual([
      "4. Frank's FAAB Fund · 6-3 (▲1)",
      "5. Tank Brigade · 5-4 (▲5)",
      "6. Snap Judgement · 4-5 (▼2)",
      "7. Gus Bus · 4-5 (▲1)",
      "8. Kim Possible Kicks · 4-5 (▲3)",
    ]);
  });

  test("with no earlier published ranking every team is new, and a numeric movement claim is wrong", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace(GUS, `${GUS}They climb 2 spots. Gus Bus is new here.\n`),
    );

    const result = await publish(dir, deps, { yes: true });

    expect(result.problems).toEqual([
      expect.objectContaining({
        severity: "hard",
        team: "sleeper:1",
        kind: "wrong",
        text: "climb 2 spots",
        reason: "move is new: the team has no earlier place",
      }),
    ]);
    if (!result.published) throw new Error("held back to editing");
    expect(teamLines(result.text)).toContain("6. Gus Bus · 4-4 (new)");
    expect(teamLines(result.text).every((l) => l.endsWith(" (new)"))).toBe(
      true,
    );
    expect(result.text).not.toContain("Movement since");
  });

  test("a movement claim is checked against the baseline, and goes stale when a reorder makes it false", async () => {
    const { dir, deps, edit, read } = await week8AfterWeek7();
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    await edit((t) => t.replace(GUS, `${GUS}Gus Bus climbs 2 spots.\n`));

    expect(await check(dir, deps)).toMatchObject({
      problems: [],
      autoTagged: 1,
    });
    expect(await read()).toContain("Gus Bus [climbs 2 spots]{ev=move}.");

    // Gus Bus drops below Tank Brigade, to 7th: up 1 since week 7, not 2.
    await edit((t) => moveSection(t, "Tank Brigade", "Gus Bus"));
    const { problems } = await check(dir, deps);

    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: "hard",
        team: "sleeper:1",
        kind: "stale",
        cause: "reorder",
        id: "move",
      }),
    );
  });

  test("each team the pundit moved is a soft problem showing its starting place", async () => {
    const { dir, deps, edit, read } = await week8AfterWeek7();
    await edit((t) => moveSection(t, "Tank Brigade", "Gus Bus"));
    const text = await read();

    const { problems } = await check(dir, deps);

    expect(problems).toEqual([
      expect.objectContaining({
        severity: "soft",
        team: "sleeper:10",
        section: "Tank Brigade",
        line: text.split("\n").indexOf("## Tank Brigade {team=sleeper:10}") + 1,
        kind: "moved",
        text: "Tank Brigade",
        reason: "starting place 7, now 6",
      }),
      expect.objectContaining({
        severity: "soft",
        team: "sleeper:1",
        section: "Gus Bus",
        kind: "moved",
        reason: "starting place 6, now 7",
      }),
    ]);
  });

  test("republishing bumps the edition and doesn't move the baseline", async () => {
    const { dir, deps, edit } = await week8AfterWeek7();
    const frozen = join(rankingsDir(dir), "week-08.published.md");
    const first = await published(dir, deps);
    expect(frontMatter(await readFile(frozen, "utf8"))).toMatchObject({
      edition: 1,
    });

    await edit((t) => moveSection(t, "Tank Brigade", "Gus Bus"));
    const again = await published(dir, deps);

    expect(frontMatter(await readFile(frozen, "utf8"))).toMatchObject({
      week: 8,
      edition: 2,
    });
    // Still measured against week 7, not against week 8's first edition.
    expect(teamLines(again.text).slice(5, 7)).toEqual([
      "6. Tank Brigade · 4-4 (▲4)",
      "7. Gus Bus · 4-4 (▲1)",
    ]);
    expect(again.text).not.toContain("Movement since");
    expect(teamLines(first.text)[5]).toBe("6. Gus Bus · 4-4 (▲2)");
  });

  test("the next week measures movement from the republished order", async () => {
    const { dir, deps, edit } = await week8AfterWeek7();
    await published(dir, deps);
    await edit((t) => moveSection(t, "Hail Mary Hustle", "Bench Mob"));
    await published(dir, deps);
    const week9 = atWeek(deps, 9);
    await draft(dir, week9);

    const { text } = await published(dir, week9);

    // Hail Mary Hustle was 1st in week 8's second edition and starts 12th.
    expect(teamLines(text)[11]).toBe("12. Hail Mary Hustle · 1-8 (▼11)");
    expect(text).not.toContain("Movement since");
  });
});
