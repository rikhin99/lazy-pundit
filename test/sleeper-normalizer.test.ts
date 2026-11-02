import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { scrubSleeperFixtures } from "../scripts/scrub-sleeper.ts";
import {
  bestLineupPoints,
  isStarter,
  type League,
  type MatchupSide,
  normalizeSleeper,
  readSnapshot,
} from "../src/index.ts";
import { committed, FIXTURES, patched } from "./support/workspace.ts";

/** Each matchup of a week as `kind round: team v team`, sorted. */
function kinds(league: League, week: number): string[] {
  const w = league.weeks.find((x) => x.week === week);
  return (w?.matchups ?? [])
    .map((m) => {
      const [a, b] = m.sides
        .map((x) => x.team.replace("sleeper:", ""))
        .sort((x, y) => Number(x) - Number(y));
      return `${m.kind} ${m.round ?? "-"}: ${a} v ${b}`;
    })
    .sort();
}

/** A side of one week's matchups, by team. */
function side(league: League, week: number, team: string) {
  const w = league.weeks.find((x) => x.week === week);
  return w?.matchups.flatMap((m) => m.sides).find((s) => s.team === team);
}

describe("Sleeper normalizer", () => {
  test("weeks up to last_scored_leg are scored, with results", async () => {
    const league = await committed(8);
    expect(league.lastScoredWeek).toBe(8);
    expect(league.weeks.map((w) => [w.week, w.scored])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((w) => [w, true]),
    );
    // Week 8, matchup 2: Gus Bus 133.22 beat Pylon Patrol 78.22.
    expect(side(league, 8, "sleeper:1")).toMatchObject({
      team: "sleeper:1",
      score: 133.22,
      result: "W",
    });
    expect(side(league, 8, "sleeper:6")?.result).toBe("L");
  });

  test("teams with no matchup in a playoff week are byes with no result", async () => {
    const week15 = (await committed(15)).weeks.find((w) => w.week === 15);
    expect(week15?.byes.sort()).toEqual([
      "sleeper:11",
      "sleeper:3",
      "sleeper:6",
      "sleeper:9",
    ]);
    expect(week15?.matchups).toHaveLength(4);
  });

  test("the matchup score is custom_points when set, over points", async () => {
    // A commissioner override giving Pylon Patrol 150.
    const league = await patched(8, {
      "matchups/8": (matchups) => {
        for (const m of matchups) if (m.roster_id === 6) m.custom_points = 150;
      },
    });

    expect(side(league, 8, "sleeper:6")).toMatchObject({
      score: 150,
      result: "W",
    });
    expect(side(league, 8, "sleeper:1")?.result).toBe("L");
    // The players' points are still the 78.22 the starters scored.
    expect(startersPoints(side(league, 8, "sleeper:6"))).toBe(78.22);
  });

  test("lineups list each player's position, slot and points, starters first", async () => {
    const lineup = side(await committed(8), 8, "sleeper:1")?.lineup ?? [];
    // From matchups/8, roster 1: starters in roster_positions order, then the bench.
    expect(lineup.slice(0, 9)).toEqual([
      { player: "4984", position: "QB", slot: "QB", points: 25.22 },
      { player: "4866", position: "RB", slot: "RB", points: 33.4 },
      { player: "8136", position: "RB", slot: "RB", points: 7.1 },
      { player: "5045", position: "WR", slot: "WR", points: 8.7 },
      { player: "5846", position: "WR", slot: "WR", points: 14 },
      { player: "3214", position: "TE", slot: "TE", points: 7.2 },
      { player: "9997", position: "WR", slot: "FLEX", points: 10.6 },
      { player: "1945", position: "K", slot: "K", points: 20 },
      { player: "IND", position: "DEF", slot: "DEF", points: 7 },
    ]);
    expect(lineup).toHaveLength(16);
    expect(lineup).toContainEqual({
      player: "5844",
      position: "TE",
      slot: "BN",
      points: 3.6,
    });
    expect(startersPoints(side(await committed(8), 8, "sleeper:1"))).toBe(
      133.22,
    );
  });

  test("the best possible lineup over the regular season matches Sleeper's ppts", async () => {
    const league = await committed(15);
    const { regularSeasonWeeks, lineupSlots } = league.settings;
    expect(regularSeasonWeeks).toBe(14);
    expect(lineupSlots.map((s) => s.slot)).toEqual([
      "QB",
      "RB",
      "RB",
      "WR",
      "WR",
      "TE",
      "FLEX",
      "K",
      "DEF",
    ]);
    const cents = new Map<string, number>();
    for (const week of league.weeks.filter(
      (w) => w.week <= regularSeasonWeeks,
    )) {
      for (const s of week.matchups.flatMap((m) => m.sides)) {
        const best = bestLineupPoints(s.lineup, lineupSlots, league.players);
        cents.set(s.team, (cents.get(s.team) ?? 0) + Math.round(best * 100));
      }
    }
    // rosters settings.ppts + ppts_decimal / 100, end of season.
    const ppts: [string, number][] = [
      ["sleeper:1", 1621.35],
      ["sleeper:2", 1920.75],
      ["sleeper:3", 1725.01],
      ["sleeper:4", 1759.67],
      ["sleeper:5", 1729.66],
      ["sleeper:6", 1647.22],
      ["sleeper:7", 1795.68],
      ["sleeper:8", 1677.55],
      ["sleeper:9", 1630.34],
      ["sleeper:10", 1624.48],
      ["sleeper:11", 1979.36],
      // Sleeper says 1643.72. This team started return specialists, whose
      // return yards score 1/15 point each; the payload rounds every player's
      // points to the cent, and Sleeper sums the unrounded ones.
      ["sleeper:12", 1643.73],
    ];
    expect(ppts.map(([team]) => [team, (cents.get(team) ?? 0) / 100])).toEqual(
      ppts,
    );
  });
});

