import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FAMILY_LEAGUE_2025_WEEKS,
  FAMILY_LEAGUE_ID,
  HOT_TAKERY_2025_WEEKS,
  HOT_TAKERY_ID,
  scrubEspnFixtures,
} from "../scripts/scrub-espn.ts";
import { ESPN_VIEWS, espnLeagueUrl, espnViewUrl } from "../src/espn/api.ts";
import {
  type Clock,
  fetchEspnSnapshot,
  fileTransport,
  readBlob,
  readManifest,
  requestKey,
} from "../src/index.ts";
import type { Json } from "./support/workspace.ts";

const ROOT = join(import.meta.dirname, "..");
const DENYLIST = join(ROOT, "fixtures", "denylist.txt");

const SETS = [
  {
    name: "Hot Takery 2025",
    dir: join(ROOT, "fixtures", "espn", "hot-takery-2025"),
    raw: join(ROOT, "fixtures", "raw", "espn", "hot-takery-league-2025"),
    leagueId: HOT_TAKERY_ID,
    weeks: HOT_TAKERY_2025_WEEKS,
  },
  {
    name: "The Family League 2025",
    dir: join(ROOT, "fixtures", "espn", "family-league-2025"),
    raw: join(ROOT, "fixtures", "raw", "espn", "the-family-league-2025"),
    leagueId: FAMILY_LEAGUE_ID,
    weeks: FAMILY_LEAGUE_2025_WEEKS,
  },
] as const;
const [HOT_TAKERY, FAMILY_LEAGUE] = SETS;

/** Week → snapshot ID of a committed set. */
async function committedWeeks(dir: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(dir, "weeks.json"), "utf8"));
}

/** One view's payload from a week's snapshot (a week's box scores with `scoringPeriodId`). */
async function payload(
  set: (typeof SETS)[number],
  week: number,
  views: readonly string[],
  scoringPeriodId?: number,
): Promise<Json> {
  const id = (await committedWeeks(set.dir))[String(week)] as string;
  const manifest = await readManifest(set.dir, id);
  const url = espnViewUrl(espnLeagueUrl("2025", set.leagueId), views);
  const params: Record<string, string> =
    scoringPeriodId === undefined
      ? {}
      : { scoringPeriodId: String(scoringPeriodId) };
  const request = manifest.requests.find(
    (r) => requestKey(r) === requestKey({ url, params }),
  );
  if (!request) throw new Error(`no ${views} in week ${week}`);
  return JSON.parse(
    new TextDecoder().decode(await readBlob(set.dir, request.sha256)),
  );
}

/** Every committed payload and manifest of a set, as text. */
async function committedText(dir: string): Promise<string[]> {
  const texts: string[] = [];
  for (const id of Object.values(await committedWeeks(dir))) {
    const manifest = await readManifest(dir, id);
    texts.push(JSON.stringify(manifest));
    for (const r of manifest.requests) {
      texts.push(new TextDecoder().decode(await readBlob(dir, r.sha256)));
    }
  }
  return texts;
}

