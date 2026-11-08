import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import {
  type ClaimStatus,
  check,
  draft,
  draftData,
  isHard,
  type League,
  type LlmRequest,
  playoffStatuses,
  settledThisWeek,
  type TeamId,
  validate,
} from "../src/index.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  committed,
  fearTheTurtle,
  type Json,
  patched,
  withoutReminder,
} from "./support/workspace.ts";

type Patches = Record<string, (payload: Json) => void>;

/** The week 14 snapshot with a different number of playoff spots. */
const withSpots = (spots: number, more: Patches = {}): Promise<League> =>
  patched(14, {
    "": (l) => {
      l.settings.playoff_teams = spots;
    },
    ...more,
  });

/** Finishes each pair of rosters' matchup level. */
const tied =
  (...pairs: number[]) =>
  (matchups: Json) => {
    for (const m of matchups) {
      if (pairs.includes(m.roster_id)) m.points = 100;
    }
  };

const statusOf = (league: League, week: number, id: string) =>
  playoffStatuses(league, week).get(`sleeper:${id}`);

describe("playoff status on Fear The Turtle (6 spots, 2 byes, 14 weeks)", () => {
  // Worked by hand from each week's records. The first clinch is week 10:
  // Bench Mob (:3) is 9-1 and only :11, :4, :8, :12 and :10 can reach 9 wins.
  // The first eliminations are week 13: :6 and :9 can reach 5 wins, and nine
  // teams already have 6 or more.
  test.each([
    [9, [], []],
    [10, ["sleeper:3"], []],
    [11, [], []],
    [12, ["sleeper:11", "sleeper:4"], []],
    [13, [], ["sleeper:9", "sleeper:6"]],
  ])("week %i reports exactly the teams settled", async (week, c, e) => {
    const league = await committed(15);
    expect(settledThisWeek(league, week)).toEqual({
      clinched: c,
      eliminated: e,
    });
  });

  test("no team has a status before the first clinch", async () => {
    expect(playoffStatuses(await committed(15), 9).size).toBe(0);
  });

  test("after week 13 only the settled teams have a status", async () => {
    expect(
      Object.fromEntries(playoffStatuses(await committed(15), 13)),
    ).toEqual({
      "sleeper:3": "clinched",
      "sleeper:11": "clinched",
      "sleeper:4": "clinched",
      "sleeper:9": "eliminated",
      "sleeper:6": "eliminated",
    });
  });

  test("after the regular season every status is final and matches the week 15 bracket", async () => {
    // Winners bracket in week 15: :4 v :8 and :5 v :7, so :3 and :11 have the
    // byes. :12 is 7-7 too and missed on points for.
    expect(
      Object.fromEntries(playoffStatuses(await committed(15), 14)),
    ).toEqual({
      "sleeper:3": "clinched_bye",
      "sleeper:11": "clinched_bye",
      "sleeper:4": "clinched",
      "sleeper:5": "clinched",
      "sleeper:7": "clinched",
      "sleeper:8": "clinched",
      "sleeper:12": "eliminated",
      "sleeper:2": "eliminated",
      "sleeper:10": "eliminated",
      "sleeper:1": "eliminated",
      "sleeper:9": "eliminated",
      "sleeper:6": "eliminated",
    });
  });

  test("a team that clinches a bye after a spot is listed again", async () => {
    const league = await committed(15);
    expect(settledThisWeek(league, 14).clinched).toEqual([
      "sleeper:3",
      "sleeper:11",
      "sleeper:5",
      "sleeper:7",
      "sleeper:8",
    ]);
  });
});

