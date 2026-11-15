import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ESPN_VIEWS, espnLeagueUrl, espnViewUrl } from "../src/espn/api.ts";
import {
  type League,
  normalizeEspn,
  readSnapshot,
  type Snapshot,
  standingsThrough,
} from "../src/index.ts";
import type { Json } from "./support/workspace.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "espn");
const HOT_TAKERY = join(FIXTURES, "hot-takery-2025");
const FAMILY = join(FIXTURES, "family-league-2025");

async function snapshotOf(dir: string, week: number): Promise<Snapshot> {
  const weeks = JSON.parse(await readFile(join(dir, "weeks.json"), "utf8"));
  return readSnapshot(dir, weeks[String(week)]);
}

async function committed(dir: string, week: number): Promise<League> {
  return normalizeEspn(await snapshotOf(dir, week));
}

const base = (leagueId: string) => espnLeagueUrl("2025", leagueId);
const LEAGUE = (id: string) => espnViewUrl(base(id), ESPN_VIEWS.league);
const BOX = (id: string) => espnViewUrl(base(id), ESPN_VIEWS.boxscores);
const TX = (id: string) => espnViewUrl(base(id), ESPN_VIEWS.transactions);

/** A snapshot whose payload for `url` (and `params`) is changed by `patch`. */
function patched(
  snapshot: Snapshot,
  url: string,
  patch: (json: Json) => void,
  params?: Record<string, string>,
): Snapshot {
  const same = (u: string, p?: Record<string, string>) =>
    u === url && JSON.stringify(p ?? {}) === JSON.stringify(params ?? {});
  return {
    ...snapshot,
    json(u, p) {
      const json = snapshot.json(u, p);
      if (!same(u, p)) return json;
      const copy = structuredClone(json);
      patch(copy);
      return copy;
    },
  };
}

/** The raw payload of one request, for checking the model against ESPN's own numbers. */
function raw(snapshot: Snapshot, url: string, params?: Record<string, string>) {
  return snapshot.json(url, params) as Json;
}

const HOT_WEEKS = [1, 7, 8, 9, 10, 14, 15];
const FAMILY_WEEKS = [14, 15];

