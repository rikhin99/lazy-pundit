import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "show-fixture.ts");

/** `npm run fixture:show -- <args>`: its output, error and exit code. */
function show(...args: string[]) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  });
  return { out: run.stdout, err: run.stderr, status: run.status };
}

test("a Sleeper week lists its payload paths, and prints one passed back", () => {
  const { out, status } = show("8");
  expect(status).toBe(0);
  expect(out.split("\n").slice(0, 4)).toEqual([
    "week 8: snapshot 20251028T120000Z-c4a2c21d",
    '  ""  (league)',
    "  losers_bracket",
    "  matchups/1",
  ]);
  expect(out).toContain("\n  players/nfl\n");
  expect(show("8", "/rosters").out).toBe(show("8", "rosters").out);
  expect(JSON.parse(show("8", "players/nfl").out)).toBeTypeOf("object");
});

test("Sleeper's --model and --lineups read as they did before ESPN", () => {
  const model = show("8", "--model").out.split("\n");
  expect(model[0]).toBe(
    "Fear The Turtle 2025, week 8 snapshot 20251028T120000Z-c4a2c21d: last scored week 8",
  );
  expect(model).toContain(
    "  sleeper:1  Gus Bus (gridiron_gus)  4-4  pf 876.16  pa 864.88  rank 6  seed 6  (points_for)",
  );
  expect(model).toContain("  Gus Bus 133.22 W  v  Pylon Patrol 78.22 L");
  const lineups = show("8", "--lineups").out.split("\n");
  expect(lineups.slice(0, 5)).toEqual([
    "week 8 lineups from week 8's snapshot; slots QB RB RB WR WR TE FLEX=RB/WR/TE K DEF",
    "Gus Bus  v  Pylon Patrol",
    "  Gus Bus (sleeper:1)  score 133.22 W  starters' points 133.22",
    "    QB    Josh Allen               QB       25.22",
    "    RB    Saquon Barkley           RB       33.4",
  ]);
  // Sleeper never sets a home bonus or an IR slot.
  expect(lineups.join("\n")).not.toMatch(/home bonus| {2}ir$/m);
});

test("ESPN's --lineups gives a side's home bonus and marks an IR-slot player", () => {
  const { out, status } = show("15", "--platform", "espn", "--lineups");
  expect(status).toBe(0);
  const lines = out.split("\n");
  // #106's literals: espn:10 is a week-15 home side, and its IR receiver's 19.2 is out of the best lineup.
  expect(lines).toContain(
    "  Jet Sweep Jets (espn:10)  score 147.28 W  home bonus 1  starters' points 146.28",
  );
  expect(lines).toContain(
    "    BN    Mike Evans               WR       19.2  ir",
  );
});

test("ESPN's --model works on every committed week of both sets", () => {
  const sets = {
    "hot-takery-2025": ["1", "7", "8", "9", "10", "14", "15"],
    "family-league-2025": ["14", "15"],
  };
  for (const [league, weeks] of Object.entries(sets)) {
    for (const week of weeks) {
      const args = [week, "--platform", "espn", "--league", league];
      expect(show(...args, "--model").status, `${league} ${week}`).toBe(0);
      expect(show(...args, "--lineups").status, `${league} ${week}`).toBe(0);
    }
  }
});

test("an ESPN week lists each payload by its views and scoring period, and prints one passed back", () => {
  const listing = show("15", "--platform", "espn").out.split("\n");
  expect(listing).toContain("  mSettings+mTeam+mStatus+mNav");
  expect(listing).toContain("  mMatchupScore+mScoreboard@10");
  expect(listing).toContain("  mTransactions2@15");
  const boxScores = JSON.parse(
    show("15", "--platform", "espn", "mMatchupScore+mScoreboard@10").out,
  );
  expect(boxScores.scoringPeriodId).toBe(10);
});

test("an unknown platform or league is a one-line error, exit 1", () => {
  for (const [args, err] of [
    [
      ["8", "--league", "hot-takery-2025"],
      "No league hot-takery-2025 in fixtures/sleeper; its leagues: fear-the-turtle-2025\n",
    ],
    [
      ["8", "--platform", "yahoo"],
      "No platform yahoo; platforms: sleeper, espn\n",
    ],
    // An inherited object name is no platform either.
    [
      ["8", "--platform", "toString"],
      "No platform toString; platforms: sleeper, espn\n",
    ],
  ] as const) {
    const run = show(...args);
    expect(run.err).toBe(err);
    expect(run.status).toBe(1);
  }
});
