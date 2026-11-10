import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  check,
  draft,
  type Problem,
  publish,
  readManifest,
  refresh,
  SnapshotDamagedError,
  WorkspaceFileError,
} from "../src/index.ts";
import {
  fearTheTurtle,
  frontMatter,
  onStandings,
  rankingsDir,
  withFrontMatter,
  withoutReminder,
} from "./support/workspace.ts";

const GUS = "## Gus Bus {team=sleeper:1}\n";

/** The correction-timing reminder on a Sleeper draft of a scored week. */
const CORRECTION_TIMING: Problem = {
  severity: "soft",
  team: null,
  section: "League",
  line: null,
  text: "",
  kind: "correction-timing",
  reason: "Scored. Corrections may land through Thursday",
};

/** Drafts week 8, then lets the test edit the draft as the pundit would. */
async function drafted() {
  const ws = await onStandings(8);
  const { path } = await draft(ws.dir, ws.deps);
  const edit = async (change: (text: string) => string) =>
    writeFile(path, change(await readFile(path, "utf8")));
  const read = () => readFile(path, "utf8");
  return { ...ws, path, edit, read };
}

/** Drafts week 8 and reshapes its front matter, counting requests from then on. */
async function reshaped(shape: (text: string) => string) {
  const ws = await drafted();
  await ws.edit(shape);
  let requests = 0;
  const inner = ws.deps.transport;
  const deps = {
    ...ws.deps,
    transport: {
      request: (req: Parameters<typeof inner.request>[0]) => {
        requests++;
        return inner.request(req);
      },
    },
  };
  const snapshots = () => readdir(join(ws.dir, ".snapshots"));
  return { ...ws, deps, requests: () => requests, snapshots };
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

    expect(result).toMatchObject({
      week: 8,
      path,
      problems: [CORRECTION_TIMING],
    });
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
      CORRECTION_TIMING,
    ]);
    expect(await read()).toBe(before);
  });

  test("a clear untagged claim is auto-tagged in the file, words unchanged", async () => {
    const { dir, deps, edit, read } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They won by 55 this week.\n`));

    const result = await check(dir, deps);

    expect(result.problems).toEqual([CORRECTION_TIMING]);
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
      problems: [CORRECTION_TIMING],
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
      CORRECTION_TIMING,
      // The swap's two teams are each a moved team.
      expect.objectContaining({ kind: "moved", team: "sleeper:4" }),
      expect.objectContaining({ kind: "moved", team: "sleeper:8" }),
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
    expect(result.problems).toEqual([...(asked[0] ?? []), CORRECTION_TIMING]);
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
    ).toContain(
      "6. Gus Bus · 4-4 (new)\nThey won by 50 this week.\n6th in points",
    );
  });

  test("--yes publishes without asking", async () => {
    const { dir, deps, edit } = await drafted();
    await edit((t) => t.replace(GUS, `${GUS}They won by 50 this week.\n`));
    const { asked, confirm } = answering(false);

    const result = await publish(dir, deps, { yes: true, confirm });

    expect(asked).toEqual([]);
    expect(result).toMatchObject({
      published: true,
      problems: [
        expect.objectContaining({ severity: "hard" }),
        CORRECTION_TIMING,
      ],
    });
  });

  test("a clean draft publishes without asking", async () => {
    const { dir, deps } = await drafted();
    const { asked, confirm } = answering(false);

    const result = await publish(dir, deps, { confirm });

    expect(asked).toEqual([]);
    expect(result).toMatchObject({
      published: true,
      problems: [CORRECTION_TIMING],
    });
  });

  test("soft problems are listed without asking", async () => {
    const { dir, deps, edit } = await drafted();
    // The draft has no group headings, so a tier claim can't be checked.
    await edit((t) => t.replace(GUS, `${GUS}They sit in the second tier.\n`));
    const { asked, confirm } = answering(false);

    const result = await publish(dir, deps, { confirm });

    expect(asked).toEqual([]);
    expect(result).toMatchObject({
      published: true,
      problems: [
        CORRECTION_TIMING,
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
      "6. Gus Bus · 4-4 (new)\nThey won by 55, a rivalry and a bet later.\n",
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
        CORRECTION_TIMING,
      ],
    });
  });
});

describe("an untagged claim naming a week", () => {
  /** Drafts week 15, where Bench Mob had a bye and played last in week 14, and adds `words` to a team's blurb. */
  async function week15(heading: string, words: string) {
    const ws = await fearTheTurtle(15);
    const { path } = await draft(ws.dir, ws.deps);
    const text = await readFile(path, "utf8");
    if (!text.includes(heading)) throw new Error(`no ${heading}`);
    await writeFile(path, text.replace(heading, `${heading}${words}\n`));
    return (await check(ws.dir, ws.deps)).problems;
  }

  test("is unchecked, naming the week, when the evidence pack doesn't hold it", async () => {
    const problems = await week15(
      GUS,
      "They scored 140.04 points in week 14. They beat Tank Brigade in week 14. It ended 140.04-136.94 in week 14. They were top 3 for week 14.",
    );

    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: "soft",
        text: "top 3",
        kind: "unchecked",
        reason: "no week 14 rank in the evidence pack",
      }),
    );

    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: "soft",
        text: "140.04",
        kind: "unchecked",
        reason: "no week 14 points in the evidence pack",
      }),
    );
    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: "soft",
        text: "beat Tank Brigade",
        kind: "unchecked",
        reason: "no week 14 result in the evidence pack",
      }),
    );
    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: "soft",
        text: "140.04-136.94",
        kind: "unchecked",
        reason: "no week 14 score in the evidence pack",
      }),
    );
  });

  test("reads an earlier week's stats when the evidence pack holds them", async () => {
    const problems = await week15(
      "## Bench Mob {team=sleeper:3}\n",
      "They scored 111.43 points in week 14. They beat Bye Bye Bea in week 14. In week 14 it ended 111.43-85.3. Week 14's margin was 30.",
    );

    const bench = problems.filter((p) => p.section === "Bench Mob");
    expect(bench).toEqual([
      expect.objectContaining({
        severity: "hard",
        text: "30",
        kind: "wrong",
        reason: "w14.margin is 26.13",
      }),
    ]);
  });

  test("a claim naming no week still reads the ranking week", async () => {
    const problems = await week15(
      GUS,
      "They scored 111.12 points. They scored 140.04 points. Week 14 was rough, but this week they scored 111.12. After a week 14 win, they put up 111.12. It's their best since week 7, at 111.12 points scored.",
    );

    const gus = problems.filter((p) => p.section === "Gus Bus");
    expect(gus).toEqual([
      expect.objectContaining({
        text: "140.04",
        kind: "wrong",
        reason: "w15.points is 111.12",
      }),
    ]);
  });
});

describe("a draft whose snapshot is missing", () => {
  /** Drafts week 8, then deletes what `gone` names from its snapshot. */
  async function missing(gone: "snapshots folder" | "manifest" | "blob") {
    const ws = await drafted();
    const id = String(frontMatter(await ws.read()).snapshot);
    const snapshots = join(ws.dir, ".snapshots");
    if (gone === "snapshots folder") {
      await rm(snapshots, { recursive: true });
    } else if (gone === "manifest") {
      await rm(join(snapshots, id), { recursive: true });
    } else {
      const manifest = JSON.parse(
        await readFile(join(snapshots, id, "manifest.json"), "utf8"),
      ) as { requests: { sha256: string }[] };
      const sha = manifest.requests[0]?.sha256;
      await rm(join(snapshots, "blobs", `${sha}.json.gz`));
    }
    return { ...ws, message: missingMessage(id) };
  }

  const missingMessage = (id: string) =>
    `week-08.md stands on snapshot ${id}, which is missing from the workspace's snapshots folder, so the draft can't be checked. Move week-08.md out of its season folder and run \`lazy-pundit draft\` to start the week again`;

  test.each(["snapshots folder", "manifest", "blob"] as const)(
    "with its %s gone, check names the draft, the snapshot and the fix",
    async (gone) => {
      const { dir, deps, message } = await missing(gone);

      const failed = check(dir, deps);

      await expect(failed).rejects.toThrow(WorkspaceFileError);
      await expect(failed).rejects.toThrow(message);
    },
  );

  test("refresh and publish give the same message and leave the draft byte for byte", async () => {
    const { dir, deps, message, read } = await missing("snapshots folder");
    const before = await read();

    await expect(refresh(dir, deps)).rejects.toThrow(message);
    await expect(publish(dir, deps)).rejects.toThrow(message);

    expect(await read()).toBe(before);
    expect(await readdir(rankingsDir(dir))).toEqual(["week-08.md"]);
  });

  test("draft over it still says the draft exists", async () => {
    const { dir, deps } = await missing("snapshots folder");

    await expect(draft(dir, deps)).rejects.toThrow(
      /^week-08\.md already exists, so it was left as it is$/,
    );
  });
});