describe("the ESPN normalizer on Hot Takery 2025", () => {
  test("names the league and reads its settings", async () => {
    const league = await committed(HOT_TAKERY, 15);
    expect(league).toMatchObject({
      platform: "espn",
      leagueId: "900000001",
      season: "2025",
      name: "The Hot Takery League 2.0",
      lastScoredWeek: 15,
    });
    expect(league.settings).toMatchObject({
      playoffTeams: 8,
      playoffStartWeek: 15,
      regularSeasonWeeks: 14,
      faabBudget: null,
      median: false,
      divisions: 0,
      keepers: null,
    });
    expect(league.settings.lineupSlots.map((s) => s.slot)).toEqual([
      "QB",
      "RB",
      "RB",
      "WR",
      "WR",
      "TE",
      "DEF",
      "K",
      "FLEX",
    ]);
    expect(league.teams.map((t) => t.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `espn:${i + 1}`),
    );
  });

  test("a matchup score is the players' points plus the home side's playoff bonus, consolation included", async () => {
    const league = await committed(HOT_TAKERY, 15);
    const week = league.weeks.find((w) => w.week === 15);
    expect(week?.matchups).toHaveLength(6);
    for (const m of week?.matchups ?? []) {
      const [home, away] = m.sides;
      const points = (s: typeof home) =>
        s.lineup
          .filter((e) => e.slot !== "BN")
          .reduce((sum, e) => sum + e.points, 0);
      expect(home.score).toBeCloseTo(points(home) + 1, 6);
      expect(away.score).toBeCloseTo(points(away), 6);
    }
  });

  test("starters' points sum to ESPN's own total for the week, in every side of every committed week", async () => {
    let sides = 0;
    for (const week of HOT_WEEKS) {
      const snapshot = await snapshotOf(HOT_TAKERY, week);
      const league = normalizeEspn(snapshot);
      for (const w of league.weeks) {
        const box = raw(snapshot, BOX("900000001"), {
          scoringPeriodId: String(w.week),
        });
        const reported = new Map<string, number>();
        for (const g of box.schedule) {
          for (const side of [g.home, g.away]) {
            if (side) {
              reported.set(
                `espn:${side.teamId}`,
                side.pointsByScoringPeriod[String(w.week)],
              );
            }
          }
        }
        for (const m of w.matchups) {
          for (const s of m.sides) {
            const sum = s.lineup
              .filter((e) => e.slot !== "BN")
              .reduce((t, e) => t + e.points, 0);
            expect(sum, `${s.team} week ${w.week}`).toBeCloseTo(
              reported.get(s.team) as number,
              6,
            );
            sides++;
          }
        }
      }
    }
    expect(sides).toBeGreaterThan(200);
  });

  test("projections never reach the model: week 1 holds them in its box scores", async () => {
    const snapshot = await snapshotOf(HOT_TAKERY, 1);
    const box = raw(snapshot, BOX("900000001"), { scoringPeriodId: "1" });
    const projected = box.schedule.flatMap((g: Json) =>
      g.home.rosterForCurrentScoringPeriod.entries.flatMap((e: Json) =>
        e.playerPoolEntry.player.stats.filter(
          (s: Json) => s.statSourceId === 1,
        ),
      ),
    );
    expect(projected.length).toBeGreaterThan(0);
    // Each starter's points are the actual line, so the sums above only hold
    // when the projections were left out; here a projection is made huge.
    const league = normalizeEspn(
      patched(
        snapshot,
        BOX("900000001"),
        (json) => {
          for (const g of json.schedule) {
            for (const e of g.home.rosterForCurrentScoringPeriod.entries) {
              for (const s of e.playerPoolEntry.player.stats) {
                if (s.statSourceId === 1) s.appliedTotal = 999;
              }
            }
          }
        },
        { scoringPeriodId: "1" },
      ),
    );
    const lineups = league.weeks[0]?.matchups.flatMap((m) =>
      m.sides.flatMap((s) => s.lineup),
    );
    expect(lineups?.every((e) => e.points < 100)).toBe(true);
  });

  test("a regular-season week has regular matchups with no round; the playoffs number their rounds from 1", async () => {
    const league = await committed(HOT_TAKERY, 15);
    const wk14 = league.weeks.find((w) => w.week === 14);
    expect(
      wk14?.matchups.every((m) => m.kind === "regular" && !("round" in m)),
    ).toBe(true);
    const wk15 = league.weeks.find((w) => w.week === 15);
    expect(wk15?.matchups.map((m) => [m.kind, m.round])).toEqual([
      ["winners", 1],
      ["winners", 1],
      ["winners", 1],
      ["winners", 1],
      ["losers", 1],
      ["losers", 1],
    ]);
    expect(wk15?.byes).toEqual([]);
  });

  test("a scored matchup has a result on both sides, the winner's W", async () => {
    const league = await committed(HOT_TAKERY, 14);
    const first = league.weeks.find((w) => w.week === 14)?.matchups[0];
    // Team 10 (away) beat team 9 in the raw schedule.
    expect(first?.sides.map((s) => [s.team, s.result])).toEqual([
      ["espn:9", "L"],
      ["espn:10", "W"],
    ]);
    expect(first?.sides.some((s) => s.tiebreak)).toBe(false);
  });

  test("lastScoredWeek is the last week with every winner decided, one snapshot per ranking week", async () => {
    for (const week of HOT_WEEKS) {
      const league = await committed(HOT_TAKERY, week);
      expect(league.lastScoredWeek, `week ${week}`).toBe(week);
      expect(league.weeks.map((w) => w.week)).toEqual(
        Array.from({ length: week }, (_, i) => i + 1),
      );
      expect(league.weeks.every((w) => w.scored)).toBe(true);
    }
  });

  test("an unplayed week is in progress, with no results", async () => {
    const snapshot = await snapshotOf(HOT_TAKERY, 14);
    const league = normalizeEspn(
      patched(
        snapshot,
        espnViewUrl(base("900000001"), ESPN_VIEWS.schedule),
        (json) => {
          for (const g of json.schedule) {
            if (g.matchupPeriodId === 14) g.winner = "UNDECIDED";
          }
        },
      ),
    );
    expect(league.lastScoredWeek).toBe(13);
    const wk14 = league.weeks.find((w) => w.week === 14);
    expect(wk14?.scored).toBe(false);
    expect(wk14?.matchups.flatMap((m) => m.sides.map((s) => s.result))).toEqual(
      Array(12).fill(undefined),
    );
  });

  test("IR and bench slots are the bench in a lineup, and IR is kept on the roster", async () => {
    const snapshot = await snapshotOf(HOT_TAKERY, 15);
    const league = normalizeEspn(snapshot);
    const rawBox = raw(snapshot, BOX("900000001"), { scoringPeriodId: "15" });
    const ir = rawBox.schedule
      .flatMap((g: Json) => [g.home, g.away])
      .flatMap((s: Json) => s.rosterForCurrentScoringPeriod.entries)
      .filter((e: Json) => e.lineupSlotId === 21);
    expect(ir.length).toBeGreaterThan(0);
    const lineups = league.weeks
      .find((w) => w.week === 15)
      ?.matchups.flatMap((m) => m.sides.flatMap((s) => s.lineup));
    for (const e of ir) {
      const entry = lineups?.find((l) => l.player === String(e.playerId));
      expect(entry?.slot).toBe("BN");
    }
    const statuses = new Set(
      league.teams.flatMap((t) => t.roster.map((r) => r.status)),
    );
    expect(statuses).toEqual(new Set(["starter", "bench", "IR"]));
  });

  test("players come with a name, position and NFL team; a defense is DEF", async () => {
    const league = await committed(HOT_TAKERY, 15);
    expect(league.players["3117251"]).toMatchObject({
      name: "Christian McCaffrey",
      position: "RB",
      nflTeam: "SF",
    });
    expect(
      Object.values(league.players).some((p) => p.position === "DEF"),
    ).toBe(true);
  });

  test("standings through each week match ESPN's own seeds", async () => {
    for (const week of [7, 8, 9, 10, 14]) {
      const snapshot = await snapshotOf(HOT_TAKERY, week);
      const league = normalizeEspn(snapshot);
      const seeds = new Map<string, number>(
        raw(snapshot, LEAGUE("900000001")).teams.map((t: Json) => [
          `espn:${t.id}`,
          t.playoffSeed,
        ]),
      );
      const ranked = standingsThrough(league, week);
      expect(
        ranked.map((s) => seeds.get(s.team)),
        `week ${week}`,
      ).toEqual(ranked.map((_, i) => i + 1));
    }
  });
});

