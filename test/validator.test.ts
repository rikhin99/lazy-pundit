import { describe, expect, test } from "vitest";
import {
  applyAutoTags,
  gateLlm,
  isHard,
  stripTags,
  type ValidationResult,
  validate,
} from "../src/index.ts";
import {
  CLAIM_HEAVY,
  PLAIN_PROSE,
  TAGGED_PLAIN,
} from "./support/plain-prose.ts";
import { blurb, corrected, week8Evidence } from "./support/week8-evidence.ts";

/** What the pundit sees per claim: its text and status. */
function statuses(r: ValidationResult): [string, string][] {
  return r.claims.map((c) => [c.text, c.status]);
}

describe("grounding prototype scenarios, format A (tags in the file)", () => {
  test("happy path: every tagged claim checks out", () => {
    const r = validate(
      blurb(
        3,
        "[Seven straight]{ev=streak} and counting. Bench Mob [edged Snap Judgement]{ev=w8.result} by [2.71]{ev=w8.margin} to sit [7-1]{ev=record}, and they [lead the league in points]{ev=pf_rank} at [982.8]{ev=pf}.",
      ),
    );
    expect(statuses(r)).toEqual([
      ["Seven straight", "verified"],
      ["edged Snap Judgement", "verified"],
      ["2.71", "verified"],
      ["7-1", "verified"],
      ["lead the league in points", "verified"],
      ["982.8", "verified"],
    ]);
    expect(gateLlm(r).pass).toBe(true);
  });

  test("the LLM makes something up: a wrong value, then an uncited number, then a clean draft", () => {
    const madeUp = validate(
      blurb(
        2,
        "Wendy's Wire dropped [128.4]{ev=w8.points} and still [lost to Frank's FAAB Fund]{ev=w8.result}. Their [54-34]{ev=allplay} all-play record is [3rd]{ev=allplay_rank} in the league.",
      ),
    );
    expect(statuses(madeUp)).toEqual([
      ["128.4", "wrong"],
      ["lost to Frank's FAAB Fund", "verified"],
      ["54-34", "verified"],
      ["3rd", "verified"],
    ]);
    expect(madeUp.claims[0]?.reason).toBe("w8.points is 112.11");
    expect(gateLlm(madeUp).pass).toBe(false);

    const uncited = validate(
      blurb(
        2,
        "Wendy's Wire put up [112.1]{ev=w8.points} and still [lost to Frank's FAAB Fund]{ev=w8.result}, despite averaging 118.6 over the last three weeks.",
      ),
    );
    expect(statuses(uncited)).toEqual([
      ["112.1", "verified"],
      ["lost to Frank's FAAB Fund", "verified"],
      ["118.6", "verified"],
    ]);
    expect(gateLlm(uncited)).toEqual({
      pass: false,
      claims: [expect.objectContaining({ text: "118.6", tagged: false })],
      swears: [],
      stakesMentions: [],
    });

    const clean = validate(
      blurb(
        2,
        "Wendy's Wire put up [112.1]{ev=w8.points} and still [lost to Frank's FAAB Fund]{ev=w8.result} by [9.27]{ev=w8.margin}. The [54-34]{ev=allplay} all-play record says this team is better than [3-5]{ev=record}: luck has cost them [nearly two wins]{ev=luck}.",
      ),
    );
    expect(clean.claims.every((c) => c.status === "verified")).toBe(true);
    expect(clean.claims).toHaveLength(6);
    expect(gateLlm(clean).pass).toBe(true);
  });

  test("an ID that isn't in the evidence pack", () => {
    const r = validate(blurb(3, "They are [7-1]{ev=recrod}."));
    expect(statuses(r)).toEqual([["7-1", "unknown-id"]]);
  });

  test("stat correction after drafting: claims that held go stale with cause refresh", () => {
    const text =
      "Gus dropped a [week-high]{ev=w8.rank} [133.22]{ev=w8.points} on Pete, winning by [55]{ev=w8.margin} to get back to [4-4]{ev=record}.";
    expect(
      validate(blurb(1, text)).claims.every((c) => c.status === "verified"),
    ).toBe(true);
    const after = validate(
      blurb(1, text, {
        evidence: corrected(1, 1.8),
        before: { evidence: [week8Evidence()] },
      }),
    );
    expect(after.claims.map((c) => [c.text, c.status, c.cause])).toEqual([
      ["week-high", "verified", undefined],
      ["133.22", "stale", "refresh"],
      ["55", "stale", "refresh"],
      ["4-4", "verified", undefined],
    ]);
  });
});

