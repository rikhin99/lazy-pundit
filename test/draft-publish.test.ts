import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { type Deps, draft, publish, RankingFileError } from "../src/index.ts";
import { fearTheTurtle, rankingsDir } from "./support/workspace.ts";

/** The YAML front matter of a Markdown file. */
function frontMatter(text: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match?.[1]) throw new Error("no front matter");
  return parseYaml(match[1]);
}

describe("draft", () => {
  test("writes the ranking file for the last scored week, in standings order", async () => {
    const { dir, deps } = await fearTheTurtle(8);

    const result = await draft(dir, deps);

    const path = join(rankingsDir(dir), "week-08.md");
    expect(result.path).toBe(path);
    expect(result.week).toBe(8);
    // Every stat line checks out against the evidence pack.
    expect(result.problems).toEqual([]);
    const text = await readFile(path, "utf8");
    const fm = frontMatter(text);
    expect(fm).toMatchObject({
      format: 1,
      season: 2025,
      week: 8,
      pundit: "rikhin",
      data_as_of: "2025-10-28T15:00:00.000Z",
      checked_at: "2025-10-28T15:00:00.000Z",
      created_at: "2025-10-28T15:00:00.000Z",
      snapshot: result.snapshot,
    });
    const order = [3, 11, 8, 4, 12, 1, 10, 2, 5, 7, 6, 9].map(
      (id) => `sleeper:${id}`,
    );
    expect(fm.starting_order).toEqual(order);
    expect(existsSync(join(dir, ".snapshots", result.snapshot))).toBe(true);

    // The league stat line as the intro, then one section per team in the
    // starting order, each with its stat line.
    expect(text).toMatch(/\n---\n\n## Intro \{intro\}\nWeek high: /);
    const headings = [...text.matchAll(/^## (.+) \{team=(sleeper:\d+)\}$/gm)];
    expect(headings.map((h) => h[2])).toEqual(order);
    expect(text).toContain(
      "## Hail Mary Hustle {team=sleeper:9}\n[10th]{ev=pf_rank} in points · [lost 4 straight]{ev=streak} · [lost to]{ev=w8.result} [Tank Brigade]{ev=w8.opponent} by [31.3]{ev=w8.margin}\n",
    );
  });

  test.each([
    [1, "week-01.md"],
    [15, "week-15.md"],
  ])("a week-%i snapshot gives a ranking week of %i", async (week, file) => {
    const { dir, deps } = await fearTheTurtle(week);

    const result = await draft(dir, deps);

    expect(result.week).toBe(week);
    expect(result.path).toBe(join(rankingsDir(dir), file));
    expect(frontMatter(await readFile(result.path, "utf8")).week).toBe(week);
  });

  test("never overwrites an existing draft for the same week", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    await writeFile(path, "my edits");

    await expect(draft(dir, deps)).rejects.toThrow(
      /week-08\.md already exists/,
    );
    expect(await readFile(path, "utf8")).toBe("my edits");
  });
});

const WEEK_8_TEXT = `🏈 FEAR THE TURTLE POWER RANKINGS
after Week 8 · by rikhin

Week high: Gus Bus 133.22 · Week low: Hail Mary Hustle 70.32 · Biggest margin: Gus Bus by 55 · Closest matchup: Bench Mob by 2.71

1. Bench Mob · 7-1 (new)
1st in points · won 7 straight · beat Snap Judgement by 2.71

2. Bye Bye Bea · 6-2 (new)
2nd in points · won 6 straight · beat Baron Von Trade by 19.95

3. Red Zone Rascals · 5-3 (new)
7th in points · lost to Kim Possible Kicks by 6.18

4. Frank's FAAB Fund · 5-3 (new)
8th in points · beat Wendy's Wire by 9.27

5. Snap Judgement · 4-4 (new)
5th in points · lost 2 straight · lost to Bench Mob by 2.71

6. Gus Bus · 4-4 (new)
6th in points · beat Pylon Patrol by 55

7. Tank Brigade · 4-4 (new)
12th in points · won 3 straight · beat Hail Mary Hustle by 31.3

8. Wendy's Wire · 3-5 (new)
3rd in points · lost 2 straight · lost to Frank's FAAB Fund by 9.27

9. Baron Von Trade · 3-5 (new)
4th in points · lost to Bye Bye Bea by 19.95

10. Kim Possible Kicks · 3-5 (new)
9th in points · won 2 straight · beat Red Zone Rascals by 6.18

11. Pylon Patrol · 3-5 (new)
11th in points · lost 3 straight · lost to Gus Bus by 55

12. Hail Mary Hustle · 1-7 (new)
10th in points · lost 4 straight · lost to Tank Brigade by 31.3

Stats: Sleeper · made with Lazy Pundit
`;

/** Publishes and expects it to go through. */
async function published(dir: string, deps: Deps) {
  const result = await publish(dir, deps);
  if (!result.published) throw new Error("held back to editing");
  return result;
}

describe("publish", () => {
  test("freezes the draft and writes and copies the plain text", async () => {
    const { dir, deps, clipboard } = await fearTheTurtle(8);
    const drafted = await draft(dir, deps);

    const result = await published(dir, deps);

    const ranking = rankingsDir(dir);
    expect(result.week).toBe(8);
    expect(result.copied).toBe(true);
    const text = await readFile(join(ranking, "week-08.txt"), "utf8");
    expect(text).toBe(WEEK_8_TEXT);
    expect(clipboard.copied).toEqual([WEEK_8_TEXT]);

    const frozen = await readFile(
      join(ranking, "week-08.published.md"),
      "utf8",
    );
    expect(frontMatter(frozen)).toMatchObject({
      format: 1,
      week: 8,
      snapshot: drafted.snapshot,
      edition: 1,
    });
    // The draft verbatim, plus its edition at the end of the front matter.
    expect(frozen.replace("edition: 1\n---\n", "---\n")).toBe(
      await readFile(drafted.path, "utf8"),
    );
  });

  test("a moved section takes its new place; a renamed heading is still the same team", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    const text = await readFile(path, "utf8");
    const last = text.slice(text.indexOf("## Hail Mary Hustle"));
    await writeFile(
      path,
      text
        .replace(`\n${last}`, "")
        .replace(
          "## Bench Mob {team=sleeper:3}",
          `${last}\n## The Champs {team=sleeper:3}`,
        ),
    );

    const { text: out } = await published(dir, deps);

    expect(out).toContain(
      "by 2.71\n\n1. Hail Mary Hustle · 1-7 (new)\n10th in points · lost 4 straight · lost to Tank Brigade by 31.3\n\n2. Bench Mob · 7-1 (new)\n1st in points · won 7 straight · beat Snap Judgement by 2.71\n\n3. Bye Bye Bea · 6-2 (new)\n",
    );
    expect(out).toContain(
      "12. Pylon Patrol · 3-5 (new)\n11th in points · lost 3 straight · lost to Gus Bus by 55\n\nStats: Sleeper",
    );
  });

  const GUS =
    "## Gus Bus {team=sleeper:1}\n[6th]{ev=pf_rank} in points · [beat]{ev=w8.result} [Pylon Patrol]{ev=w8.opponent} by [55]{ev=w8.margin}\n";
  test.each([
    [
      "missing",
      (text: string) => text.replace(GUS, ""),
      /missing.*Gus Bus \{team=sleeper:1\}/i,
    ],
    [
      "duplicated",
      (text: string) => `${text}\n${GUS.replace("Gus Bus", "Gus Again")}`,
      /Gus Bus \{team=sleeper:1\}.*more than once.*lines \d+ and \d+/i,
    ],
    [
      "unknown",
      (text: string) => `${text}\n## Ghost Team {team=sleeper:99}\n`,
      /unknown team.*Ghost Team \{team=sleeper:99\}/i,
    ],
  ])(
    "a %s team is rejected by name and nothing is published",
    async (_, edit, message) => {
      const { dir, deps, clipboard } = await fearTheTurtle(8);
      const { path } = await draft(dir, deps);
      await writeFile(path, edit(await readFile(path, "utf8")));

      const error = await publish(dir, deps).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RankingFileError);
      expect((error as Error).message).toMatch(message);
      expect(existsSync(join(rankingsDir(dir), "week-08.published.md"))).toBe(
        false,
      );
      expect(existsSync(join(rankingsDir(dir), "week-08.txt"))).toBe(false);
      expect(clipboard.copied).toEqual([]);
    },
  );
});