describe("the ESPN normalizer on the Family League 2025", () => {
  test("keeps ESPN's team IDs, with their gaps", async () => {
    const league = await committed(FAMILY, 15);
    expect(league.teams.map((t) => t.id)).toEqual(
      [1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 15].map((n) => `espn:${n}`),
    );
  });

  test("a playoff bye is a bye with no result, in the winners round", async () => {
    const league = await committed(FAMILY, 15);
    const wk = league.weeks.find((w) => w.week === 15);
    expect(wk?.byes).toEqual(["espn:4", "espn:14"]);
    expect(wk?.matchups).toHaveLength(5);
    expect(wk?.matchups.filter((m) => m.kind === "winners")).toHaveLength(2);
    expect(wk?.matchups.filter((m) => m.kind === "losers")).toHaveLength(3);
    const everyone = wk?.matchups.flatMap((m) => m.sides.map((s) => s.team));
    expect(everyone).not.toContain("espn:4");
  });

  test("a co-owned team has each owner as a manager, named from the members", async () => {
    const league = await committed(FAMILY, 15);
    const team = league.teams.find((t) => t.id === "espn:3");
    expect(team?.managers).toHaveLength(2);
    expect(
      team?.managers.every(
        (m) => m.displayName && !m.displayName.startsWith("{"),
      ),
    ).toBe(true);
    expect(team?.name).toBe("Blitz Brigade");
  });

  test("the season's slot layout, with its OP slot and no kicker", async () => {
    const league = await committed(FAMILY, 15);
    expect(league.settings.lineupSlots.map((s) => s.slot)).toEqual([
      "QB",
      "RB",
      "RB",
      "WR",
      "WR",
      "TE",
      "OP",
      "DEF",
      "FLEX",
    ]);
    expect(league.settings.lineupSlots[6]?.positions).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
    ]);
    expect(league.settings.playoffTeams).toBe(6);
  });

  test("lastScoredWeek counts the week with byes as scored", async () => {
    for (const week of FAMILY_WEEKS) {
      expect((await committed(FAMILY, week)).lastScoredWeek).toBe(week);
    }
  });
});

