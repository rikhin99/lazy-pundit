import type {
  EvidencePack,
  OrderEvidence,
  TeamId,
  ValidatorInput,
} from "../../src/index.ts";

/**
 * Fear The Turtle 2025 through week 8, as the evidence pack will hold it.
 * Hand-checked against the committed week-8 snapshot (`npm run fixture:show
 * -- 8 --model`): records, points for and against and the
 * week-8 scores come straight from the payloads; all-play, luck, form, ranks
 * and streaks were worked out by hand in the grounding prototype from the
 * same weeks. Team names and managers are the scrubbed fakes. The
 * evidence-pack builder is asserted against it (`test/stats.test.ts`).
 */
interface Row {
  name: string;
  manager: string;
  record: string;
  allplay: string;
  streak: string;
  high: number;
  low: number;
  opp: number;
  points: number;
  oppPoints: number;
  result: "W" | "L";
  pf: number;
  pa: number;
  form3: number;
  luck: number;
  pfRank: number;
  paRank: number;
  allplayRank: number;
  formRank: number;
  weekRank: number;
  standing: number;
}

const ROWS: Record<number, Row> = {
  1: {
    name: "Gus Bus",
    manager: "gridiron_gus",
    record: "4-4",
    allplay: "45-43",
    streak: "W1",
    high: 144.26,
    low: 67.92,
    opp: 6,
    points: 133.22,
    oppPoints: 78.22,
    result: "W",
    pf: 876.16,
    pa: 864.88,
    form3: 101.93,
    luck: -0.09,
    pfRank: 6,
    paRank: 9,
    allplayRank: 6,
    formRank: 9,
    weekRank: 1,
    standing: 6,
  },
  2: {
    name: "Wendy's Wire",
    manager: "waiver_wendy",
    record: "3-5",
    allplay: "54-34",
    streak: "L2",
    high: 148.24,
    low: 95.48,
    opp: 4,
    points: 112.11,
    oppPoints: 121.38,
    result: "L",
    pf: 958.27,
    pa: 919.19,
    form3: 118.61,
    luck: -1.91,
    pfRank: 3,
    paRank: 3,
    allplayRank: 3,
    formRank: 3,
    weekRank: 6,
    standing: 8,
  },
  3: {
    name: "Bench Mob",
    manager: "benchwarmer_bo",
    record: "7-1",
    allplay: "62-26",
    streak: "W7",
    high: 162.9,
    low: 70.02,
    opp: 12,
    points: 126.89,
    oppPoints: 124.18,
    result: "W",
    pf: 982.81,
    pa: 805.86,
    form3: 135.04,
    luck: 1.36,
    pfRank: 1,
    paRank: 11,
    allplayRank: 1,
    formRank: 1,
    weekRank: 3,
    standing: 1,
  },
  4: {
    name: "Frank's FAAB Fund",
    manager: "faab_frank",
    record: "5-3",
    allplay: "46-42",
    streak: "W1",
    high: 121.38,
    low: 99.38,
    opp: 2,
    points: 121.38,
    oppPoints: 112.11,
    result: "W",
    pf: 866.11,
    pa: 870.63,
    form3: 109.29,
    luck: 0.82,
    pfRank: 8,
    paRank: 8,
    allplayRank: 5,
    formRank: 7,
    weekRank: 5,
    standing: 4,
  },
  5: {
    name: "Baron Von Trade",
    manager: "trade_baron",
    record: "3-5",
    allplay: "45-43",
    streak: "L1",
    high: 120.02,
    low: 97.02,
    opp: 11,
    points: 110.08,
    oppPoints: 130.03,
    result: "L",
    pf: 891.03,
    pa: 924.43,
    form3: 112.71,
    luck: -1.09,
    pfRank: 4,
    paRank: 2,
    // Level with Gus Bus at 45-43, so both are 6th.
    allplayRank: 6,
    formRank: 5,
    weekRank: 7,
    standing: 9,
  },
  6: {
    name: "Pylon Patrol",
    manager: "pylon_pete",
    record: "3-5",
    allplay: "31-57",
    streak: "L3",
    high: 122.14,
    low: 78.22,
    opp: 1,
    points: 78.22,
    oppPoints: 133.22,
    result: "L",
    pf: 806.48,
    pa: 907.97,
    form3: 86.13,
    luck: 0.18,
    pfRank: 11,
    paRank: 5,
    allplayRank: 11,
    formRank: 12,
    weekRank: 11,
    standing: 11,
  },
  7: {
    name: "Kim Possible Kicks",
    manager: "kicker_kim",
    record: "3-5",
    allplay: "35-53",
    streak: "W2",
    high: 136.54,
    low: 74.68,
    opp: 8,
    points: 101.56,
    oppPoints: 95.38,
    result: "W",
    pf: 824.4,
    pa: 910.12,
    form3: 104.26,
    luck: -0.18,
    pfRank: 9,
    paRank: 4,
    allplayRank: 10,
    formRank: 8,
    weekRank: 9,
    standing: 10,
  },
  8: {
    name: "Red Zone Rascals",
    manager: "redzone_rita",
    record: "5-3",
    allplay: "47-41",
    streak: "L1",
    high: 147.36,
    low: 86.18,
    opp: 7,
    points: 95.38,
    oppPoints: 101.56,
    result: "L",
    pf: 875.85,
    pa: 896.22,
    form3: 98.33,
    luck: 0.73,
    pfRank: 7,
    paRank: 6,
    allplayRank: 4,
    formRank: 10,
    weekRank: 10,
    standing: 3,
  },
  9: {
    name: "Hail Mary Hustle",
    manager: "hail_mary_hal",
    record: "1-7",
    allplay: "36-52",
    streak: "L4",
    high: 124.41,
    low: 70.32,
    opp: 10,
    points: 70.32,
    oppPoints: 101.62,
    result: "L",
    pf: 816.2,
    pa: 954.74,
    form3: 94.09,
    luck: -2.27,
    pfRank: 10,
    paRank: 1,
    allplayRank: 9,
    formRank: 11,
    weekRank: 12,
    standing: 12,
  },
  10: {
    name: "Tank Brigade",
    manager: "tank_commander",
    record: "4-4",
    allplay: "27-61",
    streak: "W3",
    high: 132.96,
    low: 84.04,
    opp: 9,
    points: 101.62,
    oppPoints: 70.32,
    result: "W",
    pf: 801.08,
    pa: 794.14,
    form3: 111.27,
    luck: 1.55,
    pfRank: 12,
    paRank: 12,
    allplayRank: 12,
    formRank: 6,
    weekRank: 8,
    standing: 7,
  },
  11: {
    name: "Bye Bye Bea",
    manager: "bye_week_bea",
    record: "6-2",
    allplay: "59-29",
    streak: "W6",
    high: 165.84,
    low: 81.98,
    opp: 5,
    points: 130.03,
    oppPoints: 110.08,
    result: "W",
    pf: 976.25,
    pa: 826.04,
    form3: 131.23,
    luck: 0.64,
    pfRank: 2,
    paRank: 10,
    allplayRank: 2,
    formRank: 2,
    weekRank: 2,
    standing: 2,
  },
  12: {
    name: "Snap Judgement",
    manager: "snap_count_sam",
    record: "4-4",
    allplay: "41-47",
    streak: "L2",
    high: 129.66,
    low: 90.94,
    opp: 3,
    points: 124.18,
    oppPoints: 126.89,
    result: "L",
    pf: 885.83,
    pa: 886.25,
    form3: 117.3,
    luck: 0.27,
    pfRank: 5,
    paRank: 7,
    allplayRank: 8,
    formRank: 4,
    weekRank: 4,
    standing: 5,
  },
};

