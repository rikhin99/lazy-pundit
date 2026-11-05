import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { setFrontMatterValue } from "../src/front-matter.ts";
import {
  check,
  type Deps,
  DraftExistsError,
  draft,
  FetchError,
  publish,
  refresh,
  WorkspaceFileError,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  atWeek,
  FEAR_THE_TURTLE_ID,
  fixedClock,
  frontMatter,
  type Json,
  onStandings,
  patchingTransport,
  published,
  statCorrection,
} from "./support/workspace.ts";

const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;
const LATER = "2025-10-30T09:00:00.000Z";

/** Deps a day later, whose fetch sees `patches` (by URL) on the replayed data. */
function later(
  deps: Deps,
  patches: Record<string, (payload: Json) => void> = {},
): Deps {
  return {
    ...deps,
    clock: fixedClock(LATER),
    transport: patchingTransport(deps.transport, patches),
  };
}

const WEEK_8 = `${LEAGUE}/matchups/8`;

/** Gus Bus won week 8 by 55, so 1.8 more makes every "55" false. */
const GUS_CORRECTED = { [WEEK_8]: statCorrection(1, 1.8) };
/**
 * Bench Mob won week 8 by 2.71, so 10 fewer flips it. At 6-2 on 972.81 they
 * fall behind Bye Bye Bea, 6-2 on 976.25, in the standings.
 */
const BENCH_MOB_FLIPPED = { [WEEK_8]: statCorrection(3, -10) };

/**
 * What GUS_CORRECTED makes false in a new week-8 draft: the intro's week high
 * and biggest margin, and the margin in both teams' stat lines.
 */
const STALE_CLAIMS = [
  ["Intro", "133.22"],
  ["Intro", "55"],
  ["Gus Bus", "55"],
  ["Pylon Patrol", "55"],
];

const body = (text: string) => text.slice(text.indexOf("\n---\n"));

async function drafted() {
  const ws = await onStandings(8);
  const { path } = await draft(ws.dir, ws.deps);
  const read = () => readFile(path, "utf8");
  const edit = async (change: (text: string) => string) =>
    writeFile(path, change(await read()));
  const snapshots = () => readdir(join(ws.dir, ".snapshots"));
  return { ...ws, path, read, edit, snapshots };
}