// Records through week 13, with one week left: :11, :3 and :4 are 9-4, :8 and
// :12 are 7-6, :2, :5, :7 and :10 are 6-7, :1 is 5-8, :9 and :6 are 4-9.
describe("playoff status bounds", () => {
  test("finishing level would decide it: not clinched", async () => {
    // Red Zone Rascals (:8) can lose and finish on 7 wins. Eight teams can reach
    // 7: four strictly, and the four 6-7 teams only by finishing level.
    expect(statusOf(await withSpots(8), 13, "8")).toBeUndefined();
  });

  test("one more spot than the teams that can reach it: clinched", async () => {
    expect(statusOf(await withSpots(9), 13, "8")).toBe("clinched");
  });

  test("winning out would finish level: not eliminated", async () => {
    // Gus Bus (:1) can reach 6 wins. Five teams already have more, and the four
    // 6-7 teams would be level if they lost, so the sixth spot isn't closed.
    expect(statusOf(await withSpots(6), 13, "1")).toBeUndefined();
  });

  test("as many teams sure to finish ahead as there are spots: eliminated", async () => {
    expect(statusOf(await withSpots(5), 13, "1")).toBe("eliminated");
  });

  test("a tie counts as half a win", async () => {
    // Tying week 13 leaves Snap Judgement (:12) on 6.5 wins at worst. Gus Bus on
    // 5-8 reaches only 6, so eight teams can reach it.
    const short = await withSpots(9, { "matchups/13": tied(12, 10) });
    expect(statusOf(short, 13, "12")).toBe("clinched");
    // A tie for Gus Bus too makes 5.5 wins, so it can reach 6.5 and finish level.
    const level = await withSpots(9, { "matchups/13": tied(12, 10, 1, 4) });
    expect(statusOf(level, 13, "12")).toBeUndefined();
  });

  test("a regular-season bye is a matchup that can't be won", async () => {
    // With a bye in week 14, Wendy's Wire (:2) can't reach Red Zone Rascals'
    // floor (6 of 13 against 7 of 14), so only seven teams can.
    const league = await withSpots(8, {
      "matchups/14": (matchups) => {
        for (const m of matchups) {
          if (m.roster_id === 2 || m.roster_id === 6) m.matchup_id = null;
        }
      },
    });
    expect(statusOf(league, 13, "8")).toBe("clinched");
  });

  test.each([
    [4, "clinched"],
    [6, "clinched_bye"],
    [7, "clinched_bye"],
    [8, "clinched"],
  ])("with %i spots the 10-4 leader has %s", async (spots, status) => {
    expect(statusOf(await withSpots(spots), 14, "3")).toBe(status);
  });

  test("7 spots has one bye, so the second team doesn't get it", async () => {
    expect(statusOf(await withSpots(7), 14, "11")).toBe("clinched");
  });

  test("level on points for too: no status even after the regular season", async () => {
    // Red Zone Rascals and Snap Judgement finish 7-7, on 1474.65 and 1462.30
    // points for. Snap Judgement's 77.66 in week 14 becomes 90.01: still a loss.
    const league = await patched(14, {
      "matchups/14": (matchups) => {
        const snap = matchups.find((m: Json) => m.roster_id === 12);
        snap.points = 90.01;
      },
    });
    expect(statusOf(league, 14, "8")).toBeUndefined();
    expect(statusOf(league, 14, "12")).toBeUndefined();
  });

  test.each<[string, Json]>([
    ["median", { league_average_match: 1 }],
    ["divisions", { divisions: 2 }],
  ])("a league with %s gets no playoffs IDs", async (_, settings) => {
    const league = await patched(14, {
      "": (l) => {
        Object.assign(l.settings, settings);
      },
    });
    expect(playoffStatuses(league, 14).size).toBe(0);
    const { evidence } = draftData(league, 14);
    for (const team of league.teams) {
      expect(evidence.teams[team.id]).not.toHaveProperty("playoffs");
    }
    expect(evidence.league).not.toHaveProperty("wk.clinched");
    expect(evidence.league).not.toHaveProperty("wk.eliminated");
  });

  test("a league with no playoffs eliminates nobody", async () => {
    expect(playoffStatuses(await withSpots(0), 14).size).toBe(0);
  });
});