function startersPoints(s: MatchupSide | undefined): number {
  const cents = (s?.lineup ?? [])
    .filter(isStarter)
    .reduce((sum, e) => sum + Math.round(e.points * 100), 0);
  return cents / 100;
}

describe("Sleeper playoff weeks", () => {
  test("matchup kinds and rounds come from the brackets (week 15, round 1)", async () => {
    // winners_bracket r1: 5 v 7, 8 v 4. losers_bracket r1: 10 v 2, 12 v 1.
    expect(kinds(await committed(15), 15)).toEqual([
      "losers 1: 1 v 12",
      "losers 1: 2 v 10",
      "winners 1: 4 v 8",
      "winners 1: 5 v 7",
    ]);
  });

  test("a playoff result follows the bracket, marked when a tiebreak decided it", async () => {
    // Team 5's 84.88 patched to tie team 7's 100.86; winners_bracket m1 still has 7 winning.
    const league = await patched(15, {
      "matchups/15": (matchups) => {
        for (const m of matchups) if (m.roster_id === 5) m.points = 100.86;
      },
    });
    expect(side(league, 15, "sleeper:7")).toMatchObject({
      score: 100.86,
      result: "W",
      tiebreak: true,
    });
    expect(side(league, 15, "sleeper:5")).toMatchObject({
      score: 100.86,
      result: "L",
      tiebreak: true,
    });
    // An untied game carries no flag.
    expect(side(league, 15, "sleeper:4")?.tiebreak).toBeUndefined();
  });

  const RAW = join(
    FIXTURES,
    "..",
    "..",
    "raw",
    "sleeper",
    "fear-the-turtle-2025",
  );
  test.skipIf(!existsSync(RAW))(
    "every 2025 playoff game gets its bracket's kind (full raw fixtures, local only)",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "lazy-pundit-raw-"));
      const ids = await scrubSleeperFixtures({
        rawDir: RAW,
        outDir: dir,
        weeks: [17],
      });
      const league = normalizeSleeper(
        await readSnapshot(dir, ids["17"] as string),
      );
      // Hand-read from league_winners_bracket.json and league_losers_bracket.json.
      expect(kinds(league, 15)).toEqual([
        "losers 1: 1 v 12",
        "losers 1: 2 v 10",
        "winners 1: 4 v 8",
        "winners 1: 5 v 7",
      ]);
      expect(kinds(league, 16)).toEqual([
        "consolation 2: 5 v 8",
        "losers 2: 1 v 2",
        "losers 2: 6 v 10",
        "losers 2: 9 v 12",
        "winners 2: 3 v 7",
        "winners 2: 4 v 11",
      ]);
      expect(kinds(league, 17)).toEqual([
        "consolation 3: 3 v 11",
        "losers 3: 6 v 12",
        "losers 3: 9 v 10",
        "winners 3: 4 v 7",
      ]);
      // The final: team 4's 68 beat team 7's 59.11.
      expect(side(league, 17, "sleeper:4")).toMatchObject({
        score: 68,
        result: "W",
      });
      expect(league.weeks.find((w) => w.week === 17)?.byes.sort()).toEqual([
        "sleeper:1",
        "sleeper:2",
        "sleeper:5",
        "sleeper:8",
      ]);
    },
  );
});

