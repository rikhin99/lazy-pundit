import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { setFrontMatterKey } from "../src/front-matter.ts";
import {
  check,
  type Deps,
  draft,
  FetchError,
  PLATFORM_WAIT_MS,
  publish,
  RankingFileError,
  refresh,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  atWeek,
  FEAR_THE_TURTLE_ID,
  failingOn,
  fearTheTurtle,
  fixedClock,
  frontMatter,
  onStandings,
  patchingTransport,
  published,
  rankingsDir,
  silentOn,
  withoutPublishRecord,
  withoutReminder,
} from "./support/workspace.ts";

describe("draft: a failed fetch", () => {
  const WEEK_10 = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}/matchups/10`;

  test("continues from the last complete snapshot, with the failed-fetch item", async () => {
    const { dir, deps } = await onStandings(8);
    const first = await draft(dir, deps);
    await rm(first.path);
    const snapshots = await readdir(join(dir, ".snapshots"));

    const result = await draft(dir, failingOn(atWeek(deps, 10), WEEK_10));

    expect(result.week).toBe(8);
    expect(result.snapshot).toBe(first.snapshot);
    expect(await readdir(join(dir, ".snapshots"))).toEqual(snapshots);
    expect(frontMatter(await readFile(result.path, "utf8"))).toMatchObject({
      snapshot: first.snapshot,
      data_as_of: "2025-10-28T15:00:00.000Z",
    });
    expect(result.problems).toContainEqual(
      expect.objectContaining({
        kind: "failed-fetch",
        severity: "soft",
        section: "League",
        reason: `couldn't fetch: GET ${WEEK_10} failed. Continuing from the last complete snapshot, data as of 2025-10-28T15:00:00.000Z. Once fetching works, run: lazy-pundit refresh`,
      }),
    );
  });

  test("a request that runs out of time continues from the last complete snapshot, with the failed-fetch item", async () => {
    const { dir, deps } = await onStandings(8);
    const first = await draft(dir, deps);
    await rm(first.path);
    const later = atWeek(deps, 10);
    const { transport, asked } = silentOn(later.transport, WEEK_10);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let result: Awaited<ReturnType<typeof draft>>;
    try {
      const drafted = draft(dir, { ...later, transport });
      await asked();
      await vi.advanceTimersByTimeAsync(PLATFORM_WAIT_MS);
      result = await drafted;
    } finally {
      vi.useRealTimers();
    }

    expect(result.snapshot).toBe(first.snapshot);
    expect(result.problems).toContainEqual(
      expect.objectContaining({
        kind: "failed-fetch",
        reason: `couldn't fetch: GET ${WEEK_10} got no answer in 30 seconds. Continuing from the last complete snapshot, data as of 2025-10-28T15:00:00.000Z. Once fetching works, run: lazy-pundit refresh`,
      }),
    );
  });

  test("a league the platform doesn't know gives the league ID to check", async () => {
    const { dir, deps } = await onStandings(8);
    const first = await draft(dir, deps);
    await rm(first.path);
    const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;
    const unknown = {
      ...deps,
      transport: patchingTransport(deps.transport, {
        [LEAGUE]: { replaceWith: null },
      }),
    };

    const result = await draft(dir, unknown);

    expect(result.snapshot).toBe(first.snapshot);
    expect(result.problems).toContainEqual(
      expect.objectContaining({
        kind: "failed-fetch",
        reason: `couldn't fetch: Sleeper league ${FEAR_THE_TURTLE_ID} is not a league payload. Continuing from the last complete snapshot, data as of 2025-10-28T15:00:00.000Z. The platform doesn't know this league: check league_id in workspace.md, or run lazy-pundit init for a new workspace.`,
      }),
    );
  });

  describe("with no snapshot to continue from, stops with the fix for what failed", () => {
    const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;

    async function stopped(patch: (deps: Deps) => Deps): Promise<FetchError> {
      const { dir, deps } = await onStandings(8);
      const err = await draft(dir, patch(deps)).catch((e: unknown) => e);
      expect(existsSync(rankingsDir(dir))).toBe(false);
      expect(existsSync(join(dir, ".snapshots"))).toBe(false);
      if (!(err instanceof FetchError))
        throw new Error(`not a FetchError: ${err}`);
      return err;
    }

    test("a failed request says to run the command again, not refresh", async () => {
      const WEEK_8 = `${LEAGUE}/matchups/8`;

      const err = await stopped((deps) => failingOn(deps, WEEK_8));

      expect(err.message).toBe(
        `GET ${WEEK_8} failed. Once fetching works, run the command again.`,
      );
    });

    test("a league the platform doesn't know gives the league ID to check", async () => {
      const err = await stopped((deps) => ({
        ...deps,
        transport: patchingTransport(deps.transport, {
          [LEAGUE]: { replaceWith: null },
        }),
      }));

      expect(err.message).toBe(
        `Sleeper league ${FEAR_THE_TURTLE_ID} is not a league payload. The platform doesn't know this league: check league_id in workspace.md, or run lazy-pundit init for a new workspace.`,
      );
    });

    test("a league payload of another shape says to check for a newer version", async () => {
      const err = await stopped((deps) => ({
        ...deps,
        transport: patchingTransport(deps.transport, {
          [LEAGUE]: (league) => {
            delete league.settings;
          },
        }),
      }));

      expect(err.message).toMatch(
        /\. This version can't read what the platform answered: check for a newer Lazy Pundit\.$/,
      );
    });
  });
});