describe("grounding prototype scenarios, pundit prose", () => {
  test("the pundit rounds a tagged number, gets it wrong, then rewrites with no tags", () => {
    const drafted =
      "[Seven straight]{ev=streak} and counting. Bench Mob [edged Snap Judgement]{ev=w8.result} by [2.71]{ev=w8.margin} to sit [7-1]{ev=record}.";
    const rounded = validate(blurb(3, drafted.replace("2.71", "3")));
    expect(rounded.claims[2]).toMatchObject({ text: "3", status: "verified" });
    const mistaken = validate(blurb(3, drafted.replace("2.71", "5")));
    expect(mistaken.claims[2]).toMatchObject({
      text: "5",
      status: "wrong",
      reason: "w8.margin is 2.71",
    });

    const rewrite =
      "Bo's Mob are 7-1 on a seven-game heater. They squeaked past Snappers by 3 and nobody in this league has scored more. Still frauds.";
    const r = validate(blurb(3, rewrite));
    expect(statuses(r)).toEqual([
      ["7-1", "verified"],
      ["seven-game heater", "verified"],
      ["squeaked past Snappers", "verified"],
      ["3", "verified"],
    ]);
    expect(applyAutoTags(rewrite, r.autoTags)).toBe(
      "Bo's Mob are [7-1]{ev=record} on a [seven-game heater]{ev=streak}. They [squeaked past Snappers]{ev=w8.result} by [3]{ev=w8.margin} and nobody in this league has scored more. Still frauds.",
    );
  });

  test("the pundit gets a fact wrong, then fixes it", () => {
    const wrong = validate(
      blurb(6, "Pete lost by 30 to Gus and is now 2-6. Three straight losses."),
    );
    expect(wrong.claims.map((c) => [c.text, c.status, c.reason])).toEqual([
      ["30", "wrong", "w8.margin is 55"],
      ["2-6", "wrong", "record is 3-5, allplay is 31-57"],
      ["Three straight losses", "verified", "streak is L3"],
    ]);
    const fixed = validate(
      blurb(6, "Pete got smoked by 55 and is now 3-5. Three straight losses."),
    );
    expect(statuses(fixed)).toEqual([
      ["55", "verified"],
      ["3-5", "verified"],
      ["Three straight losses", "verified"],
    ]);
  });

  test("claims about other teams: naming a team lends its stats to the sentence", () => {
    const r = validate(
      blurb(
        7,
        "Kim Possible Kicks beat Red Zone Rascals 101.56-95.38 for a second straight win, while Bench Mob sit at 7-1 in first.",
      ),
    );
    expect(statuses(r)).toEqual([
      ["beat Red Zone Rascals", "verified"],
      ["101.56-95.38", "verified"],
      ["second straight win", "verified"],
      ["7-1", "verified"],
      ["first", "verified"],
    ]);
    expect(r.claims[3]?.id).toBe("sleeper:3/record");

    const misremembered = validate(
      blurb(
        7,
        "Kim Possible Kicks beat Bye Bye Bea 101.56-95.38 for a second straight win, while Bench Mob sit at 8-0 in first.",
      ),
    );
    expect(
      misremembered.claims.map((c) => [c.text, c.status, c.reason]),
    ).toEqual([
      ["beat Bye Bye Bea", "wrong", "w8.opponent is Red Zone Rascals"],
      ["101.56-95.38", "verified", "week 8 score was 101.56-95.38"],
      ["second straight win", "verified", "streak is W2"],
      ["8-0", "wrong", "sleeper:3/record is 7-1, sleeper:3/allplay is 62-26"],
      ["first", "verified", "sleeper:3/standing is 1, sleeper:3/place is 1"],
    ]);
  });

  test("a claim's team: the team a result is against doesn't lend its stats", () => {
    const judged = (text: string) =>
      validate(blurb(6, text)).claims.map((c) => [
        c.text,
        c.status,
        c.reason,
        c.id,
      ]);
    // Gus Bus is 4-4, sixth, with 876.16 points for; Pylon Patrol is 3-5,
    // eleventh, with 806.48.
    expect(judged("Pete lost to Gus Bus by 55 and sits at 4-4.")).toEqual([
      [
        "lost to Gus Bus",
        "verified",
        "w8.result is L against Gus Bus",
        "w8.result",
      ],
      ["55", "verified", "w8.margin is 55", "w8.margin"],
      ["4-4", "wrong", "record is 3-5, allplay is 31-57", undefined],
    ]);
    expect(judged("Pete lost to Gus Bus by 55 and sits in sixth.")).toEqual([
      [
        "lost to Gus Bus",
        "verified",
        "w8.result is L against Gus Bus",
        "w8.result",
      ],
      ["55", "verified", "w8.margin is 55", "w8.margin"],
      ["sixth", "wrong", "standing is 11, place is 11", undefined],
    ]);
    expect(
      judged("Pete lost to Gus Bus by 55 and has 876.16 points for."),
    ).toEqual([
      [
        "lost to Gus Bus",
        "verified",
        "w8.result is L against Gus Bus",
        "w8.result",
      ],
      ["55", "verified", "w8.margin is 55", "w8.margin"],
      ["876.16", "wrong", "pf is 806.48", undefined],
    ]);
  });

  test("a claim's team: a team named beside the claim is its team", () => {
    const judged = (text: string) =>
      validate(blurb(6, text)).claims.map((c) => [c.text, c.status, c.id]);
    expect(judged("Gus Bus, at 4-4, sit in sixth.")).toEqual([
      ["4-4", "verified", "sleeper:1/record"],
      ["sixth", "verified", undefined],
    ]);
    expect(judged("Pete lost to Gus Bus (4-4) by 55.")).toEqual([
      ["lost to Gus Bus", "verified", "w8.result"],
      ["4-4", "verified", "sleeper:1/record"],
      ["55", "verified", "w8.margin"],
    ]);
    expect(judged("Pete trails Bench Mob, who sit at 7-1.")).toEqual([
      ["7-1", "verified", "sleeper:3/record"],
    ]);
    expect(judged("Pete fell to Gus Bus, who are 4-4 now.")).toEqual([
      ["fell to Gus Bus", "verified", "w8.result"],
      ["4-4", "verified", "sleeper:1/record"],
    ]);
    expect(judged("At 7-1, Bench Mob lead the league.")).toEqual([
      ["7-1", "verified", "sleeper:3/record"],
    ]);
  });

  test("a claim's team: a pronoun or a name in a later clause is the section's team again", () => {
    const judged = (text: string) =>
      validate(blurb(6, text)).claims.map((c) => [c.text, c.status, c.id]);
    expect(judged("Gus Bus beat us by 55, and we sit at 3-5.")).toEqual([
      ["55,", "verified", "sleeper:1/w8.margin"],
      ["3-5", "verified", "record"],
    ]);
    expect(judged("While Bench Mob sit at 7-1, we are 3-5.")).toEqual([
      ["7-1", "verified", "sleeper:3/record"],
      ["3-5", "verified", "record"],
    ]);
    expect(
      judged("Bench Mob are 7-1; meanwhile this team sits at 3-5 in 11th."),
    ).toEqual([
      ["7-1", "verified", "sleeper:3/record"],
      ["3-5", "verified", "record"],
      ["11th", "verified", undefined],
    ]);
    expect(judged("Gus Bus won by 55 and the loss leaves them 3-5.")).toEqual([
      ["55", "verified", "sleeper:1/w8.margin"],
      ["3-5", "verified", "record"],
    ]);
    expect(judged("Bench Mob lead, with Pete at 3-5.")).toEqual([
      ["3-5", "verified", "record"],
    ]);
  });
});

