import { existsSync } from "node:fs";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { checkDraft } from "../src/check.ts";
import {
  draft,
  type LlmRequest,
  publish,
  refresh,
  stats,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { transcriptsDir } from "../src/transcripts.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  atWeek,
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  frontMatter,
  type Json,
  type Preseason,
  patchingTransport,
  preseason,
  published,
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
  return text
    .split(/^(?=## )/m)
    .filter((s) => s.startsWith("## ") && s.includes("{team="));
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

/** `text` with a one-line blurb under each team's heading but `bare`'s. */
function withBlurbs(text: string, bare: string[]): string {
  return text.replace(/^## .* \{team=(sleeper:\d+)\}\n/gm, (heading, team) =>
    bare.includes(team) ? heading : `${heading}Ready to roll.\n`,
  );
}

describe("publishing a week-0 draft", () => {
  test("notes the flag and the teams with no blurb before writing, and asks nothing", async () => {
    const { dir, deps, result: drafted, text } = await preseasonDraft();
    await writeFile(
      drafted.path,
      withBlurbs(text, ["sleeper:1", "sleeper:4", "sleeper:9"]),
    );
    const notes: { note: string; written: boolean }[] = [];

    const result = await publish(dir, deps, {
      confirm: () => {
        throw new Error("asked to confirm");
      },
      confirmRelaxed: () => {
        throw new Error("asked about the persona");
      },
      onPreseasonNote: (note) => {
        notes.push({
          note,
          written: existsSync(drafted.path.replace(".md", ".published.md")),
        });
      },
    });

    const NOTE =
      "Note: week 0 has no starting order, and 3 teams have no blurb: Gus Bus, Frank's FAAB Fund and Hail Mary Hustle.";
    expect(notes).toEqual([{ note: NOTE, written: false }]);
    expect(result).toMatchObject({ published: true, preseasonNote: NOTE });
  });

  test("notes the flag alone when every team has a blurb, and a single team in the singular", async () => {
    const { dir, deps, result: drafted, text } = await preseasonDraft();
    await writeFile(drafted.path, withBlurbs(text, []));
    const all = await published(dir, deps);
    await writeFile(drafted.path, withBlurbs(text, ["sleeper:12"]));
    const one = await published(dir, deps);

    expect(all.preseasonNote).toBe("Note: week 0 has no starting order.");
    expect(one.preseasonNote).toBe(
      "Note: week 0 has no starting order, and 1 team has no blurb: Snap Judgement.",
    );
  });

  test("the plain text says Preseason, with 0-0 records, no movement, and a team with no blurb on its line alone", async () => {
    const { dir, deps, result: drafted, text } = await preseasonDraft();
    await writeFile(
      drafted.path,
      withBlurbs(
        text,
        PLATFORM_ORDER.filter((t) => t !== "sleeper:2"),
      ),
    );

    const { text: plain } = await published(dir, deps);

    expect(plain).toBe(
      [
        "🏈 FEAR THE TURTLE POWER RANKINGS\nPreseason · by rikhin",
        "1. Gus Bus · 0-0",
        "2. Wendy's Wire · 0-0\nReady to roll.",
        "3. Bench Mob · 0-0",
        "4. Frank's FAAB Fund · 0-0",
        "5. Baron Von Trade · 0-0",
        "6. Pylon Patrol · 0-0",
        "7. Kim Possible Kicks · 0-0",
        "8. Red Zone Rascals · 0-0",
        "9. Hail Mary Hustle · 0-0",
        "10. Tank Brigade · 0-0",
        "11. Bye Bye Bea · 0-0",
        "12. Snap Judgement · 0-0",
        "Stats: Sleeper · made with Lazy Pundit\n",
      ].join("\n\n"),
    );
  });

  test("gives no note at a later week", async () => {
    const ws = await fearTheTurtle(1);
    await draft(ws.dir, ws.deps);

    expect((await published(ws.dir, ws.deps)).preseasonNote).toBeUndefined();
  });
});

describe("after a published preseason", () => {
  test("week 1 shows movement from the preseason places, with no 'Movement since' line", async () => {
    const { dir, deps, result: drafted, text } = await preseasonDraft();
    // Gus Bus 2nd and Wendy's Wire 1st in the preseason.
    const [gus, wendy] = sections(text) as [string, string];
    await writeFile(drafted.path, text.replace(gus + wendy, wendy + gus));
    await published(dir, deps);

    await draft(dir, atWeek(deps, 1));
    const { text: plain } = await published(dir, atWeek(deps, 1));

    expect(plain).not.toContain("Movement since");
    expect(plain.split("\n\n").slice(0, 4)).toEqual([
      "🏈 FEAR THE TURTLE POWER RANKINGS\nafter Week 1 · by rikhin",
      "Week high: Gus Bus 144.26 · Week low: Bench Mob 70.02 · Biggest margin: Frank's FAAB Fund by 41.12 · Closest matchup: Snap Judgement by 9.24",
      "1. Gus Bus · 1-0 (▲1)\n1st in points · beat Kim Possible Kicks by 33.54",
      "2. Red Zone Rascals · 1-0 (▲6)\n2nd in points · beat Pylon Patrol by 10.17",
    ]);
  });

  test("a later week with only the preseason published says 'Movement since Preseason'", async () => {
    const { dir, deps } = await preseasonDraft();
    await published(dir, deps);

    await draft(dir, atWeek(deps, 7));
    const { text: plain } = await published(dir, atWeek(deps, 7));

    expect(plain.split("\n")[2]).toBe("Movement since Preseason");
  });

  test("stats says week 0 had no starting order, and leaves it out of the moves' median", async () => {
    const { dir, deps, result: drafted, text } = await preseasonDraft();
    // Every team away from the platform's order.
    await writeFile(
      drafted.path,
      text.replace(sections(text).join(""), sections(text).reverse().join("")),
    );
    await published(dir, deps);
    const week7 = await draft(dir, atWeek(deps, 7));
    const seventh = await readFile(week7.path, "utf8");
    const [first, second] = sections(seventh) as [string, string];
    await writeFile(
      week7.path,
      seventh.replace(first + second, second + first),
    );
    await published(dir, atWeek(deps, 7));

    const summary = await stats(dir);

    expect(summary.weeks[0]).not.toHaveProperty("movedTeams");
    expect(summary.weeks[0]).not.toHaveProperty("placesMoved");
    expect(summary.text.split("\n")).toEqual([
      "Lazy Pundit demand-test summary: 2 published ranking weeks",
      "2025 week 0: 0 min to publish · no starting order · LLM unused · 0 hard and 0 soft blurb problems",
      "2025 week 7: 0 min to publish · 2 teams moved, 2 places in all · LLM unused · 0 hard and 0 soft blurb problems",
      "Median: 0 min to publish · 2 teams moved, 2 places in all · LLM used in 0 of 2 weeks · 0 hard and 0 soft blurb problems",
    ]);
  });

  test("stats with only the preseason published gives no moves' median", async () => {
    const { dir, deps } = await preseasonDraft();
    await published(dir, deps);

    expect((await stats(dir)).text.split("\n").at(-1)).toBe(
      "Median: 0 min to publish · no starting order · LLM used in 0 of 1 week · 0 hard and 0 soft blurb problems",
    );
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

    const { text: plain, preseasonNote: note } = await published(
      ws.dir,
      ws.deps,
    );
    expect(plain).toContain("\n\n3. Team 3 · 0-0\n\n");
    expect(note).toContain(", Team 3, ");
    // No surface shows managers, so nothing says it has none.
    expect(plain).not.toMatch(/manager/i);
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