export const id = (n: number): TeamId => `sleeper:${n}`;

/** Week 8's player facts for the teams whose blurbs test them, from `matchups/8`. */
const PLAYER_FACTS: Record<number, Record<string, number | string>> = {
  3: {
    "w8.top": "Jonathan Taylor",
    "w8.top_points": 38.4,
    "w8.zeros": "Quentin Johnston",
    "w8.benchmiss": "Tyjae Spears",
    "w8.benchmiss_points": 16.7,
    "w8.opp.top": "Tucker Kraft",
    "w8.opp.top_points": 31.8,
  },
  9: { "w8.zeros": "Jake Ferguson" },
};

/** Lore nicknames a pundit might have written down, on top of name and manager. */
const LORE_NICKNAMES: Record<number, string[]> = {
  1: ["Gus"],
  2: ["Wendy"],
  3: ["Bo", "the Mob"],
  4: ["Frank"],
  5: ["Baron"],
  6: ["Pete"],
  7: ["Kim"],
  8: ["Rita", "Rascals"],
  9: ["Hal"],
  10: ["Tanks"],
  11: ["Bea"],
  12: ["Sam", "Snappers"],
};

export function week8Evidence(): EvidencePack {
  const teams: EvidencePack["teams"] = {};
  for (const [n, r] of Object.entries(ROWS)) {
    teams[id(Number(n))] = {
      record: r.record,
      allplay: r.allplay,
      allplay_rank: r.allplayRank,
      streak: r.streak,
      high: r.high,
      low: r.low,
      pf: r.pf,
      pf_rank: r.pfRank,
      pa: r.pa,
      pa_rank: r.paRank,
      form3: r.form3,
      form_rank: r.formRank,
      ppg: Math.round((r.pf / 8) * 100) / 100,
      luck: r.luck,
      standing: r.standing,
      "w8.points": r.points,
      "w8.opp_points": r.oppPoints,
      "w8.margin": Math.round(Math.abs(r.points - r.oppPoints) * 100) / 100,
      "w8.result": r.result,
      "w8.opponent": id(r.opp),
      "w8.rank": r.weekRank,
      ...PLAYER_FACTS[Number(n)],
    };
  }
  return {
    week: 8,
    teams,
    league: {
      "wk.high": 133.22,
      "wk.high_team": id(1),
      "wk.low": 70.32,
      "wk.low_team": id(9),
      "wk.margin_max": 55,
      "wk.margin_max_team": id(1),
    },
  };
}