describe("grounding prototype scenarios, format B (tags stripped, prose matched)", () => {
  test("happy path: a number with no stat named is only a loose match", () => {
    const r = validate(
      blurb(
        3,
        stripTags(
          "[Seven straight]{ev=streak} and counting. Bench Mob [edged Snap Judgement]{ev=w8.result} by [2.71]{ev=w8.margin} to sit [7-1]{ev=record}, and they [lead the league in points]{ev=pf_rank} at [982.8]{ev=pf}.",
        ),
      ),
    );
    expect(statuses(r)).toEqual([
      ["Seven straight", "verified"],
      ["edged Snap Judgement", "verified"],
      ["2.71", "verified"],
      ["7-1", "verified"],
      ["982.8", "loose"],
    ]);
    expect(r.claims[4]?.reason).toBe(
      "matches pf is 982.81, but the sentence doesn't say which stat",
    );
  });

  test("the clean LLM draft verifies as prose too", () => {
    const r = validate(
      blurb(
        2,
        "Wendy's Wire put up 112.1 and still lost to Frank's FAAB Fund by 9.27. The 54-34 all-play record says this team is better than 3-5: luck has cost them nearly two wins.",
      ),
    );
    expect(r.claims.map((c) => [c.text, c.status, c.id])).toEqual([
      ["112.1", "verified", "w8.points"],
      ["lost to Frank's FAAB Fund", "verified", "w8.result"],
      ["9.27", "verified", "w8.margin"],
      ["54-34", "verified", "allplay"],
      ["3-5", "verified", "record"],
      ["nearly two wins", "verified", "luck"],
    ]);
  });

  test("stat correction: untagged claims go stale too", () => {
    const text =
      "Gus dropped a week-high 133.22 on Pete, winning by 55 to get back to 4-4.";
    const r = validate(
      blurb(1, text, {
        evidence: corrected(1, 1.8),
        before: { evidence: [week8Evidence()] },
      }),
    );
    expect(r.claims.map((c) => [c.text, c.status, c.cause])).toEqual([
      ["133.22", "stale", "refresh"],
      ["55", "stale", "refresh"],
      ["4-4", "verified", undefined],
    ]);
    expect(r.claims[0]?.reason).toBe(
      "true when written (w8.points is 133.22); now w8.points is 135.02",
    );
  });

  test("claims about other teams, from the LLM's tags", () => {
    const tagged =
      "Kim Possible Kicks [beat Red Zone Rascals]{ev=w8.result} [101.56]{ev=w8.points}-[95.38]{ev=w8.opp_points} for a [second straight win]{ev=streak}, while Bench Mob sit at [7-1]{ev=sleeper:3/record} in [first]{ev=sleeper:3/standing}.";
    expect(
      validate(blurb(7, tagged)).claims.every((c) => c.status === "verified"),
    ).toBe(true);
    const r = validate(blurb(7, stripTags(tagged)));
    expect(r.claims.every((c) => c.status === "verified")).toBe(true);
  });
});

/** The one claim the text holds, as [words, status, evidence ID]. */
function only(team: number | null, text: string, over = {}) {
  const r = validate(blurb(team, text, over));
  return r.claims.map((c) => [c.text, c.status, c.id]);
}

describe("cue words pick the stat", () => {
  test.each([
    // Bench Mob: w8 126.89 by 2.71, pf 982.81, form3 135.04, pa 805.86, high 162.9, low 70.02
    ["They scored 126.89.", "126.89", "w8.points"],
    ["They put up 126.9 on Sunday.", "126.9", "w8.points"],
    ["They won by 2.71.", "2.71", "w8.margin"],
    ["The margin was 2.71.", "2.71", "w8.margin"],
    ["A season-high 162.9 back in week 6.", "162.9", "high"],
    ["Their low is 70.02.", "70.02", "low"],
    ["982.81 points for on the year.", "982.81", "pf"],
    ["They're averaging 135.04 lately.", "135.04", "form3"],
    ["They're averaging 122.85 per week.", "122.85", "ppg"],
    ["They average 122.85 per game.", "122.85", "ppg"],
    ["Averaging 122.85 on the year.", "122.85", "ppg"],
    ["Averaging 135.04 over the last three.", "135.04", "form3"],
    ["135.04 over their last three.", "135.04", "form3"],
    ["Averaging 122.85 per game; the last three were rough.", "122.85", "ppg"],
    ["They've allowed 805.86.", "805.86", "pa"],
  ])("%s", (text, words, id) => {
    expect(only(3, text)).toEqual([[words, "verified", id]]);
  });

  test("a season average that's off is checked against ppg, not form", () => {
    const r = validate(blurb(3, "They're averaging 118 per week."));
    expect(r.claims.map((c) => [c.text, c.status, c.reason])).toEqual([
      ["118", "wrong", "ppg is 122.85"],
    ]);
  });

  test("the nearest cue wins: 'by' after 'scored'", () => {
    expect(only(3, "They scored 126.89 and won by 2.71.")).toEqual([
      ["126.89", "verified", "w8.points"],
      ["2.71", "verified", "w8.margin"],
    ]);
  });

  test("a cue with the wrong number is wrong, not loose", () => {
    expect(only(3, "They scored 140.")).toEqual([["140", "wrong", undefined]]);
  });

  test("a week number or a year is not a claim", () => {
    expect(only(3, "Back in week 6 of the 2025 season.")).toEqual([]);
  });

  test("a number matching nothing is unchecked", () => {
    expect(only(3, "That's 4444 reasons to worry.")).toEqual([
      ["4444", "unchecked", undefined],
    ]);
  });
});