describe("the data-changed warning", () => {
  test("publish warns with the stale-claim count and doesn't change the draft", async () => {
    const { dir, deps, read } = await drafted();
    const { data_as_of } = frontMatter(await read());

    const result = await publish(dir, later(deps, GUS_CORRECTED));
    const { newlyStale } = await refresh(dir, later(deps, GUS_CORRECTED));

    expect(newlyStale.map((p) => [p.section, p.text])).toEqual(STALE_CLAIMS);
    expect(result).toMatchObject({
      published: true,
      warnings: [
        `data changed since ${data_as_of}: ${STALE_CLAIMS.length} claims would go stale, run \`refresh\``,
      ],
    });
    expect(result.published && result.text).toContain("by 55");
  });

  test("publish writes no snapshot and leaves the draft byte for byte", async () => {
    const { dir, deps, read, snapshots } = await drafted();
    const text = await read();
    const before = await snapshots();

    await publish(dir, later(deps, GUS_CORRECTED));

    expect(await read()).toBe(text);
    expect(await snapshots()).toEqual(before);
  });

  test("a publish stopped by a hard problem still carries the warning", async () => {
    const { dir, deps, edit } = await drafted();
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    await edit((t) => t.replace(GUS, `${GUS}They won by 50 this week.\n`));

    const result = await publish(dir, later(deps, GUS_CORRECTED));

    expect(result.published).toBe(false);
    expect(result.warnings[0]).toMatch(/^data changed since /);
  });

  test("draft over a draft it can't compare still says the draft exists", async () => {
    const { dir, deps, edit } = await drafted();
    await edit((t) => t.replace(/^snapshot: .*$/m, "snapshot: gone"));

    await expect(draft(dir, deps)).rejects.toThrow(
      /^week-08\.md already exists, so it was left as it is$/,
    );
  });

  test("draft over an existing draft writes no snapshot and makes no LLM call", async () => {
    const { dir, deps, snapshots } = await drafted();
    const before = await snapshots();
    const llm = scriptedLlm();
    const keyed: Deps = {
      ...later(deps, GUS_CORRECTED),
      env: { ...deps.env, anthropicApiKey: "sk-test" },
      llm,
    };

    await expect(draft(dir, keyed)).rejects.toThrow(DraftExistsError);

    expect(await snapshots()).toEqual(before);
    expect(llm.requests).toEqual([]);
  });

  test("the warning is told before the prompt for a hard problem", async () => {
    const { dir, deps, edit } = await drafted();
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    await edit((t) => t.replace(GUS, `${GUS}They won by 50 this week.\n`));
    const told: string[] = [];

    await publish(dir, later(deps, GUS_CORRECTED), {
      onWarnings: (warnings) => told.push(...warnings),
      confirm: async () => {
        told.push("asked");
        return false;
      },
    });

    expect(told).toEqual([
      expect.stringMatching(/^data changed since /),
      "asked",
    ]);
  });

  test("an injury or team-name change alone doesn't count as data changed", async () => {
    const { dir, deps, read } = await drafted();
    const text = await read();
    const cosmetic = {
      [`${SLEEPER_API}/players/nfl`]: (players: Json) => {
        for (const p of Object.values(players) as Json[]) {
          p.injury_status = "Out";
        }
      },
      [`${LEAGUE}/users`]: (users: Json) => {
        for (const u of users) u.metadata = { team_name: "Renamed" };
      },
    };

    const published_ = await publish(dir, later(deps, cosmetic));
    const refreshed = await refresh(dir, later(deps, cosmetic));

    expect(published_.warnings).toEqual([]);
    expect(refreshed.changes).toEqual([]);
    expect(body(await read())).toBe(body(text));
  });

  test("a later scored week isn't data changed for this draft", async () => {
    const { dir, deps } = await drafted();

    const result = await publish(dir, atWeek(deps, 10));

    expect(result.warnings).toEqual([]);
  });

  test("a failed fetch doesn't stop publish, and says the check didn't happen", async () => {
    const { dir, deps } = await drafted();
    const offline: Deps = {
      ...deps,
      transport: {
        request: () => Promise.reject(new Error("offline")),
      },
    };

    const result = await publish(dir, offline);

    expect(result.published).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringMatching(/^couldn't check for data changes: GET .* failed$/),
    ]);
  });

  test("draft over an existing draft says the data changed, and leaves it", async () => {
    const { dir, deps, read } = await drafted();
    const text = await read();

    const err = await draft(dir, later(deps, GUS_CORRECTED)).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(DraftExistsError);
    expect((err as Error).message).toMatch(
      /^week-08\.md already exists, so it was left as it is\. data changed since .*: \d+ claims would go stale, run `refresh`$/,
    );
    expect(await read()).toBe(text);
  });
});

