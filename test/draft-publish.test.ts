import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { draft, publish, RankingFileError } from "../src/index.ts";
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

    // One section per team, in the starting order, each with a record stat line.
    const headings = [...text.matchAll(/^## (.+) \{team=(sleeper:\d+)\}$/gm)];
    expect(headings.map((h) => h[2])).toEqual(order);
    expect(text).toContain(
      "## Bench Mob {team=sleeper:3}\nRecord: [7-1]{ev=record}.\n",
    );
    expect(text).toContain(
      "## Hail Mary Hustle {team=sleeper:9}\nRecord: [1-7]{ev=record}.\n",
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

1. Bench Mob · 7-1
Record: 7-1.

2. Bye Bye Bea · 6-2
Record: 6-2.

3. Red Zone Rascals · 5-3
Record: 5-3.

4. Frank's FAAB Fund · 5-3
Record: 5-3.

5. Snap Judgement · 4-4
Record: 4-4.

6. Gus Bus · 4-4
Record: 4-4.

7. Tank Brigade · 4-4
Record: 4-4.

8. Wendy's Wire · 3-5
Record: 3-5.

9. Baron Von Trade · 3-5
Record: 3-5.

10. Kim Possible Kicks · 3-5
Record: 3-5.

11. Pylon Patrol · 3-5
Record: 3-5.

12. Hail Mary Hustle · 1-7
Record: 1-7.

Stats: Sleeper · made with Lazy Pundit
`;

describe("publish", () => {
  test("freezes the draft and writes and copies the plain text", async () => {
    const { dir, deps, clipboard } = await fearTheTurtle(8);
    const drafted = await draft(dir, deps);

    const result = await publish(dir, deps);

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
    });
    expect(frozen).toBe(await readFile(drafted.path, "utf8"));
  });

  test("a moved section takes its new place; a renamed heading is still the same team", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    const text = await readFile(path, "utf8");
    const last =
      "## Hail Mary Hustle {team=sleeper:9}\nRecord: [1-7]{ev=record}.\n";
    await writeFile(
      path,
      text
        .replace(`\n${last}`, "")
        .replace(
          "## Bench Mob {team=sleeper:3}",
          `${last}\n## The Champs {team=sleeper:3}`,
        ),
    );

    const { text: published } = await publish(dir, deps);

    expect(published).toContain(
      "after Week 8 · by rikhin\n\n1. Hail Mary Hustle · 1-7\nRecord: 1-7.\n\n2. Bench Mob · 7-1\nRecord: 7-1.\n\n3. Bye Bye Bea · 6-2\n",
    );
    expect(published).toContain(
      "12. Pylon Patrol · 3-5\nRecord: 3-5.\n\nStats: Sleeper",
    );
  });

  const GUS = "## Gus Bus {team=sleeper:1}\nRecord: [4-4]{ev=record}.\n";
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
          "## Bench Mob {team=sleeper:3}",
          "## Intro {intro}\nEight weeks in and [Bench Mob]{ev=sleeper:3/record} still can't lose.\n\n# Contenders\n\n## Bench Mob {team=sleeper:3}",
        )
        .replace(
          "## Frank's FAAB Fund {team=sleeper:4}",
          "# The Rest\n\n## Frank's FAAB Fund {team=sleeper:4}",
        ),
    );

    const { text } = await publish(dir, deps);

    expect(text).toContain(
      "after Week 8 · by rikhin\n\nEight weeks in and Bench Mob still can't lose.\n\n— CONTENDERS —\n\n1. Bench Mob · 7-1\n",
    );
    expect(text).toContain(
      "3. Red Zone Rascals · 5-3\nRecord: 5-3.\n\n— THE REST —\n\n4. Frank's FAAB Fund · 5-3\n",
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