describe("the player a player fact names", () => {
  // Bench Mob, week 8: top Jonathan Taylor 38.4, zeros Quentin Johnston,
  // benchmiss Tyjae Spears 16.7, opp.top Tucker Kraft 31.8.
  const checked = (text: string, team = 3) =>
    validate(blurb(team, text)).claims.map((c) => [c.status, c.reason]);

  test.each([
    [
      "[Bijan Robinson's 38.4]{ev=w8.top_points} carried them.",
      "names Bijan Robinson, but w8.top is Jonathan Taylor",
    ],
    [
      "[Bijan Robinson]{ev=w8.top} carried them.",
      "names Bijan Robinson, but w8.top is Jonathan Taylor",
    ],
    [
      "[DJ Moore put up 38.4]{ev=w8.top_points} for them.",
      "names DJ Moore, but w8.top is Jonathan Taylor",
    ],
    [
      "[DJ Moore]{ev=w8.top} carried them.",
      "names DJ Moore, but w8.top is Jonathan Taylor",
    ],
    [
      "[Travis Kelce]{ev=w8.zeros} gave them nothing.",
      "names Travis Kelce, but w8.zeros is Quentin Johnston",
    ],
    [
      "[Chase Brown's 16.7]{ev=w8.benchmiss_points} sat on the bench.",
      "names Chase Brown, but w8.benchmiss is Tyjae Spears",
    ],
    [
      "[38.4 from Spears]{ev=w8.top_points} carried them.",
      "names Spears, but w8.top is Jonathan Taylor",
    ],
    [
      "[Kittle]{ev=w8.opp.top} hurt them.",
      "names Kittle, but w8.opp.top is Tucker Kraft",
    ],
    [
      "[George Kittle's 31.8]{ev=w8.opp.top_points} hurt them.",
      "names George Kittle, but w8.opp.top is Tucker Kraft",
    ],
  ])("naming another player is wrong: %s", (text, reason) => {
    const r = validate(blurb(3, text));
    expect(r.claims.map((c) => [c.status, c.reason])).toEqual([
      ["wrong", reason],
    ]);
    expect(isHard(r.claims[0]?.status ?? "verified")).toBe(true);
  });

  test("another team's player fact names that team's ID", () => {
    expect(
      checked("[Bijan Robinson]{ev=sleeper:3/w8.top} went off.", 12),
    ).toEqual([
      [
        "wrong",
        "names Bijan Robinson, but sleeper:3/w8.top is Jonathan Taylor",
      ],
    ]);
    expect(checked("[Taylor]{ev=sleeper:3/w8.top} went off.", 12)).toEqual([
      ["verified", "sleeper:3/w8.top is Jonathan Taylor"],
    ]);
  });

  test.each([
    "[Jonathan Taylor's 38.4]{ev=w8.top_points} carried them.",
    "[Taylor's 38.4]{ev=w8.top_points} carried them.",
    "[38.4]{ev=w8.top_points} from their best starter.",
    "[Jonathan Taylor]{ev=w8.top} carried them.",
    "[Taylor]{ev=w8.top} carried them.",
    "[Johnston]{ev=w8.zeros} gave them nothing.",
    "[Spears' 16.7]{ev=w8.benchmiss_points} sat on the bench.",
    "[Tucker Kraft]{ev=w8.opp.top} hurt them.",
    "[Kraft's 31.8]{ev=w8.opp.top_points} hurt them.",
    "[Bench Mob's Jonathan Taylor]{ev=w8.top} carried them.",
    "[Bench Mob's 38.4]{ev=w8.top_points} from their best starter.",
    "[Sunday's 38.4]{ev=w8.top_points} carried them.",
    "[MVP Taylor]{ev=w8.top} carried them.",
    "[Colts Jonathan Taylor]{ev=w8.top} carried them.",
    "[RB Taylor]{ev=w8.top} carried them.",
    "[The Bench Mob's 38.4]{ev=w8.top_points} from their best starter.",
    "[The Mob's 38.4]{ev=w8.top_points} from their best starter.",
    // a lone word no player in the pack holds is never read as a player
    "[Indy's 38.4]{ev=w8.top_points} carried them.",
    "[Robinson's 38.4]{ev=w8.top_points} carried them.",
    "[38.4 against the Texans]{ev=w8.top_points} carried them.",
  ])("naming the right player, or none, passes: %s", (text) => {
    expect(checked(text)).toEqual([["verified", expect.any(String)]]);
  });

  test("a zero list holds each of its players", () => {
    const pack = week8Evidence();
    (pack.teams["sleeper:9"] as Record<string, string>)["w8.zeros"] =
      "Jake Ferguson and Quentin Johnston";
    const r = (text: string) =>
      validate(blurb(9, text, { evidence: pack })).claims.map((c) => [
        c.status,
        c.reason,
      ]);
    expect(r("[Ferguson]{ev=w8.zeros} gave them nothing.")).toEqual([
      ["verified", expect.any(String)],
    ]);
    expect(r("[Quentin Johnston]{ev=w8.zeros} gave them nothing.")).toEqual([
      ["verified", expect.any(String)],
    ]);
    expect(r("[Travis Kelce]{ev=w8.zeros} gave them nothing.")).toEqual([
      [
        "wrong",
        "names Travis Kelce, but w8.zeros is Jake Ferguson and Quentin Johnston",
      ],
    ]);
  });

  test("the right player with the wrong points is wrong on the points", () => {
    expect(checked("[Taylor's 40]{ev=w8.top_points} carried them.")).toEqual([
      ["wrong", "w8.top_points is 38.4"],
    ]);
  });
});

describe("hedges and rounding", () => {
  test.each([
    ["They scored 127.", "127", "verified"],
    ["They scored 126.9.", "126.9", "verified"],
    ["They scored 126.8.", "126.8", "wrong"],
    ["They scored 126.", "126", "wrong"],
    ["They scored nearly 130.", "nearly 130", "verified"],
    ["They scored about 120.", "about 120", "wrong"],
    ["They scored over 120.", "over 120", "verified"],
    ["They scored over 130.", "over 130", "wrong"],
    ["They scored under 130.", "under 130", "verified"],
    ["982 points for on the year.", "982", "wrong"],
    ["More than 950 points for on the year.", "More than 950", "verified"],
  ])("%s", (text, words, status) => {
    expect(only(3, text).map(([w, s]) => [w, s])).toEqual([[words, status]]);
  });

  test("luck is compared by size, not sign", () => {
    // Wendy's Wire: luck -1.91
    expect(only(2, "Luck has cost them 1.91 wins.")).toEqual([
      ["1.91", "verified", "luck"],
    ]);
    expect(only(2, "[1.9 wins of bad luck]{ev=luck}")).toEqual([
      ["1.9 wins of bad luck", "verified", "luck"],
    ]);
  });

  test("a tagged hedge: [over 950]", () => {
    expect(only(3, "[over 950]{ev=pf} points")).toEqual([
      ["over 950", "verified", "pf"],
    ]);
    expect(only(3, "[over 990]{ev=pf} points")).toEqual([
      ["over 990", "wrong", "pf"],
    ]);
  });
});

