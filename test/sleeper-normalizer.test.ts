import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  fetchSleeperSnapshot,
  fileTransport,
  type League,
  normalizeSleeper,
  readSnapshot,
  type Transport,
} from "../src/index.ts";
import {
  FEAR_THE_TURTLE_ID,
  FIXTURES,
  fixedClock,
  WEEKS,
} from "./support/workspace.ts";

async function committed(week: number): Promise<League> {
  return normalizeSleeper(
    await readSnapshot(FIXTURES, WEEKS[String(week)] as string),
  );
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
    expect(side(league, 8, "sleeper:1")).toEqual({
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
    // Replay week 8 with a commissioner override giving Pylon Patrol 150.
    const replay = fileTransport(FIXTURES, WEEKS["8"] as string);
    const overridden: Transport = {
      async request(req) {
        const res = await replay.request(req);
        if (!req.url.endsWith(`/league/${FEAR_THE_TURTLE_ID}/matchups/8`)) {
          return res;
        }
        const matchups = JSON.parse(new TextDecoder().decode(res.body));
        for (const m of matchups) if (m.roster_id === 6) m.custom_points = 150;
        return {
          status: 200,
          body: new TextEncoder().encode(JSON.stringify(matchups)),
        };
      },
    };
    const dir = await mkdtemp(join(tmpdir(), "lazy-pundit-"));
    const { id } = await fetchSleeperSnapshot({
      transport: overridden,
      clock: fixedClock("2025-10-28T15:00:00.000Z"),
      snapshotsDir: dir,
      leagueId: FEAR_THE_TURTLE_ID,
    });

    const league = normalizeSleeper(await readSnapshot(dir, id));

    expect(side(league, 8, "sleeper:6")).toMatchObject({
      score: 150,
      result: "W",
    });
    expect(side(league, 8, "sleeper:1")?.result).toBe("L");
  });
});