describe("publish: intro and groups", () => {
  test("the intro follows the header and groups divide the places, which run straight through", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    await writeFile(
      path,
      (await readFile(path, "utf8"))
        .replace(
          /## Intro \{intro\}\n.*\n/,
          "## Intro {intro}\nEight weeks in and Bench Mob are [7-1]{ev=sleeper:3/record}.\n",
        )
        .replace(
          "## Bench Mob {team=sleeper:3}",
          "# Contenders\n\n## Bench Mob {team=sleeper:3}",
        )
        .replace(
          "## Frank's FAAB Fund {team=sleeper:4}",
          "# The Rest\n\n## Frank's FAAB Fund {team=sleeper:4}",
        ),
    );

    const { text } = await published(dir, deps);

    expect(text).toContain(
      "after Week 8 · by rikhin\n\nEight weeks in and Bench Mob are 7-1.\n\n— CONTENDERS —\n\n1. Bench Mob · 7-1 (new)\n",
    );
    expect(text).toContain(
      "3. Red Zone Rascals · 5-3 (new)\n7th in points · lost to Kim Possible Kicks by 6.18\n\n— THE REST —\n\n4. Frank's FAAB Fund · 5-3 (new)\n",
    );
  });

  test("a section with neither a team tag nor {intro} is rejected", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace(
        "## Gus Bus {team=sleeper:1}",
        "## Gus Bus",
      ),
    );

    await expect(publish(dir, deps)).rejects.toThrow(
      /line \d+: section "Gus Bus" has no \{team=…\} or \{intro\} tag/,
    );
  });
});

describe("format versions", () => {
  test("every workspace file written carries the format version", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    await draft(dir, deps);
    await publish(dir, deps);

    const files = (await readdir(dir, { recursive: true })).filter(
      (f) => f.endsWith(".md") || f.endsWith("manifest.json"),
    );
    expect(files.length).toBe(4); // workspace.md, draft, frozen copy, manifest
    for (const file of files) {
      const text = await readFile(join(dir, file), "utf8");
      const format = file.endsWith(".json")
        ? JSON.parse(text).format
        : frontMatter(text).format;
      expect(format, file).toBe(1);
    }
  });

  test("a draft with an unknown format version is refused", async () => {
    const { dir, deps, clipboard } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("format: 1", "format: 2"),
    );

    await expect(publish(dir, deps)).rejects.toThrow(
      /week-08\.md is format 2.*reads only format 1/,
    );
    expect(clipboard.copied).toEqual([]);
  });

  test("a workspace.md with an unknown format version is refused", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const file = join(dir, "workspace.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace("format: 1", "format: 7"),
    );

    await expect(draft(dir, deps)).rejects.toThrow(
      /workspace\.md is format 7.*reads only format 1/,
    );
    expect(existsSync(join(dir, ".snapshots"))).toBe(false);
  });
});