describe("bullets are units", () => {
  test("a bullet's team doesn't leak into the next bullet", () => {
    // Kim Possible Kicks is 3-5; Bench Mob is 7-1.
    const text = "- Bench Mob are 7-1\n- 7-1 would be nice";
    expect(only(7, text).map(([w, s]) => [w, s])).toEqual([
      ["7-1", "verified"],
      ["7-1", "wrong"],
    ]);
  });

  test("bullets with no full stop are still separate", () => {
    const text = "* They scored 101.56\n* A second straight win";
    expect(only(7, text)).toEqual([
      ["101.56", "verified", "w8.points"],
      ["second straight win", "verified", "streak"],
    ]);
  });

  test("a wrapped prose line stays one sentence", () => {
    const text = "Bench Mob\nare 7-1.";
    expect(only(7, text)).toEqual([["7-1", "verified", "sleeper:3/record"]]);
  });
});

describe("nicknames lend stats", () => {
  test("a lore nickname, a manager's name or the team name all count", () => {
    expect(only(7, "Snappers are 4-4.")).toEqual([
      ["4-4", "verified", "sleeper:12/record"],
    ]);
    expect(only(7, "snap_count_sam is 4-4.")).toEqual([
      ["4-4", "verified", "sleeper:12/record"],
    ]);
  });

  test("a nickname matches only as whole words", () => {
    // "Bo" must not match inside "Bonus"; Kim Possible Kicks is 3-5, Bench Mob 7-1
    expect(only(7, "Bonus points: 7-1.").map(([w, s]) => [w, s])).toEqual([
      ["7-1", "wrong"],
    ]);
  });

  test("a team's own name is never a claim", () => {
    const over = {
      nicknames: { ...blurb(1, "").nicknames, "sleeper:1": ["Area 51"] },
    };
    expect(only(1, "Area 51 rolls on.", over)).toEqual([]);
  });

  test("a league item's team is checked by name", () => {
    const r = validate(
      blurb(
        null,
        "Week high: [Gus Bus]{ev=wk.high_team} [133.22]{ev=wk.high}. Week low: [Bench Mob]{ev=wk.low_team}.",
      ),
    );
    expect(r.claims.map((c) => [c.text, c.status, c.reason])).toEqual([
      ["Gus Bus", "verified", expect.any(String)],
      ["133.22", "verified", expect.any(String)],
      ["Bench Mob", "wrong", "wk.low_team is Hail Mary Hustle"],
    ]);
  });

  test("a week intro has no section team: only named teams count", () => {
    expect(only(null, "Bench Mob are 7-1 and Hal is 1-7.")).toEqual([
      ["7-1", "verified", "sleeper:3/record"],
      ["1-7", "verified", "sleeper:9/record"],
    ]);
  });
});

describe("ordinals split between a stat and place", () => {
  // Wendy's Wire: place 8 (standing order), pf_rank 3, allplay_rank 3, form_rank 3, w8.rank 6
  test.each([
    ["3rd in points.", "3rd", "verified", "pf_rank"],
    ["3rd in all-play.", "3rd", "verified", "allplay_rank"],
    ["6th-best score this week.", "6th", "verified", "w8.rank"],
    ["Ranked 8th.", "8th", "verified", "place"],
    ["Ranked 3rd.", "3rd", "wrong", undefined],
    ["#8 for a reason.", "#8", "verified", "place"],
    ["No. 8 for a reason.", "No. 8", "verified", "place"],
    ["#3 for a reason.", "#3", "wrong", undefined],
    ["Bottom 5 again.", "Bottom 5", "verified", "place"],
    ["Top 5 again.", "Top 5", "wrong", undefined],
    ["Top 3 in scoring.", "Top 3", "verified", "pf_rank"],
    ["8th in the standings.", "8th", "verified", "standing"],
  ])("%s", (text, words, status, id) => {
    expect(only(2, text)).toEqual([[words, status, id]]);
  });

  test("an ordinal with no cue is a loose match at best", () => {
    expect(only(2, "Somehow 3rd.")).toEqual([["3rd", "loose", undefined]]);
  });

  test("a word ordinal with no cue isn't a claim", () => {
    expect(only(2, "Their first good week in a month.")).toEqual([]);
  });

  test("a place claim goes stale with cause reorder when the pundit moves the team", () => {
    const r = validate(
      blurb(2, "Up at [#5]{ev=place} now.", {
        order: blurb(2, "").order,
        before: {
          order: { ...blurb(2, "").order, "sleeper:2": { place: 5, move: 0 } },
        },
      }),
    );
    expect(r.claims.map((c) => [c.status, c.cause])).toEqual([
      ["stale", "reorder"],
    ]);
  });

  test("with no order evidence, a place claim is unchecked", () => {
    expect(only(2, "#8 for a reason.", { order: {} })).toEqual([
      ["#8", "unchecked", undefined],
    ]);
  });
});

describe("movement wording", () => {
  const moved = (move: number | "new") => ({
    order: { ...blurb(2, "").order, "sleeper:2": { place: 8, move } },
  });

  test.each([
    ["Wendy's Wire climbs 2 spots.", 2, "climbs 2 spots", "verified"],
    ["Rises two places this week.", 2, "Rises two places", "verified"],
    ["Up 2 after the win.", 2, "Up 2", "verified"],
    ["Falls 3 spots.", -3, "Falls 3 spots", "verified"],
    ["Down 3 after that.", -3, "Down 3", "verified"],
    ["Climbs 3 spots.", 2, "Climbs 3 spots", "wrong"],
    ["Drops 2 spots.", 2, "Drops 2 spots", "wrong"],
  ])("%s (move %s)", (text, move, words, status) => {
    expect(only(2, text, moved(move)).map(([w, s]) => [w, s])).toEqual([
      [words, status],
    ]);
  });

  test("points wording is not movement", () => {
    expect(only(3, "They put up 127 and dropped 126.89 on Sam.")).toEqual([
      ["127", "verified", "w8.points"],
      ["126.89", "verified", "w8.points"],
    ]);
  });

  test("a numeric movement claim about a new team is wrong; 'debuts' is verified", () => {
    expect(only(2, "Climbs 2 spots.", moved("new"))).toEqual([
      ["Climbs 2 spots", "wrong", undefined],
    ]);
    expect(
      validate(blurb(2, "Climbs 2 spots.", moved("new"))).claims[0]?.reason,
    ).toBe("move is new: the team has no earlier place");
    expect(only(2, "Wendy's Wire debuts at #8.", moved("new"))).toEqual([
      ["debuts", "verified", "move"],
      ["#8", "verified", "place"],
    ]);
    expect(only(2, "Wendy's Wire debuts at #8.", moved(1))[0]).toEqual([
      "debuts",
      "wrong",
      undefined,
    ]);
  });
});