describe("a draft whose snapshot is damaged", () => {
  const shapes = {
    "a manifest that isn't JSON": async (id: string, snapshots: string) => {
      await writeFile(join(snapshots, id, "manifest.json"), "{");
    },
    "a manifest of the wrong shape": async (id: string, snapshots: string) => {
      await writeFile(join(snapshots, id, "manifest.json"), '{"requests":3}');
    },
    "a blob that isn't gzip": async (id: string, snapshots: string) => {
      await writeFile(await firstBlob(id, snapshots), "not gzip");
    },
    "a blob whose content doesn't match its hash": async (
      id: string,
      snapshots: string,
    ) => {
      await writeFile(await firstBlob(id, snapshots), gzipSync("{}"));
    },
  };

  /** The path of the first blob the snapshot's manifest lists. */
  async function firstBlob(id: string, snapshots: string): Promise<string> {
    const sha = (await readManifest(snapshots, id)).requests[0]?.sha256;
    return join(snapshots, "blobs", `${sha}.json.gz`);
  }

  /** Drafts week 8, then damages its snapshot in the given shape. */
  async function damaged(shape: keyof typeof shapes) {
    const ws = await drafted();
    const id = String(frontMatter(await ws.read()).snapshot);
    await shapes[shape](id, join(ws.dir, ".snapshots"));
    return {
      ...ws,
      message: `week-08.md stands on snapshot ${id}, which is damaged in the workspace's snapshots folder, so the draft can't be checked. Move week-08.md out of its season folder and run \`lazy-pundit draft\` to start the week again`,
    };
  }

  test("the library's reader throws SnapshotDamagedError for it", async () => {
    const { dir, read } = await drafted();
    const id = String(frontMatter(await read()).snapshot);
    await shapes["a manifest that isn't JSON"](id, join(dir, ".snapshots"));

    const err = await readManifest(join(dir, ".snapshots"), id).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SnapshotDamagedError);
  });

  test.each(Object.keys(shapes) as (keyof typeof shapes)[])(
    "with %s, check names the draft, the snapshot and the fix",
    async (shape) => {
      const { dir, deps, message } = await damaged(shape);

      const failed = check(dir, deps);

      await expect(failed).rejects.toThrow(WorkspaceFileError);
      await expect(failed).rejects.toThrow(message);
    },
  );

  test.each(Object.keys(shapes) as (keyof typeof shapes)[])(
    "with %s, refresh and publish give the same message and leave the draft byte for byte",
    async (shape) => {
      const { dir, deps, message, read } = await damaged(shape);
      const before = await read();

      await expect(refresh(dir, deps)).rejects.toThrow(message);
      await expect(publish(dir, deps)).rejects.toThrow(message);

      expect(await read()).toBe(before);
      expect(await readdir(rankingsDir(dir))).toEqual(["week-08.md"]);
    },
  );
});