export function week8Nicknames(): Record<TeamId, string[]> {
  return Object.fromEntries(
    Object.entries(ROWS).map(([n, r]) => [
      id(Number(n)),
      [r.name, r.manager, ...(LORE_NICKNAMES[Number(n)] ?? [])],
    ]),
  );
}

/** The draft's order: the standings order, no groups, nobody moved yet. */
export function week8Order(
  over: Partial<Record<TeamId, Partial<OrderEvidence>>> = {},
): Record<TeamId, OrderEvidence> {
  return Object.fromEntries(
    Object.entries(ROWS).map(([n, r]) => {
      const t = id(Number(n));
      return [t, { place: r.standing, move: 0, ...over[t] }];
    }),
  );
}

/** A validator input for one team's blurb, with sensible defaults. */
export function blurb(
  team: number | null,
  text: string,
  over: Partial<ValidatorInput> = {},
): ValidatorInput {
  return {
    text,
    team: team === null ? null : id(team),
    evidence: week8Evidence(),
    order: week8Order(),
    nicknames: week8Nicknames(),
    sections: { lore: [], stakes: [], log: [] },
    swearing: "on",
    ...over,
  };
}

/**
 * The pack after Sleeper corrects one team's week-8 score by `delta`, as a
 * refresh would see it: its points, margin, points for, points per game and
 * form move, and so
 * does its opponent's side.
 */
export function corrected(team: number, delta: number): EvidencePack {
  const pack = week8Evidence();
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const t = pack.teams[id(team)] as Record<string, number | string>;
  const o = pack.teams[t["w8.opponent"] as TeamId] as Record<
    string,
    number | string
  >;
  t["w8.points"] = r2((t["w8.points"] as number) + delta);
  t.pf = r2((t.pf as number) + delta);
  t.form3 = r2((t.form3 as number) + delta / 3);
  t.ppg = r2((t.pf as number) / 8);
  o["w8.opp_points"] = t["w8.points"];
  o.pa = r2((o.pa as number) + delta);
  const margin = r2(Math.abs(t["w8.points"] - (t["w8.opp_points"] as number)));
  t["w8.margin"] = margin;
  o["w8.margin"] = margin;
  return pack;
}
