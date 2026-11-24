import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { checkDraft } from "../src/check.ts";
import { draft, type LlmRequest, refresh } from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { transcriptsDir } from "../src/transcripts.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  frontMatter,
  type Json,
  type Preseason,
  patchingTransport,
  preseason,
  rankingsDir,
  writeSettings,
} from "./support/workspace.ts";

const KEY = "sk-ant-api03-test-key";
const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;

/** Every team, in roster ID order: Sleeper's platform order. */
const PLATFORM_ORDER = Array.from({ length: 12 }, (_, i) => `sleeper:${i + 1}`);

const FLAG = {
  severity: "soft",
  team: null,
  section: "League",
  line: null,
  text: "",
  kind: "no-starting-order",
  reason:
    "week 0 has no starting order: the teams are in the platform's order, so order them by gut",
};

/**
 * Median scoring takes the standings from the rosters' own records, and these
 * points for put roster 12 first: any order built from the standings differs
 * from the platform's.
 */
const unevenPoints: Preseason = {
  league: (league) => {
    league.settings.league_average_match = 1;
  },
  roster: (r) => {
    r.settings.fpts = r.roster_id * 10;
  },
};

async function preseasonDraft(patch?: Preseason) {
  const ws = await fearTheTurtle(1);
  ws.deps = preseason(ws.deps, patch);
  const result = await draft(ws.dir, ws.deps);
  const text = await readFile(result.path, "utf8");
  return { ...ws, result, text };
}