describe("a draft whose front matter publish and refresh can't edit", () => {
  const MESSAGE =
    "week-08.md: put each front-matter key at the start of its line, with no indent and no braces around the keys";

  /** The front matter's lines indented two spaces, as the pundit's editing might leave them. */
  const indented = (text: string) =>
    withFrontMatter(text, (lines) => lines.map((line) => `  ${line}`));

  /** The front matter as one `{...}` flow map. */
  const flowMap = (text: string) =>
    withFrontMatter(text, () => [JSON.stringify(frontMatter(text))]);

  /** A `{...}` flow map with each key on its own line, at its start. */
  const flowMapOverLines = (text: string) =>
    withFrontMatter(text, () => [
      "{",
      Object.entries(frontMatter(text))
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(",\n"),
      "}",
    ]);

  const SHAPES = [
    ["indented", indented],
    ["a flow map", flowMap],
    ["a flow map over several lines", flowMapOverLines],
  ] as const;

  test.each(SHAPES)(
    "front matter %s: check names the draft and the fix",
    async (_, shape) => {
      const { dir, deps } = await reshaped(shape);

      const failed = check(dir, deps);

      await expect(failed).rejects.toThrow(WorkspaceFileError);
      await expect(failed).rejects.toThrow(MESSAGE);
    },
  );

  test.each(SHAPES)(
    "front matter %s: publish and refresh give the same message, before fetching and writing nothing",
    async (_, shape) => {
      const { dir, deps, read, requests, snapshots } = await reshaped(shape);
      const before = await read();
      const snapshotsBefore = await snapshots();

      await expect(publish(dir, deps)).rejects.toThrow(MESSAGE);
      await expect(refresh(dir, deps)).rejects.toThrow(MESSAGE);

      expect(requests()).toBe(0);
      expect(await snapshots()).toEqual(snapshotsBefore);
      expect(await read()).toBe(before);
      expect(await readdir(rankingsDir(dir))).toEqual(["week-08.md"]);
    },
  );

  test("a key's comment, blank line or a nested map's indented lines are fine", async () => {
    const { dir, deps, edit } = await drafted();
    await edit((t) =>
      t.replace("\n---\n", "\n\n# mine\nnotes:\n  a: 1 # aside\n---\n"),
    );

    const { problems } = await check(dir, deps);

    expect(withoutReminder(problems)).toEqual([]);
  });
});