describe("playoff status in the evidence pack", () => {
  test("a settled team has the ID, and a team still alive has none", async () => {
    const pack = draftData(await committed(15), 13).evidence;
    expect(pack.teams["sleeper:3"]?.playoffs).toBe("clinched");
    expect(pack.teams["sleeper:9"]?.playoffs).toBe("eliminated");
    expect(pack.teams["sleeper:12"]).not.toHaveProperty("playoffs");
  });

  test("a bye is its own value", async () => {
    const pack = draftData(await committed(15), 14).evidence;
    expect(pack.teams["sleeper:3"]?.playoffs).toBe("clinched_bye");
  });

  test("wk.clinched and wk.eliminated hold this week's changes, and only when there are some", async () => {
    const league = await committed(15);
    const week12 = draftData(league, 12).evidence.league;
    expect(week12["wk.clinched"]).toBe("sleeper:11,sleeper:4");
    expect(week12).not.toHaveProperty("wk.eliminated");
    const week13 = draftData(league, 13).evidence.league;
    expect(week13["wk.eliminated"]).toBe("sleeper:9,sleeper:6");
    expect(week13).not.toHaveProperty("wk.clinched");
  });
});

describe("playoff status in the stat lines", () => {
  test.each([
    ["sleeper:3", "[Clinched a bye]{ev=playoffs}"],
    ["sleeper:4", "[Clinched a playoff spot]{ev=playoffs}"],
    ["sleeper:12", "[Eliminated]{ev=playoffs}"],
  ])("%s's stat line ends with %s", async (id, words) => {
    const data = draftData(await committed(14), 14);
    expect(data.teams[id as TeamId]?.statLine.endsWith(` · ${words}`)).toBe(
      true,
    );
  });

  test("a team still alive says nothing", async () => {
    const data = draftData(await committed(10), 10);
    expect(data.teams["sleeper:11"]?.statLine).not.toMatch(
      /clinched|eliminated|playoffs/i,
    );
  });

  test("the league stat line says who clinched this week", async () => {
    const { intro } = draftData(await committed(14), 14);
    expect(
      intro.endsWith(
        " · [Clinched this week: Bench Mob, Bye Bye Bea, Baron Von Trade, Kim Possible Kicks and Red Zone Rascals]{ev=wk.clinched}",
      ),
    ).toBe(true);
  });

  test("a week with no clinch leaves it out", async () => {
    const { intro } = draftData(await committed(9), 9);
    expect(intro).not.toContain("Clinched");
  });
});

describe("playoff words in a draft", () => {
  test("clinched written about a team with no settled status is a wrong claim", async () => {
    const { dir, deps } = await fearTheTurtle(8);
    const { path } = await draft(dir, deps);
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace(
        /(\{team=sleeper:3\}\n)/,
        "$1They have clinched a playoff spot. ",
      ),
    );

    const { problems } = await check(dir, deps);

    expect(problems.map((p) => [p.kind, p.text, p.reason])).toContainEqual([
      "wrong",
      "clinched a playoff spot",
      "no settled playoff status: it still depends on matchups to come",
    ]);
  });

  test("a draft in a week with clinches and eliminations checks clean", async () => {
    const { dir, deps } = await fearTheTurtle(14);
    await draft(dir, deps);
    const { problems } = await check(dir, deps);
    expect(withoutReminder(problems).map((p) => [p.text, p.reason])).toEqual(
      [],
    );
  });

  test("clinched written about a team that has clinched is verified", async () => {
    const { dir, deps } = await fearTheTurtle(10);
    const { path } = await draft(dir, deps);
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace(/(\{team=sleeper:3\}\n)/, "$1They have clinched a spot. "),
    );
    expect(withoutReminder((await check(dir, deps)).problems)).toEqual([]);
  });
});

