import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import {
  draft,
  draftData,
  isHard,
  type TeamId,
  validate,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { week8Evidence } from "./support/week8-evidence.ts";
import {
  committed,
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  type Json,
  patched,
  patchingTransport,
} from "./support/workspace.ts";

/** One team's section body in a draft. */
function section(text: string, team: string): string {
  const start = text.indexOf(`{team=${team}}\n`);
  if (start < 0) throw new Error(`no section for ${team}`);
  const body = text.slice(text.indexOf("\n", start) + 1);
  return body.slice(0, body.indexOf("\n"));
}

describe("stat lines in a draft", () => {
  test("a team's stat line gives its points rank, streak and last result, every number tagged", async () => {
    const { dir, deps } = await fearTheTurtle(8);

    const { path } = await draft(dir, deps);

    const text = await readFile(path, "utf8");
    // Bench Mob after week 8: most points, won 7 straight, beat Snap
    // Judgement 126.89 to 124.18 (fixture:show -- 8 --model).
    expect(section(text, "sleeper:3")).toBe(
      "[1st]{ev=pf_rank} in points · [won 7 straight]{ev=streak} · [beat]{ev=w8.result} [Snap Judgement]{ev=w8.opponent} by [2.71]{ev=w8.margin}",
    );
  });
});

describe("stat lines checked against the evidence pack", () => {
  test("the league stat line is the intro: week high, low, biggest margin and closest matchup", async () => {
    const { dir, deps } = await fearTheTurtle(8);

    const { path } = await draft(dir, deps);

    // Week 8 (fixture:show -- 8 --model): Gus Bus 133.22 beat Pylon Patrol
    // 78.22; Hail Mary Hustle 70.32; Bench Mob won by 2.71.
    expect(await readFile(path, "utf8")).toContain(
      "\n## Intro {intro}\nWeek high: [Gus Bus]{ev=wk.high_team} [133.22]{ev=wk.high} · Week low: [Hail Mary Hustle]{ev=wk.low_team} [70.32]{ev=wk.low} · Biggest margin: [Gus Bus]{ev=wk.margin_max_team} by [55]{ev=wk.margin_max} · Closest matchup: [Bench Mob]{ev=wk.margin_min_team} by [2.71]{ev=wk.margin_min}\n\n## Bench Mob {team=sleeper:3}\n",
    );
  });

  test.each([1, 8, 10, 14, 15])(
    "week %i: every team has a stat line and every claim in it, and in the intro, is tagged and verified",
    async (week) => {
      const league = await committed(week);
      const data = draftData(league, week);

      const nicknames = Object.fromEntries(
        league.teams.map((t) => [
          t.id,
          [t.name, ...t.managers.map((m) => m.displayName)],
        ]),
      );
      const check = (text: string, team: TeamId | null) =>
        validate({
          text,
          team,
          evidence: data.evidence,
          order: {},
          nicknames,
          sections: { lore: [], stakes: [], log: [] },
          swearing: "on",
        }).claims;

      expect(data.intro).not.toBe("");
      const lines: [string, TeamId | null][] = [
        [data.intro, null],
        ...league.teams.map(
          (t) => [data.teams[t.id]?.statLine ?? "", t.id] as [string, TeamId],
        ),
      ];
      for (const [text, team] of lines) {
        expect(text, String(team)).not.toBe("");
        const claims = check(text, team);
        expect(claims.length, text).toBeGreaterThan(0);
        for (const c of claims) {
          expect(c.tagged, `${text}: ${c.text}`).toBe(true);
          expect(c.status, `${text}: ${c.text} (${c.reason})`).toBe("verified");
          expect(isHard(c.status)).toBe(false);
        }
        // No number is left outside a tag.
        expect(text.replace(/\[[^\]]*\]\{[^}]*\}/g, ""), text).not.toMatch(
          /\d/,
        );
      }
    },
  );
});

describe("the evidence pack", () => {
  test("week 8 matches the hand-checked pack: records, all-play, luck, form, points and ranks", async () => {
    const { evidence } = draftData(await committed(8), 8);

    const expected = week8Evidence();
    expect(evidence.week).toBe(8);
    for (const [team, stats] of Object.entries(expected.teams)) {
      expect(
        evidence.teams[team as keyof typeof expected.teams],
        team,
      ).toMatchObject(stats);
    }
    expect(evidence.league).toMatchObject(expected.league);
  });

  test("lineup efficiency, points left on the bench and player facts for week 8", async () => {
    const { evidence } = draftData(await committed(8), 8);

    // Worked by hand from matchups/8: Bench Mob's best lineup swaps Spears
    // (16.7) for Warren (8.3) and Pierce (8.9) for Johnston (0): 144.19.
    expect(evidence.teams["sleeper:3"]).toMatchObject({
      "w8.efficiency": 88,
      "w8.left_on_bench": 17.3,
      "w8.top": "Jonathan Taylor",
      "w8.top_points": 38.4,
      "w8.zeros": "Quentin Johnston",
      "w8.benchmiss": "Tyjae Spears",
      "w8.benchmiss_points": 16.7,
      // Snap Judgement's top starter: Tucker Kraft, 31.8.
      "w8.opp.top": "Tucker Kraft",
      "w8.opp.top_points": 31.8,
    });
    // Hail Mary Hustle's best adds Fannin (15.4) at TE for Ferguson (0): 85.72.
    expect(evidence.teams["sleeper:9"]).toMatchObject({
      "w8.efficiency": 82,
      "w8.left_on_bench": 15.4,
      "w8.zeros": "Jake Ferguson",
    });
  });
});