describe("Sleeper league settings, teams and transactions", () => {
  test("league settings as Fear The Turtle sets them", async () => {
    const { settings } = await committed(15);
    // league settings: playoff_teams 6, playoff_week_start 15, waiver_type 0
    // (no FAAB), league_average_match 0, no divisions, type 0 (redraft).
    expect(settings).toMatchObject({
      playoffTeams: 6,
      playoffStartWeek: 15,
      regularSeasonWeeks: 14,
      faabBudget: null,
      losersBracket: true,
      median: false,
      divisions: 0,
      keepers: null,
    });
  });

  test("median, divisions, keepers and FAAB are detected", async () => {
    const league = await patched(15, {
      "": (l) => {
        Object.assign(l.settings, {
          league_average_match: 1,
          divisions: 2,
          type: 2,
          waiver_type: 2,
          waiver_budget: 100,
        });
      },
      rosters: (rosters) => {
        for (const r of rosters) r.settings.division = r.roster_id <= 6 ? 1 : 2;
      },
      "transactions/1": (txs) => {
        for (const t of txs) {
          if (t.transaction_id === "1271361438224498688") {
            t.settings = { seq: 0, waiver_bid: 17 };
          }
        }
      },
    });
    expect(league.settings).toMatchObject({
      faabBudget: 100,
      median: true,
      divisions: 2,
      keepers: "dynasty",
    });
    expect(league.teams.find((t) => t.id === "sleeper:2")?.division).toBe(1);
    expect(league.teams.find((t) => t.id === "sleeper:9")?.division).toBe(2);
    expect(
      league.transactions.find((t) => t.id === "1271361438224498688"),
    ).toMatchObject({ kind: "waiver", team: "sleeper:2", faabBid: 17 });
  });

  test("teams list their managers; a co-managed team lists each, a team with none has none", async () => {
    const league = await patched(8, {
      users: (users) => {
        users.push({ user_id: "800000000000000099", display_name: "co_pilot" });
      },
      rosters: (rosters) => {
        for (const r of rosters) {
          if (r.roster_id === 3) r.co_owners = ["800000000000000099"];
          if (r.roster_id === 5) r.owner_id = null;
        }
      },
    });
    const team = (id: string) => league.teams.find((t) => t.id === id);
    expect(team("sleeper:1")).toMatchObject({
      name: "Gus Bus",
      managers: [
        { accountId: "800000000000000001", displayName: "gridiron_gus" },
      ],
    });
    expect(team("sleeper:3")?.managers).toEqual([
      { accountId: "800000000000000003", displayName: "benchwarmer_bo" },
      { accountId: "800000000000000099", displayName: "co_pilot" },
    ]);
    expect(team("sleeper:5")).toMatchObject({ name: "Team 5", managers: [] });
  });

  test("current rosters carry each player's status and injury", async () => {
    const league = await committed(15);
    const roster = league.teams.find((t) => t.id === "sleeper:5")?.roster ?? [];
    // rosters, roster 5: 2216 starts, 8146 is on reserve, 2133 is on the bench.
    expect(roster).toContainEqual({ player: "2216", status: "starter" });
    expect(roster).toContainEqual({ player: "8146", status: "IR" });
    expect(roster).toContainEqual({ player: "2133", status: "bench" });
    expect(roster).toHaveLength(16);
    // players/nfl, 2216.
    expect(league.players["2216"]).toEqual({
      id: "2216",
      name: "Mike Evans",
      position: "WR",
      positions: ["WR"],
      nflTeam: "SF",
      injuryStatus: "Out",
      injuryBodyPart: "Achilles",
    });
  });

  test("transactions: trades and claims, failed claims left out", async () => {
    const league = await committed(8);
    // transactions/4: the week-4 trade between rosters 2 and 6.
    expect(
      league.transactions.find((t) => t.id === "1277872756410564608"),
    ).toEqual({
      id: "1277872756410564608",
      kind: "trade",
      week: 4,
      at: "2025-09-28T03:59:17.726Z",
      teams: ["sleeper:2", "sleeper:6"],
      adds: [
        { player: "1479", team: "sleeper:6" },
        { player: "5967", team: "sleeper:6" },
        { player: "7569", team: "sleeper:2" },
      ],
      drops: [
        { player: "1479", team: "sleeper:2" },
        { player: "5967", team: "sleeper:2" },
        { player: "7569", team: "sleeper:6" },
      ],
      faab: [],
      draftPicks: [],
    });
    // transactions/1: a completed waiver claim, with no bid (no FAAB).
    expect(
      league.transactions.find((t) => t.id === "1271361438224498688"),
    ).toEqual({
      id: "1271361438224498688",
      kind: "waiver",
      week: 1,
      at: "2025-09-10T07:04:39.797Z",
      team: "sleeper:2",
      adds: [{ player: "12469", team: "sleeper:2" }],
      drops: [],
    });
    // A failed claim (too many players) isn't a transaction.
    expect(
      league.transactions.some((t) => t.id === "1271356570298507264"),
    ).toBe(false);
    // 15 of week 1's 25 went through.
    expect(league.transactions.filter((t) => t.week === 1)).toHaveLength(15);
  });
});