describe("the ESPN normalizer with changed payloads", () => {
  const hot = () => snapshotOf(HOT_TAKERY, 14);

  test("a tie is a T on both sides", async () => {
    const league = normalizeEspn(
      patched(
        await hot(),
        BOX("900000001"),
        (json) => {
          const g = json.schedule[0];
          g.winner = "TIE";
          g.home.totalPoints = g.away.totalPoints = 100;
        },
        { scoringPeriodId: "14" },
      ),
    );
    const m = league.weeks.find((w) => w.week === 14)?.matchups[0];
    expect(m?.sides.map((s) => s.result)).toEqual(["T", "T"]);
    expect(m?.sides.some((s) => s.tiebreak)).toBe(false);
  });

  test("a tied score decided by the tie rule has the win and is marked as a tiebreak", async () => {
    const league = normalizeEspn(
      patched(
        await hot(),
        BOX("900000001"),
        (json) => {
          const g = json.schedule[0];
          g.winner = "HOME";
          g.home.totalPoints = g.away.totalPoints = 100;
        },
        { scoringPeriodId: "14" },
      ),
    );
    const m = league.weeks.find((w) => w.week === 14)?.matchups[0];
    expect(m?.sides.map((s) => [s.result, s.tiebreak])).toEqual([
      ["W", true],
      ["L", true],
    ]);
  });

  test("FAAB is read only when the league uses an acquisition budget", async () => {
    const league = normalizeEspn(
      patched(await hot(), LEAGUE("900000001"), (json) => {
        json.settings.acquisitionSettings.isUsingAcquisitionBudget = true;
        json.settings.acquisitionSettings.acquisitionBudget = 200;
      }),
    );
    expect(league.settings.faabBudget).toBe(200);
  });

  test("names lose the spaces at their ends, and an empty one falls to the manager's", async () => {
    const league = normalizeEspn(
      patched(await hot(), LEAGUE("900000001"), (json) => {
        json.teams[0].name = "Team C ";
        json.teams[1].name = "   ";
        for (const m of json.members) m.displayName = ` ${m.displayName} `;
      }),
    );
    expect(league.teams[0]?.name).toBe("Team C");
    expect(league.teams[1]?.name).toBe(
      league.teams[1]?.managers[0]?.displayName,
    );
    expect(league.teams[1]?.name).not.toMatch(/^\s|\s$/);
    expect(league.teams[0]?.managers[0]?.displayName).not.toMatch(/^\s|\s$/);
  });

  test("a league whose playoff rounds last more than a week is refused", async () => {
    const snapshot = patched(await hot(), LEAGUE("900000001"), (json) => {
      json.settings.scheduleSettings.playoffMatchupPeriodLength = 2;
    });
    expect(() => normalizeEspn(snapshot)).toThrow(/one-week rounds/);
  });

  test("a league that breaks seeding ties head to head is refused, since the standings order would be wrong", async () => {
    const snapshot = patched(await hot(), LEAGUE("900000001"), (json) => {
      json.settings.scheduleSettings.playoffSeedingRule = "H2H_RECORD";
    });
    expect(() => normalizeEspn(snapshot)).toThrow(
      /H2H_RECORD.*total points scored/s,
    );
  });

  test("a league with no seeding rule named is read as the committed ones are", async () => {
    const league = normalizeEspn(
      patched(await hot(), LEAGUE("900000001"), (json) => {
        delete json.settings.scheduleSettings.playoffSeedingRule;
      }),
    );
    expect(league.settings.playoffTeams).toBe(8);
  });

  test("a playoff tier this version doesn't read is refused, not read as the winners bracket", async () => {
    const snapshot = patched(
      await snapshotOf(HOT_TAKERY, 15),
      BOX("900000001"),
      (json) => {
        json.schedule[0].playoffTierType = "SOMETHING_NEW";
      },
      { scoringPeriodId: "15" },
    );
    expect(() => normalizeEspn(snapshot)).toThrow(/SOMETHING_NEW/);
  });

  test("a payload this version can't read is named", async () => {
    const snapshot = patched(await hot(), LEAGUE("900000001"), (json) => {
      delete json.settings;
    });
    expect(() => normalizeEspn(snapshot)).toThrow(
      /isn't an ESPN payload we understand/,
    );
  });
});