describe("front matter that isn't valid YAML", () => {
  /** The refusal for `file`, with the hint an indent fix earns. */
  const message = (file: string) =>
    `${file}: the front matter isn't valid YAML; check each key's indent, and use spaces, not tabs`;
  const MESSAGE = message("week-08.md");

  /** `key`'s line in the front matter with `indent` before it, the rest as they are. */
  const indentKey = (key: string, indent: string) => (text: string) =>
    withFrontMatter(text, (lines) =>
      lines.map((line) => (line.startsWith(`${key}:`) ? indent + line : line)),
    );

  /** A tab before every line of the front matter, as a pasted copy might have. */
  const tabbed = (text: string) =>
    withFrontMatter(text, (lines) => lines.map((line) => `\t${line}`));

  const SHAPES = [
    ["one key indented two spaces", indentKey("week", "  ")],
    ["a tab before one key", indentKey("week", "\t")],
    ["a tab before every key", tabbed],
  ] as const;

  test.each(SHAPES)(
    "%s: check names the draft and what to check",
    async (_, shape) => {
      const { dir, deps } = await reshaped(shape);

      const failed = check(dir, deps);

      await expect(failed).rejects.toThrow(WorkspaceFileError);
      await expect(failed).rejects.toThrow(MESSAGE);
    },
  );

  test.each(SHAPES)(
    "%s: publish and refresh give the same message, before fetching and writing nothing",
    async (_, shape) => {
      const { dir, deps, read, requests, snapshots } = await reshaped(shape);
      const before = await read();
      const snapshotsBefore = await snapshots();

      await expect(publish(dir, deps)).rejects.toThrow(MESSAGE);
      await expect(refresh(dir, deps)).rejects.toThrow(MESSAGE);

      expect(requests()).toBe(0);
      expect(await snapshots()).toEqual(snapshotsBefore);
      expect(await read()).toBe(before);
      expect(await readdir(rankingsDir(dir))).toEqual(["week-08.md"]);
    },
  );

  test("workspace.md with one key indented gets the same hint, naming workspace.md", async () => {
    const { dir, deps } = await drafted();
    const file = join(dir, "workspace.md");
    const before = await readFile(file, "utf8");
    await writeFile(file, indentKey("pundit", "  ")(before));

    await expect(check(dir, deps)).rejects.toThrow(message("workspace.md"));
  });

  /** An extra key `notes` with `value` after the front matter's last key. */
  const withNotes = (value: string) => (text: string) =>
    withFrontMatter(text, (lines) => [...lines, `notes: ${value}`]);

  test.each([
    ["a value with a colon", withNotes("half: time")],
    ["an unclosed bracket", withNotes("[1, 2")],
    ["an unclosed quote", withNotes('"half time')],
  ])("%s: no indent fixes it, so check gives no hint", async (_, shape) => {
    const { dir, deps } = await reshaped(shape);

    await expect(check(dir, deps)).rejects.toMatchObject({
      message: "week-08.md: the front matter isn't valid YAML",
    });
  });
});