describe("refresh", () => {
  test("marks the affected claims stale with cause refresh, leaving order and words byte-identical", async () => {
    const { dir, deps, read } = await drafted();
    const text = await read();

    const result = await refresh(dir, later(deps, GUS_CORRECTED));

    expect(result.changes.length).toBeGreaterThan(0);
    expect(body(await read())).toBe(body(text));
    const gus = result.newlyStale.find(
      (p) => p.team === "sleeper:1" && p.text === "55",
    );
    expect(gus).toMatchObject({
      severity: "hard",
      kind: "stale",
      cause: "refresh",
      id: "w8.margin",
      reason: "true when written (w8.margin is 55); now w8.margin is 56.8",
    });
    expect(result.problems).toContainEqual(gus);
  });

  test("updates the data the draft stands on, and nothing the pundit owns", async () => {
    const { dir, deps, read, snapshots } = await drafted();
    const was = frontMatter(await read());
    const before = await snapshots();

    const result = await refresh(dir, later(deps, GUS_CORRECTED));

    const now = frontMatter(await read());
    expect(now).toEqual({
      ...was,
      checked_at: LATER,
      data_as_of: LATER,
      snapshot: result.snapshot,
      data_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      earlier_snapshots: [was.snapshot],
    });
    expect(now.data_hash).not.toBe(was.data_hash);
    expect(result.snapshot).not.toBe(was.snapshot);
    expect(result.dataAsOf).toBe(was.data_as_of);
    expect((await snapshots()).sort()).toEqual(
      [...before, result.snapshot].sort(),
    );
  });

  test("a later check still calls the claim stale with cause refresh, not wrong", async () => {
    const { dir, deps } = await drafted();
    await refresh(dir, later(deps, GUS_CORRECTED));

    const { problems } = await check(dir, deps);

    const gus = problems.find((p) => p.team === "sleeper:1" && p.text === "55");
    expect(gus).toMatchObject({ kind: "stale", cause: "refresh" });
    expect(problems.some((p) => p.kind === "wrong")).toBe(false);
  });

  test("a claim that was never true stays wrong after a refresh", async () => {
    const { dir, deps, edit } = await drafted();
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    await edit((t) =>
      t.replace(GUS, `${GUS}They won by [50]{ev=w8.margin} this week.\n`),
    );

    const { problems, newlyStale } = await refresh(
      dir,
      later(deps, GUS_CORRECTED),
    );

    expect(problems.find((p) => p.text === "50")?.kind).toBe("wrong");
    expect(newlyStale.some((p) => p.text === "50")).toBe(false);
  });

  test("a claim fixed after one refresh and broken by the next reads stale in both lists", async () => {
    const { dir, deps, edit } = await drafted();
    await refresh(dir, later(deps, GUS_CORRECTED));
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    await edit((t) =>
      t.replace(GUS, `${GUS}They won by [56.8]{ev=w8.margin} this week.\n`),
    );

    const second = await refresh(
      dir,
      later(deps, { [WEEK_8]: statCorrection(1, 3) }),
    );

    const stale = { kind: "stale", cause: "refresh", text: "56.8" };
    expect(second.newlyStale).toContainEqual(expect.objectContaining(stale));
    expect(second.problems).toContainEqual(expect.objectContaining(stale));
    const { problems } = await check(dir, deps);
    expect(problems).toContainEqual(expect.objectContaining(stale));
  });

  test("a second refresh lists only what it made stale, and adds to the earlier snapshots", async () => {
    const { dir, deps, read } = await drafted();
    const original = frontMatter(await read()).snapshot;
    const { snapshot: first } = await refresh(dir, later(deps, GUS_CORRECTED));

    const second = await refresh(
      dir,
      later(deps, {
        [WEEK_8]: (payload: Json) => {
          GUS_CORRECTED[WEEK_8]?.(payload);
          BENCH_MOB_FLIPPED[WEEK_8]?.(payload);
        },
      }),
    );

    expect(second.newlyStale.length).toBeGreaterThan(0);
    expect(second.newlyStale.some((p) => p.text === "55")).toBe(false);
    expect(
      second.problems.find((p) => p.team === "sleeper:1" && p.text === "55"),
    ).toMatchObject({ kind: "stale", cause: "refresh" });
    expect(frontMatter(await read()).earlier_snapshots).toEqual([
      original,
      first,
    ]);
  });

  test("with no change it says so and updates only checked_at", async () => {
    const { dir, deps, read, snapshots } = await drafted();
    const text = await read();
    const { checked_at } = frontMatter(text);
    const before = await snapshots();

    const result = await refresh(dir, later(deps));

    expect(result.changes).toEqual([]);
    expect(result.newlyStale).toEqual([]);
    expect(await read()).toBe(
      text.replace(`checked_at: ${checked_at}`, `checked_at: ${LATER}`),
    );
    expect(await snapshots()).toEqual(before);
  });

  test("with no change an untagged claim isn't auto-tagged, so only checked_at moves", async () => {
    const { dir, deps, read, edit } = await drafted();
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    await edit((t) => t.replace(GUS, `${GUS}They won by 55 this week.\n`));
    const text = await read();

    await refresh(dir, later(deps));

    expect(body(await read())).toBe(body(text));
    expect(body(await read())).toContain("They won by 55 this week.");
  });

  test("an untagged claim the correction breaks goes stale without being tagged", async () => {
    const { dir, deps, read, edit } = await drafted();
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    await edit((t) => t.replace(GUS, `${GUS}They won by 55 this week.\n`));

    const { newlyStale } = await refresh(dir, later(deps, GUS_CORRECTED));

    expect(body(await read())).toContain("They won by 55 this week.");
    expect(
      newlyStale.some((p) => p.team === "sleeper:1" && p.text.includes("55")),
    ).toBe(true);
  });

  test("a new starting order is written and shown as moved teams, with the pundit's order kept", async () => {
    const { dir, deps, read } = await drafted();
    const text = await read();
    const order = frontMatter(text).starting_order as string[];
    expect(order[0]).toBe("sleeper:3");

    const result = await refresh(dir, later(deps, BENCH_MOB_FLIPPED));

    const now = frontMatter(await read()).starting_order as string[];
    expect(now[0]).toBe("sleeper:11");
    expect(body(await read())).toBe(body(text));
    expect(
      result.problems.find((p) => p.kind === "moved" && p.team === "sleeper:3"),
    ).toMatchObject({
      reason: `starting place ${now.indexOf("sleeper:3") + 1}, now 1`,
    });
  });

  test("keeps a pundit's comments, quoting and key order, including when starting_order changes", async () => {
    const { dir, deps, read, edit } = await drafted();
    const keys = (t: string) =>
      t
        .slice(0, t.indexOf("\n---\n"))
        .split("\n")
        .flatMap((l) => /^(\w+):/.exec(l)?.[1] ?? []);
    const drafted_keys = keys(await read());
    await edit((t) =>
      t
        .replace("---\n", "---\n# pundit: rethink the top three\n")
        .replace(/^snapshot: (.*)$/m, 'snapshot: "$1" # the Sunday pull')
        .replace(/^pundit: (.*)$/m, 'pundit: "$1" # that\'s me')
        .replace(/^starting_order: (.*)$/m, "starting_order: $1 # as drafted"),
    );

    const result = await refresh(dir, later(deps, BENCH_MOB_FLIPPED));

    const text = await read();
    const lines = text.split("\n");
    expect(lines[1]).toBe("# pundit: rethink the top three");
    expect(text).toContain('\npundit: "rikhin" # that\'s me\n');
    expect(text).toMatch(/\nstarting_order: \[sleeper:11, .*\] # as drafted\n/);
    expect(text).toContain(
      `\nsnapshot: ${result.snapshot} # the Sunday pull\n`,
    );
    expect(keys(text)).toEqual([...drafted_keys, "earlier_snapshots"]);
  });

  test("gives a value YAML would misread its quotes", async () => {
    const text = "---\nformat: 1\nnote: x # keep\n---\nbody\n";

    const set = setFrontMatterValue("f.md", text, "note", "a: b # c");

    expect(set).toBe('---\nformat: 1\nnote: "a: b # c" # keep\n---\nbody\n');
    expect(frontMatter(set).note).toBe("a: b # c");
  });

  test("a failed fetch stops refresh and leaves the draft", async () => {
    const { dir, deps, read } = await drafted();
    const text = await read();
    const offline: Deps = {
      ...deps,
      transport: { request: () => Promise.reject(new Error("offline")) },
    };

    await expect(refresh(dir, offline)).rejects.toThrow(FetchError);
    expect(await read()).toBe(text);
  });

  test("front matter it can't add a key to is refused, and the draft is left", async () => {
    const { dir, deps, read, edit } = await drafted();
    await edit((t) => {
      const end = t.indexOf("\n---\n");
      const indented = t
        .slice(4, end)
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");
      return `---\n${indented}${t.slice(end)}`;
    });
    const text = await read();

    await expect(refresh(dir, later(deps, GUS_CORRECTED))).rejects.toThrow(
      WorkspaceFileError,
    );
    expect(await read()).toBe(text);
  });

  test("a republish after a refresh freezes the refreshed draft", async () => {
    const { dir, deps } = await drafted();
    await refresh(dir, later(deps, GUS_CORRECTED));

    const result = await publish(dir, later(deps, GUS_CORRECTED), {
      yes: true,
    });

    expect(result.published).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test("a draft published before the correction still warns after publish", async () => {
    const { dir, deps } = await drafted();
    await published(dir, deps);

    const result = await publish(dir, later(deps, GUS_CORRECTED));

    expect(result.warnings[0]).toMatch(/^data changed since /);
  });
});