describe("group wording", () => {
  const grouped = {
    order: Object.fromEntries(
      Object.entries(blurb(2, "").order).map(([t, o]) => [
        t,
        { ...o, group: o.place <= 4 ? "Contenders" : "Tier 2" },
      ]),
    ),
  };

  test("a group heading's text is checked against the team's group", () => {
    expect(only(3, "Real Contenders.", grouped)).toEqual([
      ["Contenders", "verified", "group"],
    ]);
    expect(only(2, "Real Contenders.", grouped)).toEqual([
      ["Contenders", "wrong", undefined],
    ]);
  });

  test("a tier with a number is checked against the group's number", () => {
    expect(only(2, "Second-tier team.", grouped)).toEqual([
      ["Second-tier", "verified", "group"],
    ]);
    expect(only(3, "Tier 2 at best.", grouped)).toEqual([
      ["Tier 2", "wrong", undefined],
    ]);
  });

  test("top and bottom tier mean the first and last groups", () => {
    expect(only(3, "Top tier, no question.", grouped)).toEqual([
      ["Top tier", "verified", "group"],
    ]);
    expect(only(2, "Top tier, no question.", grouped)).toEqual([
      ["Top tier", "wrong", undefined],
    ]);
    expect(only(2, "Bottom tier again.", grouped)).toEqual([
      ["Bottom tier", "verified", "group"],
    ]);
  });

  test("with no groups, tier wording is unchecked", () => {
    expect(only(2, "A second-tier team.")).toEqual([
      ["second-tier", "unchecked", undefined],
    ]);
  });
});

describe("playoff words", () => {
  const settled = (playoffs: string) => {
    const evidence = week8Evidence();
    (evidence.teams["sleeper:3"] as Record<string, string | number>).playoffs =
      playoffs;
    return { evidence };
  };

  test.each([
    ["Bench Mob have clinched.", "clinched", "clinched", "verified"],
    [
      "Clinched a playoff spot.",
      "clinched",
      "Clinched a playoff spot",
      "verified",
    ],
    ["They clinched a bye.", "clinched_bye", "clinched a bye", "verified"],
    ["They clinched a spot.", "clinched_bye", "clinched a spot", "verified"],
    ["They clinched a bye.", "clinched", "clinched a bye", "wrong"],
    ["Already eliminated.", "clinched", "eliminated", "wrong"],
    ["Already eliminated.", "eliminated", "eliminated", "verified"],
  ])("%s (playoffs: %s)", (text, value, words, status) => {
    expect(only(3, text, settled(value)).map(([w, s]) => [w, s])).toEqual([
      [words, status],
    ]);
  });

  test.each([
    ["[Clinched a bye]{ev=playoffs}", "clinched_bye", "verified"],
    ["[Clinched a bye]{ev=playoffs}", "clinched", "wrong"],
    ["[Clinched a playoff spot]{ev=playoffs}", "clinched_bye", "verified"],
    ["[Eliminated]{ev=playoffs}", "eliminated", "verified"],
    ["[Eliminated]{ev=playoffs}", "clinched", "wrong"],
    ["[Bye Bye Bea clinched]{ev=playoffs}", "clinched", "verified"],
  ])("the tag %s against %s is %s", (text, value, status) => {
    const r = validate(blurb(3, text, settled(value)));
    expect(r.claims.map((c) => c.status)).toEqual([status]);
  });

  test.each([
    ["[clinched a first round bye]{ev=playoffs}", "clinched", "wrong"],
    ["[clinched a first round bye]{ev=playoffs}", "clinched_bye", "verified"],
    ["They clinched a first round bye.", "clinched", "wrong"],
    ["[won out]{ev=playoffs}", "eliminated", "wrong"],
    ["[mathematically out]{ev=playoffs}", "eliminated", "verified"],
    ["[playoff lock]{ev=playoffs}", "clinched", "unchecked"],
    ["[in the hunt]{ev=playoffs}", "clinched", "unchecked"],
  ])("%s against %s is %s", (text, value, status) => {
    const r = validate(blurb(3, text, settled(value)));
    expect(r.claims.map((c) => c.status)).toEqual([status]);
  });

  test("a tagged loose phrase is unchecked even with no settled status", () => {
    const r = validate(blurb(3, "[playoff lock]{ev=playoffs}"));
    expect(r.claims.map((c) => c.status)).toEqual(["unchecked"]);
  });

  describe("a tag on wk.clinched, which can hold several teams", () => {
    const clinched = () => {
      const evidence = week8Evidence();
      evidence.league["wk.clinched"] = "sleeper:3,sleeper:11";
      return { evidence };
    };
    test.each([
      ["[Bench Mob and Bye Bye Bea]{ev=wk.clinched}", "verified"],
      ["[Bye Bye Bea]{ev=wk.clinched}", "verified"],
      ["[Bench Mob and Gus Bus]{ev=wk.clinched}", "wrong"],
      ["[Gus Bus]{ev=wk.clinched}", "wrong"],
    ])("%s is %s", (text, status) => {
      const r = validate(blurb(null, text, clinched()));
      expect(r.claims.map((c) => c.status)).toEqual([status]);
    });

    test.each([
      ["[Clinched this week: Bench Mob]{ev=wk.clinched}", "verified"],
      ["[Clinched this week: Gus Bus]{ev=wk.clinched}", "wrong"],
      // Only the stat line's own label is dropped, not whatever is before a colon.
      ["[Gus Bus clinched: Bench Mob too]{ev=wk.clinched}", "wrong"],
    ])(
      "with a nickname that's a word in the label, %s is %s",
      (text, status) => {
        const nicknames = {
          ...blurb(null, "").nicknames,
          "sleeper:9": ["Hail Mary Hustle", "Week"],
        };
        const r = validate(blurb(null, text, { ...clinched(), nicknames }));
        expect(r.claims.map((c) => c.status)).toEqual([status]);
      },
    );

    test("a team name holding a colon is still read whole", () => {
      const nicknames = {
        ...blurb(null, "").nicknames,
        "sleeper:3": ["Mob: Reloaded"],
      };
      const r = validate(
        blurb(null, "[Clinched this week: Mob: Reloaded]{ev=wk.clinched}", {
          ...clinched(),
          nicknames,
        }),
      );
      expect(r.claims.map((c) => c.status)).toEqual(["verified"]);
    });

    test("a wrong claim's reason names the teams", () => {
      const r = validate(blurb(null, "[Gus Bus]{ev=wk.clinched}", clinched()));
      expect(r.claims[0]?.reason).toBe("wk.clinched is Bench Mob, Bye Bye Bea");
    });
  });

  test("a matching playoff claim is auto-tagged", () => {
    const r = validate(
      blurb(3, "They clinched a bye.", settled("clinched_bye")),
    );
    expect(applyAutoTags("They clinched a bye.", r.autoTags)).toBe(
      "They [clinched a bye]{ev=playoffs}.",
    );
  });

  test("playoff words about a team with no settled status are wrong", () => {
    const r = validate(blurb(3, "Bench Mob have clinched."));
    expect(r.claims.map((c) => [c.text, c.status, c.reason])).toEqual([
      [
        "clinched",
        "wrong",
        "no settled playoff status: it still depends on matchups to come",
      ],
    ]);
  });

  test("looser phrases stay unchecked", () => {
    expect(only(3, "A playoff lock, surely.")).toEqual([
      ["playoff lock", "unchecked", undefined],
    ]);
  });

  test("a team named Bye Bye Bea is not a playoff bye", () => {
    expect(only(11, "Bye Bye Bea rolls on.")).toEqual([]);
  });
});

