import { describe, expect, test } from "vitest";
import { diff } from "../src/index.ts";
import {
  committed,
  type Json,
  patched,
  statCorrection,
} from "./support/workspace.ts";

describe("diff", () => {
  test("the same data has no data changes", async () => {
    expect(diff(await committed(8), await committed(8), 8)).toEqual([]);
  });

  test("a later week's data has no data changes through the ranking week", async () => {
    expect(diff(await committed(8), await committed(10), 8)).toEqual([]);
  });

  test("a stat correction that keeps the result changes the score, lineup and standings", async () => {
    const old = await committed(8);
    const corrected = await patched(8, {
      "matchups/8": statCorrection(1, 1.8),
    });

    const changes = diff(old, corrected, 8);

    expect(changes).toContainEqual({
      kind: "score-changed",
      week: 8,
      team: "sleeper:1",
      from: 133.22,
      to: 135.02,
    });
    expect(changes).toContainEqual({
      kind: "lineup-changed",
      week: 8,
      team: "sleeper:1",
    });
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: "standing-changed",
        team: "sleeper:1",
      }),
    );
    expect(changes.some((c) => c.kind === "result-flipped")).toBe(false);
  });

  test("a correction past the ranking week isn't a data change through it", async () => {
    const old = await committed(8);
    const corrected = await patched(10, {
      "matchups/9": statCorrection(1, 1.8),
    });

    expect(diff(old, corrected, 8)).toEqual([]);
  });

  test("a bench player's correction changes only the lineup", async () => {
    const old = await committed(8);
    const corrected = await patched(8, {
      "matchups/8": (payload: Json) => {
        const side = payload.find((s: Json) => s.roster_id === 1);
        const bench = side.players.find(
          (p: string) => !side.starters.includes(p),
        );
        side.players_points[bench] += 10;
      },
    });

    expect(diff(old, corrected, 8)).toEqual([
      { kind: "lineup-changed", week: 8, team: "sleeper:1" },
    ]);
  });

  test("a correction that flips a result names both teams' results", async () => {
    const old = await committed(8);
    // Bench Mob won by 2.71 in week 8.
    const corrected = await patched(8, {
      "matchups/8": statCorrection(3, -5),
    });
    const opponent = old.weeks[7]?.matchups
      .find((m) => m.sides.some((s) => s.team === "sleeper:3"))
      ?.sides.find((s) => s.team !== "sleeper:3")?.team;

    const flips = diff(old, corrected, 8).filter(
      (c) => c.kind === "result-flipped",
    );

    expect(flips).toEqual([
      {
        kind: "result-flipped",
        week: 8,
        team: "sleeper:3",
        from: "W",
        to: "L",
      },
      { kind: "result-flipped", week: 8, team: opponent, from: "L", to: "W" },
    ]);
  });

  test("a transaction added or removed through the ranking week is a data change", async () => {
    const old = await committed(8);
    const fewer = await patched(8, {
      "transactions/5": (payload: Json) => {
        payload.length = 0;
      },
    });
    const removed = old.transactions.filter((t) => t.week === 5);
    expect(removed.length).toBeGreaterThan(0);

    const dropped = diff(old, fewer, 8).filter(
      (c) => c.kind === "transaction-removed",
    );
    const added = diff(fewer, old, 8).filter(
      (c) => c.kind === "transaction-added",
    );

    expect(dropped.map((c) => c.transaction)).toEqual(removed);
    expect(added.map((c) => c.transaction)).toEqual(removed);
  });

  test("a changed number of playoff spots is a data change", async () => {
    const old = await committed(8);
    const fewer = await patched(8, {
      "": (league: Json) => {
        league.settings.playoff_teams = old.settings.playoffTeams - 2;
      },
    });

    expect(diff(old, fewer, 8)).toContainEqual({
      kind: "setting-changed",
      setting: "playoffTeams",
      from: old.settings.playoffTeams,
      to: old.settings.playoffTeams - 2,
    });
  });

  test("names aren't data changes", async () => {
    const old = await committed(8);
    const renamed = await patched(8, {
      users: (users: Json) => {
        for (const u of users) u.display_name = `${u.display_name} II`;
      },
    });

    expect(diff(old, renamed, 8)).toEqual([]);
  });

  test("with median scoring, reported standings aren't compared, so a later week doesn't count", async () => {
    const median = (league: Json) => {
      league.settings.league_average_match = 1;
    };
    const old = await patched(8, { "": median });
    const later = await patched(8, {
      "": median,
      rosters: (rosters: Json) => {
        for (const r of rosters) r.settings.wins += 1;
      },
    });

    expect(diff(old, later, 8)).toEqual([]);
  });
});