describe("playoff status and the LLM", () => {
  test("the prompt names the teams in wk.clinched and wk.eliminated, and the instructions explain a missing ID", async () => {
    const data = draftData(await committed(14), 14);
    const reply = [
      `## {intro}\nWhat a week. ${data.intro}`,
      ...Object.entries(data.teams).map(
        ([id, t]) => `## {team=${id}}\nSteady as ever. ${t.statLine}`,
      ),
    ].join("\n\n");
    const { dir, deps } = await fearTheTurtle(14);
    const llm = scriptedLlm(reply);
    deps.llm = llm;
    deps.env.anthropicApiKey = "sk-ant-api03-test-key";

    await draft(dir, deps);

    // The stat lines' playoff words pass the gate first time.
    expect(llm.requests).toHaveLength(1);
    const { prompt, system } = llm.requests[0] as LlmRequest;
    expect(prompt).toContain(
      "wk.clinched: Bench Mob, Bye Bye Bea, Baron Von Trade, Kim Possible Kicks, Red Zone Rascals",
    );
    expect(prompt).toContain(
      "wk.eliminated: Snap Judgement, Wendy's Wire, Tank Brigade, Gus Bus",
    );
    expect(prompt).toMatch(/### Bench Mob[^#]*\nplayoffs: clinched_bye\n/);
    expect(system).toContain("A team with no playoffs ID");
  });

  test("in week 15 the prompt sends knocked_out and wk.knocked_out, and explains them", async () => {
    const data = draftData(await committed(15), 15);
    const reply = [
      `## {intro}\n[Baron Von Trade]{ev=wk.knocked_out} are out. ${data.intro}`,
      ...Object.entries(data.teams).map(
        ([id, t]) => `## {team=${id}}\nSteady as ever. ${t.statLine}`,
      ),
    ].join("\n\n");
    const { dir, deps } = await fearTheTurtle(15);
    const llm = scriptedLlm(reply);
    deps.llm = llm;
    deps.env.anthropicApiKey = "sk-ant-api03-test-key";

    await draft(dir, deps);

    // The knocked-out teams' stat lines pass the gate first time.
    expect(llm.requests).toHaveLength(1);
    const { prompt, system } = llm.requests[0] as LlmRequest;
    expect(prompt).toContain(
      "wk.knocked_out: Baron Von Trade, Red Zone Rascals",
    );
    expect(prompt).toMatch(
      /### Baron Von Trade[^#]*\nplayoffs: clinched\n[^#]*knocked_out: 1\n/,
    );
    expect(system).toContain("knocked_out is the winners-bracket round");
    expect(system).toContain("knocked out of the playoffs");
  });
});

describe("knocked out of the playoffs", () => {
  // Week 15 is the first winners-bracket round (fixture:show -- 15 --model):
  // Frank's FAAB Fund (:4) beat Red Zone Rascals (:8), Kim Possible Kicks (:7)
  // beat Baron Von Trade (:5); Bench Mob (:3) and Bye Bye Bea (:11) have byes.
  test("a winners-bracket loser has knocked_out, the round it lost in, and keeps its playoffs", async () => {
    const pack = draftData(await committed(15), 15).evidence;
    expect(pack.teams["sleeper:5"]?.knocked_out).toBe(1);
    expect(pack.teams["sleeper:8"]?.knocked_out).toBe(1);
    expect(pack.teams["sleeper:5"]?.playoffs).toBe("clinched");
    for (const id of ["sleeper:4", "sleeper:7", "sleeper:3", "sleeper:11"]) {
      expect(pack.teams[id as TeamId], id).not.toHaveProperty("knocked_out");
    }
    expect(pack.league["wk.knocked_out"]).toBe("sleeper:5,sleeper:8");
  });

  /** Validates `text` in `team`'s section of `league`'s week, teams known by name. */
  const validateAt = (
    league: League,
    week: number,
    team: TeamId | null,
    text: string,
  ) =>
    validate({
      text,
      team,
      evidence: draftData(league, week).evidence,
      order: {},
      nicknames: Object.fromEntries(league.teams.map((t) => [t.id, [t.name]])),
      sections: { lore: [], stakes: [], log: [] },
      swearing: "on",
    });

  /** Each claim's text and status, as `validateAt` finds them. */
  const claimsAt = (...args: Parameters<typeof validateAt>) =>
    validateAt(...args).claims.map((c) => [c.text, c.status]);

  test.each([
    ["sleeper:5", "Baron Von Trade were eliminated in the first round."],
    ["sleeper:8", "Red Zone Rascals were eliminated in the first round."],
    ["sleeper:5", "Knocked out of the playoffs by Kim."],
    ["sleeper:8", "They got knocked out in the first round."],
  ])("untagged, in %s's blurb: %s is verified", async (team, text) => {
    const claims = claimsAt(await committed(15), 15, team as TeamId, text);
    expect(claims.map(([, s]) => s)).toEqual(["verified"]);
  });

  test.each([
    ["sleeper:4", "Frank's FAAB Fund were eliminated in the first round."],
    ["sleeper:7", "Kim Possible Kicks were eliminated in the first round."],
    ["sleeper:3", "Bench Mob were eliminated."],
    ["sleeper:4", "Knocked out of the playoffs."],
    ["sleeper:11", "They got knocked out in the first round."],
  ])("untagged, in %s's blurb: %s is wrong", async (team, text) => {
    const claims = claimsAt(await committed(15), 15, team as TeamId, text);
    expect(claims.map(([, s]) => s)).toEqual(["wrong"]);
  });

  test.each([
    ["sleeper:5", "[Eliminated]{ev=playoffs}", "verified"],
    ["sleeper:8", "[Eliminated]{ev=playoffs}", "verified"],
    ["sleeper:5", "[Knocked out]{ev=knocked_out}", "verified"],
    [
      "sleeper:5",
      "[eliminated in the first round]{ev=knocked_out}",
      "verified",
    ],
    ["sleeper:5", "[Knocked out]{ev=wk.knocked_out}", "verified"],
    ["sleeper:5", "[Clinched a playoff spot]{ev=playoffs}", "verified"],
    ["sleeper:5", "[clinched]{ev=knocked_out}", "wrong"],
    ["sleeper:4", "[Eliminated]{ev=playoffs}", "wrong"],
    ["sleeper:7", "[Eliminated]{ev=playoffs}", "wrong"],
    ["sleeper:3", "[Eliminated]{ev=playoffs}", "wrong"],
    ["sleeper:4", "[Knocked out]{ev=wk.knocked_out}", "wrong"],
  ])("tagged, in %s's blurb: %s is %s", async (team, text, status) => {
    const claims = claimsAt(await committed(15), 15, team as TeamId, text);
    expect(claims.map(([, s]) => s)).toEqual([status]);
  });

  test("an untagged claim is auto-tagged to the ID that applies", async () => {
    const league = await committed(15);
    const tagged = (team: TeamId, text: string) =>
      validateAt(league, 15, team, text).autoTags.map((t) => t.id);
    expect(tagged("sleeper:5", "Eliminated in round one.")).toEqual([
      "knocked_out",
    ]);
    expect(tagged("sleeper:9", "Eliminated weeks ago.")).toEqual(["playoffs"]);
  });

  test.each([
    ["Baron Von Trade were eliminated in the first round.", "verified"],
    ["Red Zone Rascals got knocked out of the playoffs.", "verified"],
    [
      "[Baron Von Trade and Red Zone Rascals]{ev=wk.knocked_out} are out.",
      "verified",
    ],
    ["Frank's FAAB Fund were eliminated.", "wrong"],
    ["Bench Mob got knocked out of the bracket.", "wrong"],
  ])("in the intro: %s is %s", async (text, status) => {
    const claims = claimsAt(await committed(15), 15, null, text);
    expect(claims.map(([, s]) => s)).toEqual([status]);
  });

  test("a knocked-out team's stat line says so in place of the clinched wording, and it verifies", async () => {
    const league = await committed(15);
    const data = draftData(league, 15);
    const line = data.teams["sleeper:5"]?.statLine ?? "";
    expect(line.endsWith(" · [Knocked out]{ev=knocked_out}")).toBe(true);
    expect(line).not.toContain("Clinched");
    expect(data.teams["sleeper:4"]?.statLine).toMatch(
      / · \[Clinched a playoff spot\]\{ev=playoffs\}$/,
    );
    expect(claimsAt(league, 15, "sleeper:5", line).at(-1)).toEqual([
      "Knocked out",
      "verified",
    ]);
  });

  test("a team that missed the playoffs, or lost in the losers bracket, is eliminated and never knocked out", async () => {
    const league = await committed(15);
    const pack = draftData(league, 15).evidence;
    // Hail Mary Hustle (:9) had a bye; Gus Bus (:1) lost in the losers bracket.
    for (const id of ["sleeper:9", "sleeper:1"] as TeamId[]) {
      expect(pack.teams[id]?.playoffs, id).toBe("eliminated");
      expect(pack.teams[id], id).not.toHaveProperty("knocked_out");
      expect(draftData(league, 15).teams[id]?.statLine).toMatch(
        / · \[Eliminated\]\{ev=playoffs\}$/,
      );
    }
    expect(claimsAt(league, 15, "sleeper:1", "Eliminated.")).toEqual([
      ["Eliminated", "verified"],
    ]);
  });

  test("a two-week round undecided after its first week knocks nobody out", async () => {
    const league = await patched(15, {
      "": (l) => {
        l.settings.playoff_round_type = 2;
      },
      winners_bracket: (games) => {
        for (const g of games) {
          if (g.r === 1) {
            g.w = null;
            g.l = null;
          }
        }
      },
    });
    const pack = draftData(league, 15).evidence;
    for (const team of league.teams) {
      expect(pack.teams[team.id], team.id).not.toHaveProperty("knocked_out");
    }
    expect(pack.league).not.toHaveProperty("wk.knocked_out");
    expect(
      claimsAt(league, 15, "sleeper:5", "Eliminated in the first round."),
    ).toEqual([["Eliminated", "wrong"]]);
  });

  test("a decided two-week round knocks its loser out only in its last week", async () => {
    // Weeks 14 and 15 as one round: week 14 paired as week 15 is.
    const week15 = (await committed(15)).weeks.find((w) => w.week === 15);
    const matchupOf = new Map(
      week15?.matchups.flatMap((m, i) =>
        m.sides.map((s) => [Number(s.team.split(":")[1]), i + 1] as const),
      ),
    );
    const league = await patched(15, {
      "": (l) => {
        l.settings.playoff_round_type = 2;
        l.settings.playoff_week_start = 14;
      },
      "matchups/14": (rows) => {
        for (const m of rows) m.matchup_id = matchupOf.get(m.roster_id) ?? null;
      },
    });

    // Red Zone Rascals (:8) clinch after the shorter regular season, and the
    // bracket has them losing round 1 (both weeks carry the result).
    const first = draftData(league, 14).evidence;
    expect(first.teams["sleeper:8"]?.playoffs).toBe("clinched");
    expect(first.teams["sleeper:8"]).not.toHaveProperty("knocked_out");
    expect(first.league).not.toHaveProperty("wk.knocked_out");
    expect(
      claimsAt(league, 14, "sleeper:8", "Eliminated in the first round."),
    ).toEqual([["Eliminated", "wrong"]]);

    const last = draftData(league, 15).evidence;
    expect(last.teams["sleeper:8"]?.knocked_out).toBe(1);
    expect(last.league["wk.knocked_out"]).toContain("sleeper:8");
    expect(
      claimsAt(league, 15, "sleeper:8", "Eliminated in the first round."),
    ).toEqual([["Eliminated", "verified"]]);
  });

  test.each<[string, Json]>([
    ["median", { league_average_match: 1 }],
    ["divisions", { divisions: 2 }],
  ])(
    "in a league with %s a bracket loser is knocked out, with no playoffs",
    async (_, settings) => {
      const league = await patched(15, {
        "": (l) => {
          Object.assign(l.settings, settings);
        },
      });
      const pack = draftData(league, 15).evidence;
      expect(pack.teams["sleeper:5"]).not.toHaveProperty("playoffs");
      expect(pack.teams["sleeper:5"]?.knocked_out).toBe(1);
      expect(
        claimsAt(league, 15, "sleeper:5", "Eliminated in the first round."),
      ).toEqual([["Eliminated", "verified"]]);
    },
  );

  test("knocked out with an injury is no claim", async () => {
    const league = await committed(15);
    for (const team of [...league.teams.map((t) => t.id), null]) {
      const claims = claimsAt(
        league,
        15,
        team,
        "Their WR1 got knocked out with a hamstring.",
      );
      expect(claims.filter(([, s]) => isHard(s as ClaimStatus))).toEqual([]);
    }
  });
});