describe("lore, stakes and log citations are checked only for existence", () => {
  const sections = {
    sections: { lore: ["manager:bo"], stakes: ["payouts"], log: ["w7"] },
  };

  test("an existing section is verified and its words aren't scanned", () => {
    expect(
      only(
        3,
        "[Bo still owes 50 bucks]{lore=manager:bo} after [the 3rd-place payout]{stakes=payouts} and [week 7's punishment]{log=w7}.",
        sections,
      ),
    ).toEqual([
      ["Bo still owes 50 bucks", "verified", "lore=manager:bo"],
      ["the 3rd-place payout", "verified", "stakes=payouts"],
      ["week 7's punishment", "verified", "log=w7"],
    ]);
  });

  test("a missing section is an unknown ID", () => {
    expect(only(3, "[as foretold]{lore=manager:nobody}", sections)).toEqual([
      ["as foretold", "unknown-id", "lore=manager:nobody"],
    ]);
  });
});

describe("not seen at all", () => {
  test.each([
    "Still frauds.",
    "Nobody in this league has scored more.",
    "The best team in the league, and it isn't close.",
    "They lead the league in points and vibes.",
    "Dead last in our hearts.",
    "Bo has been insufferable in the group chat since the trade.",
    "Their first good week in a month, and the bench finally showed up.",
  ])("%s", (text) => {
    expect(validate(blurb(3, text)).claims).toEqual([]);
  });
});

describe("auto-tag", () => {
  const texts = [
    "Bo's Mob are 7-1 on a seven-game heater. They squeaked past Snappers by 3 and nobody in this league has scored more. Still frauds.",
    "Kim Possible Kicks beat Red Zone Rascals 101.56-95.38 for a second straight win, while Bench Mob sit at 7-1 in first.",
    "Wendy's Wire put up 112.1 and still lost to Frank's FAAB Fund by 9.27. The 54-34 all-play record says this team is better than 3-5: luck has cost them nearly two wins.",
    "- Pete got smoked by 55\n- now 3-5, three straight losses\n\nRanked 11th.",
  ];

  test.each(texts)("never changes a word: %s", (text) => {
    for (const team of [3, 7, 2, 6]) {
      const r = validate(blurb(team, text));
      expect(stripTags(applyAutoTags(text, r.autoTags))).toBe(text);
    }
  });

  test("a tagged result checks out on the next read", () => {
    for (const [team, text] of [
      [3, texts[0]],
      [7, texts[1]],
      [2, texts[2]],
      [6, texts[3]],
    ] as const) {
      const r = validate(blurb(team, text as string));
      const tagged = applyAutoTags(text as string, r.autoTags);
      const again = validate(blurb(team, tagged));
      expect(again.autoTags).toEqual([]);
      expect(
        again.claims
          .filter((c) => c.tagged)
          .every((c) => c.status === "verified"),
      ).toBe(true);
    }
  });

  test("a score is tagged as its two halves", () => {
    const text = "Kim Possible Kicks won 101.56-95.38.";
    const r = validate(blurb(7, text));
    expect(applyAutoTags(text, r.autoTags)).toBe(
      "Kim Possible Kicks won [101.56]{ev=w8.points}-[95.38]{ev=w8.opp_points}.",
    );
  });

  test("an auto-tag leaves punctuation after the claim outside the tag", () => {
    const text = "Gus Bus won by 55, and nobody saw it coming.";
    const r = validate(blurb(1, text));
    expect(applyAutoTags(text, r.autoTags)).toBe(
      "Gus Bus won by [55]{ev=w8.margin}, and nobody saw it coming.",
    );
  });

  test("an ambiguous match stays untagged: first in the standings and in the ranking", () => {
    const r = validate(blurb(3, "Bench Mob sit in first."));
    expect(statuses(r)).toEqual([["first", "verified"]]);
    expect(r.autoTags).toEqual([]);
  });

  test("loose and unchecked claims stay untagged", () => {
    const r = validate(blurb(3, "Somehow 982.8, and 4444 more."));
    expect(statuses(r)).toEqual([
      ["982.8", "loose"],
      ["4444", "unchecked"],
    ]);
    expect(r.autoTags).toEqual([]);
  });
});