/** The draft's team sections, each from its heading to the next. */
function sections(text: string): string[] {
  return text.split(/^(?=## )/m).filter((s) => s.startsWith("## "));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("a week-0 draft", () => {
  test("lists the teams in the platform's order, not the standings'", async () => {
    const { result, text } = await preseasonDraft(unevenPoints);

    expect(result.week).toBe(0);
    expect(frontMatter(text).starting_order).toEqual(PLATFORM_ORDER);
    expect(sections(text).map((s) => s.split("\n")[0])).toEqual([
      "## Gus Bus {team=sleeper:1}",
      "## Wendy's Wire {team=sleeper:2}",
      "## Bench Mob {team=sleeper:3}",
      "## Frank's FAAB Fund {team=sleeper:4}",
      "## Baron Von Trade {team=sleeper:5}",
      "## Pylon Patrol {team=sleeper:6}",
      "## Kim Possible Kicks {team=sleeper:7}",
      "## Red Zone Rascals {team=sleeper:8}",
      "## Hail Mary Hustle {team=sleeper:9}",
      "## Tank Brigade {team=sleeper:10}",
      "## Bye Bye Bea {team=sleeper:11}",
      "## Snap Judgement {team=sleeper:12}",
    ]);
  });

  test("makes no LLM call with a key, and gives no fallback reason or transcript", async () => {
    const ws = await fearTheTurtle(1);
    ws.deps = preseason(ws.deps);
    // operator()'s noLlm fails the test on any call.
    ws.deps.env.anthropicApiKey = KEY;

    const result = await draft(ws.dir, ws.deps);

    expect(result.fallback).toBeUndefined();
    expect(await exists(transcriptsDir(ws.dir))).toBe(false);
  });

  test("gives no fallback reason without a key either", async () => {
    const { result } = await preseasonDraft();

    expect(result.fallback).toBeUndefined();
  });

  test("has each team section as its heading alone, and no intro", async () => {
    const { text } = await preseasonDraft();

    expect(text).not.toContain("{intro}");
    const teams = sections(text);
    expect(teams).toHaveLength(12);
    for (const s of teams) expect(s.trimEnd().split("\n")).toHaveLength(1);
  });

  test("says nothing of the playoffs when every team makes them", async () => {
    const { text } = await preseasonDraft({
      league: (league) => {
        league.settings.playoff_teams = 12;
      },
    });

    expect(text).not.toContain("Clinched a playoff spot");
    for (const s of sections(text)) {
      expect(s.trimEnd().split("\n")).toHaveLength(1);
    }
  });

  test("carries the no-starting-order flag, and no moved team after a swap", async () => {
    const { dir, result, text } = await preseasonDraft();
    expect(result.problems).toEqual([FLAG]);

    // Swap the first two team sections.
    const [first, second] = sections(text) as [string, string];
    await writeFile(result.path, text.replace(first + second, second + first));
    const { problems } = await checkDraft(dir);

    expect(problems).toEqual([FLAG]);
  });

  test("a place claim the pundit's move breaks is wrong, not stale on reorder", async () => {
    const { dir, result, text } = await preseasonDraft();
    const GUS = "## Gus Bus {team=sleeper:1}\n";
    const WENDY = "## Wendy's Wire {team=sleeper:2}\n";
    const claimed = text.replace(
      GUS,
      `${GUS}Sitting at [#1]{ev=place} for now.\n`,
    );
    // Move Gus Bus below Wendy's Wire, to 2nd.
    const gus = claimed.slice(claimed.indexOf(GUS), claimed.indexOf(WENDY));
    const end = claimed.indexOf("## Bench Mob");
    await writeFile(
      result.path,
      claimed.slice(0, claimed.indexOf(GUS)) +
        claimed.slice(claimed.indexOf(WENDY), end) +
        gus +
        claimed.slice(end),
    );

    const { problems } = await checkDraft(dir);

    expect(problems).toEqual([
      expect.objectContaining({
        severity: "hard",
        team: "sleeper:1",
        kind: "wrong",
        id: "place",
      }),
      FLAG,
    ]);
    expect(problems[0]).not.toHaveProperty("cause");
  });

  test("warns of no week in progress, though the replay holds week 1", async () => {
    const { result } = await preseasonDraft();

    expect(result.warnings.filter((w) => w.includes("in progress"))).toEqual(
      [],
    );
  });

  test("refuses --include-in-progress, writing no draft", async () => {
    const ws = await fearTheTurtle(1);
    ws.deps = preseason(ws.deps);

    await expect(
      draft(ws.dir, ws.deps, { includeInProgress: true }),
    ).rejects.toThrow(
      "A preseason draft takes no in-progress week, so --include-in-progress can't be used until week 1 is scored.",
    );
    expect(await exists(rankingsDir(ws.dir))).toBe(false);
  });
});

describe("refresh of a week-0 draft", () => {
  test("keeps the platform's order and the flag after a data change", async () => {
    const ws = await fearTheTurtle(1);
    ws.deps = preseason(ws.deps, unevenPoints);
    const { path } = await draft(ws.dir, ws.deps);
    const changed = preseason(await fearTheTurtle(1).then((w) => w.deps), {
      ...unevenPoints,
      league: (league) => {
        unevenPoints.league?.(league);
        league.settings.playoff_teams = 4;
      },
    });

    const result = await refresh(ws.dir, { ...ws.deps, ...changed });

    expect(result.changes).not.toEqual([]);
    expect(frontMatter(await readFile(path, "utf8")).starting_order).toEqual(
      PLATFORM_ORDER,
    );
    expect((await checkDraft(ws.dir)).problems).toEqual([FLAG]);
  });

  test("keeps the platform's order and the flag after a method change alone", async () => {
    const ws = await fearTheTurtle(1);
    ws.deps = preseason(ws.deps, unevenPoints);
    const { path } = await draft(ws.dir, ws.deps);
    await writeSettings(ws.dir, "method: form");

    const result = await refresh(ws.dir, ws.deps);

    expect(result.changes).toEqual([]);
    expect(result.methodChanged).toBe(true);
    expect(frontMatter(await readFile(path, "utf8")).starting_order).toEqual(
      PLATFORM_ORDER,
    );
    expect((await checkDraft(ws.dir)).problems).toEqual([FLAG]);
  });
});

describe("before the platform draft", () => {
  test("a team with no manager and empty rosters drafts and checks under its platform name", async () => {
    const ws = await fearTheTurtle(1);
    ws.deps = preseason(ws.deps, {
      roster: (r) => {
        for (const key of ["players", "starters", "reserve", "taxi"]) {
          r[key] = [];
        }
        if (r.roster_id === 3) {
          r.owner_id = null;
          r.co_owners = null;
        }
      },
    });

    const result = await draft(ws.dir, ws.deps);

    const text = await readFile(result.path, "utf8");
    expect(text).toContain("## Team 3 {team=sleeper:3}\n");
    expect(sections(text)[2]?.trimEnd()).toBe("## Team 3 {team=sleeper:3}");
    expect((await checkDraft(ws.dir)).problems).toEqual([FLAG]);
    expect(await readdir(rankingsDir(ws.dir))).toEqual(["week-00.md"]);
  });

  test("the LLM's prompt at a later week says a team has no manager", async () => {
    const ws = await fearTheTurtle(8);
    const llm = scriptedLlm("## {intro}\nWhat a week.");
    ws.deps.llm = llm;
    ws.deps.env.anthropicApiKey = KEY;
    ws.deps.transport = patchingTransport(ws.deps.transport, {
      [`${LEAGUE}/rosters`]: (rosters: Json[]) => {
        const r = rosters.find((x) => x.roster_id === 9);
        r.owner_id = null;
        r.co_owners = null;
      },
    });

    await draft(ws.dir, ws.deps);

    const { prompt } = llm.requests[0] as LlmRequest;
    expect(prompt).toContain(
      "### Team 9 (team id sleeper:9), with no manager\n",
    );
  });
});