describe("committed ESPN fixtures", () => {
  test("hold Hot Takery's eval weeks and the week before each, and The Family League's last regular-season and first playoff weeks", async () => {
    expect(Object.keys(await committedWeeks(HOT_TAKERY.dir))).toEqual([
      "1",
      "7",
      "8",
      "9",
      "10",
      "14",
      "15",
    ]);
    expect(Object.keys(await committedWeeks(FAMILY_LEAGUE.dir))).toEqual([
      "14",
      "15",
    ]);
  });

  test("each snapshot is as of its week: current week, box scores, records and seeds to match", async () => {
    const league10 = await payload(HOT_TAKERY, 10, ESPN_VIEWS.league);
    expect(league10.scoringPeriodId).toBe(10);
    expect(league10.status.currentMatchupPeriod).toBe(10);
    // Independent literals: team 2 was 9-1 after week 10 and finished 11-3, first seed.
    const team2 = league10.teams.find((t: Json) => t.id === 2);
    expect(team2.record.overall).toMatchObject({ wins: 9, losses: 1 });
    expect(team2.playoffSeed).toBe(1);
    expect(team2.rankCalculatedFinal).toBe(0);
    // Nothing from later weeks: transaction period, each week's acquisitions.
    expect(league10.status.transactionScoringPeriod).toBe(10);
    const acquisitionWeeks = league10.teams.flatMap((t: Json) =>
      Object.keys(t.transactionCounter.matchupAcquisitionTotals).map(Number),
    );
    expect(acquisitionWeeks.length).toBeGreaterThan(0);
    expect(Math.max(...acquisitionWeeks)).toBeLessThanOrEqual(10);
    await expect(
      payload(HOT_TAKERY, 10, ESPN_VIEWS.boxscores, 11),
    ).rejects.toThrow();

    // Later regular-season weeks are listed unplayed; playoff rounds not yet set aren't listed.
    const schedule10 = await payload(HOT_TAKERY, 10, ESPN_VIEWS.schedule);
    const week11 = schedule10.schedule.filter(
      (m: Json) => m.matchupPeriodId === 11,
    );
    expect(week11).toHaveLength(6);
    expect(week11.every((m: Json) => m.winner === "UNDECIDED")).toBe(true);
    expect(schedule10.schedule.some((m: Json) => m.matchupPeriodId > 14)).toBe(
      false,
    );

    // Once the regular season is scored, round 1 is set but unplayed.
    const schedule14 = await payload(HOT_TAKERY, 14, ESPN_VIEWS.schedule);
    const round1 = schedule14.schedule.filter(
      (m: Json) => m.matchupPeriodId === 15,
    );
    expect(
      round1.map((m: Json) => `${m.home.teamId}v${m.away.teamId}`),
    ).toContain("2v5");
    expect(round1.every((m: Json) => m.winner === "UNDECIDED")).toBe(true);
    const schedule15 = await payload(HOT_TAKERY, 15, ESPN_VIEWS.schedule);
    expect(
      schedule15.schedule.filter((m: Json) => m.matchupPeriodId === 16),
    ).toHaveLength(6);
    expect(
      schedule15.schedule.some((m: Json) => m.matchupPeriodId === 17),
    ).toBe(false);

    const team2At14 = (
      await payload(HOT_TAKERY, 14, ESPN_VIEWS.league)
    ).teams.find((t: Json) => t.id === 2);
    expect(team2At14.record.overall).toMatchObject({ wins: 11, losses: 3 });
  });

  test("The Family League keeps its team IDs with gaps, and its week-15 byes", async () => {
    const league = await payload(FAMILY_LEAGUE, 15, ESPN_VIEWS.league);
    expect(league.teams.map((t: Json) => t.id)).toEqual([
      1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 15,
    ]);
    const box = await payload(FAMILY_LEAGUE, 15, ESPN_VIEWS.boxscores, 15);
    const byes = box.schedule.filter((m: Json) => m.away === undefined);
    expect(byes.map((m: Json) => [m.home.teamId, m.winner])).toEqual([
      [4, "UNDECIDED"],
      [14, "UNDECIDED"],
    ]);
  });

  test("keep projections only in week 1's box scores", async () => {
    const sources = (p: Json) =>
      new Set(
        JSON.stringify(p)
          .match(/"statSourceId":\d+/g)
          ?.map((s) => s.split(":")[1]),
      );
    expect(
      sources(await payload(HOT_TAKERY, 8, ESPN_VIEWS.boxscores, 1)),
    ).toEqual(new Set(["0", "1"]));
    expect(
      sources(await payload(HOT_TAKERY, 8, ESPN_VIEWS.boxscores, 8)),
    ).toEqual(new Set(["0"]));
    expect(sources(await payload(HOT_TAKERY, 8, ESPN_VIEWS.rosters))).toEqual(
      new Set(["0"]),
    );
  });

  test.each(SETS)(
    "$name replays through the file transport into an identical snapshot",
    async (set) => {
      for (const [week, id] of Object.entries(await committedWeeks(set.dir))) {
        const manifest = await readManifest(set.dir, id);
        const clock: Clock = { now: () => new Date(manifest.fetched_at) };
        const replayed = await fetchEspnSnapshot({
          transport: fileTransport(set.dir, id),
          clock,
          snapshotsDir: await mkdtemp(join(tmpdir(), "lazy-pundit-")),
          leagueId: manifest.league_id,
          season: manifest.season,
        });
        expect(replayed.id, `week ${week}`).toBe(id);
        expect(replayed.manifest).toEqual(manifest);
      }
    },
  );

  const denylist = existsSync(DENYLIST)
    ? readFileSync(DENYLIST, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    : [];

  test.skipIf(denylist.length === 0)(
    "contain no real name from the denylist (fixtures/denylist.txt, never committed)",
    async () => {
      const texts = [
        ...(await committedText(HOT_TAKERY.dir)),
        ...(await committedText(FAMILY_LEAGUE.dir)),
      ];
      const found = denylist.filter((name) =>
        texts.some((t) => wholeWord(name).test(t)),
      );
      expect(found).toEqual([]);
    },
  );
});

describe.each(SETS)("scrubbing the full raw $name (local only)", (set) => {
  const hasRaw = existsSync(set.raw);

  test.skipIf(!hasRaw)("reproduces the committed set exactly", async () => {
    const out = await mkdtemp(join(tmpdir(), "lazy-pundit-scrub-"));
    await scrubEspnFixtures({
      rawDir: set.raw,
      outDir: out,
      leagueId: set.leagueId,
      weeks: [...set.weeks],
    });
    expect(await readFile(join(out, "weeks.json"), "utf8")).toBe(
      await readFile(join(set.dir, "weeks.json"), "utf8"),
    );
    expect((await readdir(join(out, "blobs"))).sort()).toEqual(
      (await readdir(join(set.dir, "blobs"))).sort(),
    );
  });

  test.skipIf(!hasRaw)(
    "leaves no real member name or ID, team name, abbreviation, logo or league ID behind",
    async () => {
      const realNames = await realIdentifiers(set.raw);
      expect(realNames.length).toBeGreaterThan(30);
      const texts = await committedText(set.dir);
      const found = realNames.filter((name) =>
        texts.some((t) => t.includes(name)),
      );
      expect(found).toEqual([]);

      // First names and short abbreviations are also NFL players' names, so
      // they're checked where they're listed, not across the whole text.
      const raw = JSON.parse(
        await readFile(join(set.raw, "league.json"), "utf8"),
      );
      for (const week of set.weeks) {
        const league = await payload(set, week, ESPN_VIEWS.league);
        const listed = [
          ...league.members.flatMap((m: Json) => [m.firstName, m.lastName]),
          ...league.teams.map((t: Json) => t.abbrev),
        ];
        const real = [
          ...raw.members.flatMap((m: Json) => [m.firstName, m.lastName]),
          ...raw.teams.map((t: Json) => t.abbrev),
        ];
        expect(listed.filter((n) => real.includes(n))).toEqual([]);
      }
    },
  );
});

/** Matches `name` as a whole word, ignoring case, so "Al" doesn't hit "total". */
function wholeWord(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

/**
 * The identifying strings in the raw league payload, read straight from the
 * file: whole names only, since a first name alone can be an NFL player's.
 */
async function realIdentifiers(rawDir: string): Promise<string[]> {
  const league = JSON.parse(
    await readFile(join(rawDir, "league.json"), "utf8"),
  );
  const names: string[] = [
    String(league.id),
    ...league.members.flatMap((m: Json) => [
      m.id,
      m.displayName,
      `${m.firstName} ${m.lastName}`,
    ]),
    ...league.teams.flatMap((t: Json) => [t.name, t.logo, ...(t.owners ?? [])]),
  ];
  // Very short strings would match by accident; they're covered by the denylist instead.
  return [...new Set(names.filter((n) => typeof n === "string"))].filter(
    (n) => n.trim().length >= 4,
  );
}