describe("ESPN transactions", () => {
  const hot = () => snapshotOf(HOT_TAKERY, 14);

  test("keeps the adds and drops that went through, and leaves out drafts, lineup moves and failed claims", async () => {
    const snapshot = await hot();
    const league = normalizeEspn(snapshot);
    const kinds = new Set(league.transactions.map((t) => t.kind));
    expect(kinds).toEqual(new Set(["waiver", "free_agent"]));
    const ids = new Set(
      [10, 11, 12, 13].flatMap((w) =>
        raw(snapshot, TX("900000001"), { scoringPeriodId: String(w) })
          .transactions.filter((t: Json) => t.status?.startsWith("FAILED"))
          .map((t: Json) => t.id),
      ),
    );
    expect(ids.size).toBeGreaterThan(0);
    expect(league.transactions.some((t) => ids.has(t.id))).toBe(false);
    for (const t of league.transactions) {
      expect(t.adds.length + t.drops.length).toBeGreaterThan(0);
    }
  });

  test("a transaction one week's answer repeats counts once, in its own week", async () => {
    const snapshot = await hot();
    const before = normalizeEspn(snapshot).transactions;
    const week13 = raw(snapshot, TX("900000001"), {
      scoringPeriodId: "13",
    }).transactions.find((t: Json) => t.type === "FREEAGENT");
    const week14 = patched(
      snapshot,
      TX("900000001"),
      (json) => {
        json.transactions.push(structuredClone(week13));
      },
      { scoringPeriodId: "14" },
    );
    const after = normalizeEspn(week14).transactions;
    expect(after).toHaveLength(before.length);
    expect(after.find((t) => t.id === week13.id)?.week).toBe(13);
  });

  test("a transaction with period 0 is in the week it was asked for", async () => {
    const snapshot = await hot();
    const league = normalizeEspn(
      patched(
        snapshot,
        TX("900000001"),
        (json) => {
          const t = json.transactions.find((x: Json) => x.type === "FREEAGENT");
          t.scoringPeriodId = 0;
        },
        { scoringPeriodId: "14" },
      ),
    );
    expect(league.transactions.every((t) => t.week >= 1)).toBe(true);
  });

  test("an executed trade proposal is a trade between its teams", async () => {
    const snapshot = await hot();
    const league = normalizeEspn(
      patched(
        snapshot,
        TX("900000001"),
        (json) => {
          json.transactions.push({
            id: "trade-1",
            type: "TRADE_PROPOSAL",
            status: "EXECUTED",
            teamId: 8,
            scoringPeriodId: 14,
            proposedDate: 1764000000000,
            items: [
              { type: "TRADE", playerId: 11, fromTeamId: 8, toTeamId: 10 },
              { type: "TRADE", playerId: 12, fromTeamId: 10, toTeamId: 8 },
            ],
          });
        },
        { scoringPeriodId: "14" },
      ),
    );
    const trade = league.transactions.find((t) => t.id === "trade-1");
    expect(trade).toMatchObject({
      kind: "trade",
      week: 14,
      teams: ["espn:8", "espn:10"],
    });
    expect(trade?.adds).toEqual([
      { player: "11", team: "espn:10" },
      { player: "12", team: "espn:8" },
    ]);
    expect(trade?.drops).toEqual([
      { player: "11", team: "espn:8" },
      { player: "12", team: "espn:10" },
    ]);
  });
});
