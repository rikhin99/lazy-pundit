import { describe, expect, test } from "vitest";
import { standingsThrough } from "../src/index.ts";
import { committed, type Json, patched } from "./support/workspace.ts";

describe("standings through a week", () => {
  test("through week 14 they match Sleeper's end-of-regular-season standings", async () => {
    // Rebuilt from the week-15 snapshot's matchups, so the playoff week is left out.
    const standings = standingsThrough(await committed(15), 14);
    // From `npm run fixture:show -- 14 rosters`: wins, losses, ties, fpts, fpts_against.
    const byTeam = Object.fromEntries(
      standings.map((s) => [
        s.team,
        [s.wins, s.losses, s.ties, s.pointsFor, s.pointsAgainst],
      ]),
    );
    expect(byTeam).toEqual({
      "sleeper:1": [6, 8, 0, 1458.28, 1632.94],
      "sleeper:2": [6, 8, 0, 1643.95, 1568.17],
      "sleeper:3": [10, 4, 0, 1559.21, 1419.66],
      "sleeper:4": [9, 5, 0, 1514.24, 1496.35],
      "sleeper:5": [7, 7, 0, 1580.99, 1553.69],
      "sleeper:6": [5, 9, 0, 1419.71, 1526.95],
      "sleeper:7": [7, 7, 0, 1556.49, 1565.4],
      "sleeper:8": [7, 7, 0, 1474.65, 1575.87],
      "sleeper:9": [5, 9, 0, 1473.17, 1576.34],
      "sleeper:10": [6, 8, 0, 1459.44, 1402.88],
      "sleeper:11": [9, 5, 0, 1744.65, 1540.94],
      "sleeper:12": [7, 7, 0, 1462.3, 1487.89],
    });
  });

  test("seeds agree with the 2025 winners bracket's round-1 pairings and byes", async () => {
    const league = await committed(15);
    const seeds = Object.fromEntries(
      standingsThrough(league, 14).map((s) => [s.team, s.seed]),
    );
    // Six playoff spots: seeds 1 and 2 skip round 1, which plays 3 v 6 and 4 v 5.
    expect(seeds).toEqual({
      "sleeper:3": 1,
      "sleeper:11": 2,
      "sleeper:4": 3,
      "sleeper:5": 4,
      "sleeper:7": 5,
      "sleeper:8": 6,
      "sleeper:1": null,
      "sleeper:2": null,
      "sleeper:6": null,
      "sleeper:9": null,
      "sleeper:10": null,
      "sleeper:12": null,
    });
    // The week-15 winners bracket (`npm run fixture:show -- 15 winners_bracket`):
    // round 1 is 5 v 7 and 8 v 4, with 3 and 11 waiting in round 2.
    const week15 = league.weeks.find((w) => w.week === 15);
    const round1 = (week15?.matchups ?? [])
      .filter((m) => m.kind === "winners" && m.round === 1)
      .map((m) => m.sides.map((s) => seeds[s.team]).sort());
    expect(round1.sort()).toEqual([
      [3, 6],
      [4, 5],
    ]);
    const playoffByes = (week15?.byes ?? []).filter((t) => seeds[t] !== null);
    expect(playoffByes.map((t) => seeds[t]).sort()).toEqual([1, 2]);
  });

  test("teams level on record say points for separated them", async () => {
    const standings = standingsThrough(await committed(15), 14);
    expect(standings.map((s) => [s.rank, s.team, s.tiebreak ?? "-"])).toEqual([
      [1, "sleeper:3", "-"], // 10-4, alone on its record
      [2, "sleeper:11", "points_for"], // 9-5, 1744.65
      [3, "sleeper:4", "points_for"], // 9-5, 1514.24, though it lost to 11
      [4, "sleeper:5", "points_for"], // 7-7, 1580.99
      [5, "sleeper:7", "points_for"], // 7-7, 1556.49
      [6, "sleeper:8", "points_for"], // 7-7, 1474.65
      // 7-7, 1462.30: 4-0 against the other 7-7 teams, so head-to-head would
      // have seeded it over sleeper:8. The bracket shows Sleeper didn't.
      [7, "sleeper:12", "points_for"],
      [8, "sleeper:2", "points_for"], // 6-8, 1643.95
      [9, "sleeper:10", "points_for"], // 6-8, 1459.44
      [10, "sleeper:1", "points_for"], // 6-8, 1458.28
      [11, "sleeper:9", "points_for"], // 5-9, 1473.17
      [12, "sleeper:6", "points_for"], // 5-9, 1419.71
    ]);
  });

  test("before any week is scored every team is level and unbroken", async () => {
    const standings = standingsThrough(await committed(1), 0);
    expect(standings.map((s) => s.tiebreak)).toEqual(
      Array(12).fill("unbroken"),
    );
    for (const s of standings) {
      expect([s.wins, s.losses, s.ties, s.pointsFor, s.pointsAgainst]).toEqual([
        0, 0, 0, 0, 0,
      ]);
    }
  });

  test("a median league gets the standings as reported, with no recount", async () => {
    // Median scoring adds a result a week, so Sleeper reports more wins than
    // the matchups hold: Bench Mob 7-1 by matchups, 14-2 as reported.
    const league = await patched(8, {
      "": (l) => {
        l.settings.league_average_match = 1;
      },
      rosters: (rosters) => {
        const benchMob = rosters.find((r: Json) => r.roster_id === 3);
        benchMob.settings.wins = 14;
        benchMob.settings.losses = 2;
      },
    });
    for (const week of [8, 5]) {
      const benchMob = standingsThrough(league, week).find(
        (s) => s.team === "sleeper:3",
      );
      expect(benchMob).toMatchObject({ wins: 14, losses: 2, rank: 1 });
    }
  });

  test("with divisions they're as reported, with no rank, seed or tiebreak", async () => {
    // Sleeper reports no rank or seed, and its division seeding isn't modelled.
    const league = await patched(8, {
      "": (l) => {
        l.settings.divisions = 2;
      },
      rosters: (rosters) => {
        for (const r of rosters) r.settings.division = r.roster_id <= 6 ? 1 : 2;
        // A reported record the week-8 matchups don't give (7-1 by matchups).
        const benchMob = rosters.find((r: Json) => r.roster_id === 3);
        benchMob.settings.wins = 6;
        benchMob.settings.losses = 2;
      },
    });
    for (const week of [8, 5]) {
      const standings = standingsThrough(league, week);
      expect(standings.find((s) => s.team === "sleeper:3")).toMatchObject({
        wins: 6,
        losses: 2,
      });
      for (const s of standings) {
        expect([s.rank, s.seed, s.tiebreak]).toEqual([null, null, undefined]);
      }
    }
  });
});