describe("which weeks count", () => {
  test("a bye week is left out of all-play and form", async () => {
    const { evidence } = draftData(await committed(15), 15);

    // Bench Mob had a bye in week 15: 14 played weeks of 11 all-play games,
    // and form is weeks 12-14: (85.96 + 67.15 + 111.43) / 3.
    const bench = evidence.teams["sleeper:3"] ?? {};
    const [w, l, t = "0"] = String(bench.allplay).split("-");
    expect(Number(w) + Number(l) + Number(t)).toBe(14 * 11);
    expect(bench.form3).toBe(88.18);
    expect(Object.keys(bench).some((k) => k.startsWith("w15."))).toBe(false);
    expect(bench["w14.result"]).toBe("W");
  });

  test("the in-progress week contributes nothing to the draft or its evidence pack", async () => {
    // Week 8 as Sleeper showed it before scoring finished.
    const inProgress = (league: Json) => {
      league.settings.last_scored_leg = 7;
    };
    const ws = await fearTheTurtle(8);
    ws.deps.transport = patchingTransport(ws.deps.transport, {
      [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`]: inProgress,
    });
    const week7 = await fearTheTurtle(7);

    const drafted = await draft(ws.dir, ws.deps);
    const reference = await draft(week7.dir, week7.deps);

    expect(drafted.week).toBe(7);
    const body = async (path: string) =>
      (await readFile(path, "utf8")).replace(/^---[\s\S]*?\n---\n/, "");
    expect(await body(drafted.path)).toBe(await body(reference.path));

    const { evidence } = draftData(await patched(8, { "": inProgress }), 7);
    const week7Pack = draftData(await committed(7), 7).evidence;
    expect(evidence.league).toEqual(week7Pack.league);
    for (const [team, stats] of Object.entries(evidence.teams)) {
      expect(
        Object.keys(stats).filter((k) => k.startsWith("w8.")),
        team,
      ).toEqual([]);
      // Injuries are as of the fetch, so only they may differ.
      const { injuries, injured, ...rest } = stats;
      const {
        injuries: i7,
        injured: j7,
        ...rest7
      } = week7Pack.teams[team as TeamId] ?? {};
      expect(rest, team).toEqual(rest7);
    }
  });
});

describe("notes in the evidence pack", () => {
  test("a commissioner override is noted, and the matchup score is what counts", async () => {
    const league = await patched(8, {
      "matchups/8": (sides: Json) => {
        const bench = sides.find((s: Json) => s.roster_id === 3);
        bench.custom_points = 130.89;
      },
    });

    const { evidence, teams } = draftData(league, 8);

    // 126.89 from the starters, credited 130.89: an override of +4.
    expect(evidence.teams["sleeper:3"]).toMatchObject({
      "w8.override": 4,
      "w8.points": 130.89,
      "w8.margin": 6.71,
      // Lineup stats still use the players' points.
      "w8.left_on_bench": 17.3,
    });
    expect(evidence.teams["sleeper:12"]?.["w8.override"]).toBeUndefined();
    expect(teams["sleeper:3"]?.statLine).toContain("by [6.71]{ev=w8.margin}");
  });

  test("a trade lists each side's players and the points they've scored as starters since", async () => {
    const { evidence } = draftData(await committed(8), 8);

    // Week 5: Hail Mary Hustle got Matthew Golden (started weeks 6 and 8 for
    // 12.7 + 1.9) for TreVeyon Henderson (never started for Wendy's Wire).
    expect(evidence.teams["sleeper:9"]).toMatchObject({
      trades: 1,
      "trade.1.week": 5,
      "trade.1.with": "sleeper:2",
      "trade.1.got": "Matthew Golden",
      "trade.1.gave": "TreVeyon Henderson",
      "trade.1.got_points": 14.6,
      "trade.1.gave_points": 0,
    });
    expect(evidence.teams["sleeper:2"]).toMatchObject({
      trades: 2,
      "trade.2.with": "sleeper:9",
      "trade.2.got_points": 0,
      "trade.2.gave_points": 14.6,
    });
    // Draft picks never enter the pack.
    const ids = Object.values(evidence.teams).flatMap((t) => Object.keys(t));
    expect(ids.filter((k) => /pick|draft/.test(k))).toEqual([]);
  });
});