describe("draft", () => {
  test("writes the ranking file for the last scored week, in standings order", async () => {
    const { dir, deps } = await onStandings(8);

    const result = await draft(dir, deps);

    const path = join(rankingsDir(dir), "week-08.md");
    expect(result.path).toBe(path);
    expect(result.week).toBe(8);
    // Every stat line checks out against the evidence pack.
    expect(withoutReminder(result.problems)).toEqual([]);
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
    const { dir, deps } = await onStandings(week);

    const result = await draft(dir, deps);

    expect(result.week).toBe(week);
    expect(result.path).toBe(join(rankingsDir(dir), file));
    expect(frontMatter(await readFile(result.path, "utf8")).week).toBe(week);
  });

  test("never overwrites an existing draft for the same week", async () => {
    const { dir, deps } = await onStandings(8);
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

describe("publish", () => {
  test("freezes the draft and writes and copies the plain text", async () => {
    const { dir, deps, clipboard } = await onStandings(8);
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
    // The draft verbatim, plus its publish record at the end of the front matter.
    expect(frozen).toContain(
      "\nedition: 1\nfirst_published_at: 2025-10-28T15:00:00.000Z\nblurb_problems: {hard: 0, soft: 0}\n---\n",
    );
    expect(
      withoutPublishRecord(frozen).replace("edition: 1\n---\n", "---\n"),
    ).toBe(await readFile(drafted.path, "utf8"));
  });

  test("a moved section takes its new place; a renamed heading is still the same team", async () => {
    const { dir, deps } = await onStandings(8);
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
      const { dir, deps, clipboard } = await onStandings(8);
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

describe("publish: the frozen copy keeps the draft's text", () => {
  /** Drafts week 8, edits the draft's text and returns it, with the frozen copy's path. */
  async function editedDraft(edit: (text: string) => string) {
    const { dir, deps } = await onStandings(8);
    const { path } = await draft(dir, deps);
    const text = edit(await readFile(path, "utf8"));
    await writeFile(path, text);
    const frozen = join(rankingsDir(dir), "week-08.published.md");
    return { dir, deps, text, frozen };
  }

  const withComment = (text: string) =>
    text.replace("---\n", "---\n# pundit: rethink the top three\n");
  /** The draft's text with `edition: 1` as the front matter's last line. */
  const withFirstEdition = (text: string) =>
    text.replace("\n---\n", "\nedition: 1\n---\n");

  test("a pundit's comment in the front matter stays", async () => {
    const { dir, deps, text, frozen } = await editedDraft(withComment);

    await published(dir, deps);

    expect(withoutPublishRecord(await readFile(frozen, "utf8"))).toBe(
      withFirstEdition(text),
    );
  });

  // Not reachable through publish, where the schema refuses these drafts first.
  test("setting a key whose value is a block never touches the next key", () => {
    expect(
      setFrontMatterKey(
        "week-08.md",
        "---\nedition: |\n  7\nseason: 2025\n---\nbody\n",
        "edition",
        1,
      ),
    ).toBe("---\nedition: 1\nseason: 2025\n---\nbody\n");
  });

  test("setting a key in a file with no front matter is refused", () => {
    expect(() =>
      setFrontMatterKey("week-08.md", "just\nbody\n", "edition", 1),
    ).toThrow("week-08.md has no front matter");
  });

  test("quoted values, trailing comments and key order stay, and the next week still reads it", async () => {
    const { dir, deps, text, frozen } = await editedDraft((t) =>
      t
        .replace(/^snapshot: (.*)$/m, 'snapshot: "$1" # the Sunday pull')
        .replace("week: 8\n", "")
        .replace("format: 1\n", "week: 8\nformat: 1\n"),
    );

    await published(dir, deps);

    const copy = await readFile(frozen, "utf8");
    expect(withoutPublishRecord(copy)).toBe(withFirstEdition(text));
    const { snapshot } = frontMatter(text);
    expect(frontMatter(copy)).toMatchObject({
      format: 1,
      week: 8,
      snapshot,
      edition: 1,
    });
    // Week 9's movement reads this frozen copy, so nobody is new.
    const next = atWeek(deps, 9);
    await draft(dir, next);
    const { text: out } = await published(dir, next);
    expect(out).not.toContain("(new)");
  });

  test("republishing changes only the edition line, keeping the first publish time", async () => {
    const { dir, deps, frozen } = await editedDraft(withComment);

    await published(dir, deps);
    const first = await readFile(frozen, "utf8");
    await published(dir, {
      ...deps,
      clock: fixedClock("2025-10-28T16:00:00.000Z"),
    });
    const second = await readFile(frozen, "utf8");

    expect(withoutPublishRecord(first)).toContain("\nedition: 1\n---\n");
    expect(second).toBe(first.replace("edition: 1", "edition: 2"));
  });

  test.each(["edition: 7 # note\n", '"edition": 7\n', "edition:\n  7\n"])(
    "a hand-written %j is replaced where it stands",
    async (written) => {
      const { dir, deps, text, frozen } = await editedDraft((t) =>
        t.replace("season: 2025\n", `${written}season: 2025\n`),
      );

      await published(dir, deps);

      const copy = await readFile(frozen, "utf8");
      expect(withoutPublishRecord(copy)).toBe(
        text.replace(written, "edition: 1\n"),
      );
      expect(frontMatter(copy).edition).toBe(1);
    },
  );

  test("an edition in a comment or a block scalar isn't the key", async () => {
    const { dir, deps, text, frozen } = await editedDraft((t) =>
      t.replace(
        "season: 2025\n",
        "# edition: 9\nnote: |\n  edition: 3\nseason: 2025\n",
      ),
    );

    await published(dir, deps);

    const copy = await readFile(frozen, "utf8");
    expect(withoutPublishRecord(copy)).toBe(withFirstEdition(text));
    expect(frontMatter(copy)).toMatchObject({
      edition: 1,
      note: "edition: 3\n",
    });
  });

  test.each([
    ["no edition", "", "\nedition: 1\r\n---\r\n"],
    ["an edition", "edition: 7\n", "\nedition: 1\r\nseason: 2025\r\n"],
  ])("a CRLF draft with %s keeps its line endings", async (_, line, added) => {
    const { dir, deps, frozen } = await editedDraft((t) =>
      t
        .replace("season: 2025\n", `${line}season: 2025\n`)
        .replace(/\n/g, "\r\n"),
    );

    await published(dir, deps);

    const copy = await readFile(frozen, "utf8");
    expect(withoutPublishRecord(copy)).toContain(added);
    expect(copy).not.toMatch(/(?<!\r)\n/);
    expect(frontMatter(copy).edition).toBe(1);
  });
});

describe("publish: intro and groups", () => {
  test("the intro follows the header and groups divide the places, which run straight through", async () => {
    const { dir, deps } = await onStandings(8);
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
    const { dir, deps } = await onStandings(8);
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

describe("publish: over a frozen copy of that week that can't be read", () => {
  /** Publishes week 8, rewrites its frozen copy with `edit` and returns it. */
  async function brokenFrozenCopy(edit: (text: string) => string) {
    const { dir, deps } = await fearTheTurtle(8);
    await draft(dir, deps);
    await published(dir, deps);
    const frozen = join(rankingsDir(dir), "week-08.published.md");
    await writeFile(frozen, edit(await readFile(frozen, "utf8")));
    return { dir, deps, frozen };
  }

  const atEdition3 = (text: string) => text.replace("edition: 1", "edition: 3");
  const replacedWarning = expect.stringMatching(
    /^week-08\.published\.md can't be read, so publishing replaces it with edition \d, and any edits made in it are lost$/,
  );

  test.each([
    ["an older format", (t: string) => t.replace("format: 1", "format: 0")],
    ["invalid YAML", (t: string) => t.replace("---\n", "---\nbad: [\n")],
    [
      "a body with text outside any section",
      (t: string) => t.replace(/\n---\n/, "\n---\nstray text\n"),
    ],
    [
      "a comment after the edition",
      (t: string) =>
        t
          .replace("edition: 3", "edition: 3 # by hand")
          .replace("format: 1", "format: 0"),
    ],
  ])(
    "with %s and edition 3, writes edition 4 and warns, naming the file",
    async (_, edit) => {
      const { dir, deps, frozen } = await brokenFrozenCopy((t) =>
        edit(atEdition3(t)),
      );

      const result = await published(dir, deps);

      expect(frontMatter(await readFile(frozen, "utf8")).edition).toBe(4);
      expect(result.warnings).toEqual([replacedWarning]);
    },
  );

  test.each([
    ["no front matter", (t: string) => t.replace(/^---\n[\s\S]*?\n---\n/, "")],
    [
      "no edition line",
      (t: string) =>
        t.replace("edition: 1\n", "").replace("format: 1", "format: 0"),
    ],
    [
      "an edition that isn't a positive whole number",
      (t: string) =>
        t
          .replace("edition: 1", "edition: 0x3")
          .replace("format: 1", "format: 0"),
    ],
    [
      "an edition only in the body, a comment or a block scalar",
      (t: string) =>
        t
          .replace("edition: 1\n", "# edition: 9\nnote: |\n  edition: 9\n")
          .replace("format: 1", "format: 0")
          .concat("\nedition: 9\n"),
    ],
  ])("with %s, writes edition 2 and warns", async (_, edit) => {
    const { dir, deps, frozen } = await brokenFrozenCopy(edit);

    const result = await published(dir, deps);

    expect(frontMatter(await readFile(frozen, "utf8")).edition).toBe(2);
    expect(result.warnings).toEqual([replacedWarning]);
  });

  test("a readable frozen copy is replaced without the warning", async () => {
    const { dir, deps, frozen } = await brokenFrozenCopy(atEdition3);

    const result = await published(dir, deps);

    expect(frontMatter(await readFile(frozen, "utf8")).edition).toBe(4);
    expect(result.warnings).toEqual([]);
  });
});

describe("a frozen copy of an earlier week that can't be read", () => {
  /** Publishes week 8 and breaks its frozen copy, keeping the good text. */
  async function brokenWeek8() {
    const { dir, deps } = await fearTheTurtle(8);
    await draft(dir, deps);
    await published(dir, deps);
    const frozen = join(rankingsDir(dir), "week-08.published.md");
    const good = await readFile(frozen, "utf8");
    await writeFile(frozen, good.replace("format: 1", "format: 0"));
    return { dir, deps: atWeek(deps, 9), frozen, good };
  }

  const refusal =
    /week-08\.published\.md[\s\S]*Fix week-08\.published\.md, or delete it/;

  test("refuses draft before writing it, a snapshot or calling the LLM, and drafts once fixed", async () => {
    const { dir, deps, frozen, good } = await brokenWeek8();
    const snapshots = await readdir(join(dir, ".snapshots"));
    const llm = scriptedLlm();
    const withKey = {
      ...deps,
      llm,
      env: { ...deps.env, anthropicApiKey: "sk-ant-api03-test-key" },
    };

    await expect(draft(dir, withKey)).rejects.toThrow(refusal);
    await expect(draft(dir, deps)).rejects.toThrow(refusal);

    expect(existsSync(join(rankingsDir(dir), "week-09.md"))).toBe(false);
    expect(await readdir(join(dir, ".snapshots"))).toEqual(snapshots);
    expect(llm.requests).toEqual([]);
    await writeFile(frozen, good);
    expect((await draft(dir, deps)).path).toBe(
      join(rankingsDir(dir), "week-09.md"),
    );
  });

  test("refuses check, refresh, publish and draft again over a later draft", async () => {
    const { dir, deps, frozen, good } = await brokenWeek8();
    await writeFile(frozen, good);
    await draft(dir, deps);
    await writeFile(frozen, good.replace("format: 1", "format: 0"));

    await expect(check(dir, deps)).rejects.toThrow(refusal);
    await expect(refresh(dir, deps)).rejects.toThrow(refusal);
    await expect(publish(dir, deps)).rejects.toThrow(refusal);
    // Not hidden behind "week-09.md already exists".
    await expect(draft(dir, deps)).rejects.toThrow(refusal);
    expect(existsSync(join(rankingsDir(dir), "week-09.published.md"))).toBe(
      false,
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
    const { dir, deps, clipboard } = await onStandings(8);
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
    const { dir, deps } = await onStandings(8);
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