describe("the word list", () => {
  test("swearing off flags listed words, case-insensitively, as whole words", () => {
    const text = "What the fuck, Pete. Absolute SHIT week. Classic assessment.";
    const r = validate(blurb(6, text, { swearing: "off" }));
    expect(r.swears.map((s) => s.word)).toEqual(["fuck", "SHIT"]);
    expect(r.swears.map((s) => text.slice(s.start, s.end))).toEqual([
      "fuck",
      "SHIT",
    ]);
    expect(gateLlm(r).pass).toBe(false);
  });

  test("mild and on run no word list", () => {
    for (const swearing of ["mild", "on"] as const) {
      expect(
        validate(blurb(6, "What the fuck, Pete.", { swearing })).swears,
      ).toEqual([]);
    }
  });

  test("a team's own name is never flagged", () => {
    const over = {
      swearing: "off" as const,
      nicknames: { ...blurb(1, "").nicknames, "sleeper:1": ["Shitbox United"] },
    };
    expect(validate(blurb(1, "Shitbox United rolls on.", over)).swears).toEqual(
      [],
    );
  });

  test("offsets point into the text as written, tags included", () => {
    const text = "[7-1]{ev=record} and damn good.";
    const r = validate(blurb(3, text, { swearing: "off" }));
    const s = r.swears[0];
    expect(s && text.slice(s.start, s.end)).toBe("damn");
  });
});

describe("tag stripping", () => {
  test.each([
    ["[7-1]{ev=record} and rolling.", "7-1 and rolling."],
    [
      "[Bo]{lore=manager:bo} paid [50]{stakes=payouts} for [it]{log=w7}.",
      "Bo paid 50 for it.",
    ],
    ["[101.56]{ev=w8.points}-[95.38]{ev=w8.opp_points}", "101.56-95.38"],
    ["No tags [here] or {there}.", "No tags [here] or {there}."],
  ])("%s", (text, plain) => {
    expect(stripTags(text)).toBe(plain);
  });
});

describe("ordinary phrasing gives no false hard problems", () => {
  test.each([
    ["Seven straight games.", "Seven straight games", "verified"],
    ["Seven games in a row.", "Seven games in a row", "verified"],
    ["Seven wins, one loss.", "Seven wins", "unchecked"],
  ])("%s", (text, words, status) => {
    const r = validate(blurb(3, text));
    expect(statuses(r)).toEqual([[words, status]]);
    expect(stripTags(applyAutoTags(text, r.autoTags))).toBe(text);
  });

  test.each([
    "They've won 7 games.",
    "Second straight week at the top.",
    "Up 3 on the year.",
  ])("%s has no hard problem", (text) => {
    const r = validate(blurb(3, text));
    expect(r.claims.filter((c) => isHard(c.status))).toEqual([]);
    expect(r.claims.some((c) => c.id === "streak" || c.id === "move")).toBe(
      false,
    );
  });

  test("an auto-tag never splits a word", () => {
    const text = "Seven straight games.";
    expect(applyAutoTags(text, validate(blurb(3, text)).autoTags)).toBe(
      "[Seven straight games]{ev=streak}.",
    );
  });

  test("the word list doesn't flag a word that merely starts like one", () => {
    expect(
      validate(
        blurb(3, "Shitake risotto, assassin energy.", { swearing: "off" }),
      ).swears,
    ).toEqual([]);
  });
});

test("plain 'new' about a new team is verified", () => {
  const order = {
    ...blurb(2, "").order,
    "sleeper:2": { place: 8, move: "new" as const },
  };
  expect(only(2, "Wendy's Wire are new this week.", { order })).toEqual([
    ["new", "verified", "move"],
  ]);
  expect(only(2, "A new high for the bench.", { order })).toEqual([]);
});

describe("the no-stakes flag", () => {
  test("under stakes: none, money, prize and punishment words are flagged, outside team names; otherwise nothing is", () => {
    const text =
      "Playing for the $50 pot, Bea was fined, and the punishment is cruel. A fine week, a punishing schedule, and I'd bet on Frank's FAAB Fund.";
    expect(
      validate(blurb(3, text, { noStakes: true })).stakesMentions.map(
        (m) => m.word,
      ),
    ).toEqual(["$50", "pot", "fined", "punishment"]);
    expect(validate(blurb(3, text)).stakesMentions).toEqual([]);
  });

  test("a stakes mention fails the LLM gate", () => {
    const result = validate(
      blurb(3, "They want the prize.", { noStakes: true }),
    );
    expect(gateLlm(result).pass).toBe(false);
  });
});

describe("invariants over a corpus", () => {
  const TEAMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, null];

  test.each(PLAIN_PROSE)(
    "no false hard problem, in any section: %s",
    (text) => {
      for (const team of TEAMS) {
        const hard = validate(blurb(team, text)).claims.filter((c) =>
          isHard(c.status),
        );
        expect(hard, `section ${team}`).toEqual([]);
      }
    },
  );

  test.each(TAGGED_PLAIN)(
    "a true tagged claim is never hard, in any section: %s",
    (text) => {
      for (const team of TEAMS) {
        const hard = validate(blurb(team, text)).claims.filter((c) =>
          isHard(c.status),
        );
        expect(hard, `section ${team}`).toEqual([]);
      }
    },
  );

  test.each(PLAIN_PROSE)("no stakes mention under stakes: none: %s", (text) => {
    expect(validate(blurb(3, text, { noStakes: true })).stakesMentions).toEqual(
      [],
    );
  });

  const isWord = (ch: string | undefined) => !!ch && /\w/.test(ch);

  test.each([...PLAIN_PROSE, ...CLAIM_HEAVY])(
    "every auto-tag sits on word boundaries, in any section: %s",
    (text) => {
      for (const team of TEAMS) {
        for (const t of validate(blurb(team, text)).autoTags) {
          const where = `section ${team}, ${text.slice(t.start, t.end)}`;
          expect(
            isWord(text[t.start - 1]) && isWord(text[t.start]),
            where,
          ).toBe(false);
          expect(isWord(text[t.end - 1]) && isWord(text[t.end]), where).toBe(
            false,
          );
        }
      }
    },
  );
});
