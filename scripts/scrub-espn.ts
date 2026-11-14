/**
 * Dev only. Turns the private raw ESPN fixtures (the local `fixtures/raw`
 * branch, never pushed) into the small anonymized snapshot sets committed to
 * `main`: Hot Takery 2025 (its eval weeks) and The Family League 2025 (its
 * playoff byes and its team IDs with gaps).
 *
 *   npm run fixtures:raw   # untracked, gitignored
 *   npm run scrub:espn
 *
 * The raw files were fetched after the 2025 season ended. Each output snapshot
 * replays the season as of one ranking week N, as if fetched the Tuesday after
 * week N with week N already scored: ESPN's current week is N, only weeks
 * 1..N have box scores, later regular-season matchups are unplayed, a playoff
 * round appears once the round before it is played, and each team's record
 * (overall, home, away, division), points and seed are rebuilt from weeks
 * 1..N. Seeds follow record, then points for, as ESPN's own did in every
 * raw league (#35); once the regular season is over they're ESPN's own. Each
 * team's acquisitions by week stop at week N, and so does the transaction
 * period. Each week's box scores are as they stood that week, records
 * included, so a week's payload is the same in every snapshot that holds it.
 * Current rosters, injuries, season transaction counts and season stat totals
 * stay as they were at the end.
 *
 * Trimmed, as payloads too large to commit: projected stat lines
 * (`statSourceId` 1) everywhere except week 1's box scores, which every
 * snapshot holds and which keep their lineups' projections for that week, so
 * the normalizer's filter has projections to filter; and every per-stat
 * breakdown of a matchup (`scoreByStat`), which
 * only category leagues use. Members' names and IDs, team names,
 * abbreviations and logos, and the league ID become deterministic fakes;
 * the league's name is kept. The snapshots are written by the real fetcher,
 * so the fixture format is the snapshot format.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ESPN_VIEWS, espnLeagueUrl, espnViewUrl } from "../src/espn/api.ts";
import { fetchEspnSnapshot, requestKey, type Transport } from "../src/index.ts";

/** Week 1, a mid-season week, the first clinch week (team 2, week 10), the first playoff week, and the week before each. */
export const HOT_TAKERY_2025_WEEKS = [1, 7, 8, 9, 10, 14, 15];
/** The last regular-season week, and the first playoff week, with its 2 byes. */
export const FAMILY_LEAGUE_2025_WEEKS = [14, 15];

export const HOT_TAKERY_ID = "900000001";
export const FAMILY_LEAGUE_ID = "900000002";

/** Tuesday after week 1 of the 2025 NFL season, noon UTC. */
const FIRST_TUESDAY_2025 = Date.UTC(2025, 8, 9, 12);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const FAKE_MANAGERS = [
  "audible_andy",
  "blitz_betty",
  "coffin_corner_cal",
  "dime_back_dee",
  "end_zone_ed",
  "fair_catch_fay",
  "goal_line_gil",
  "hash_mark_hank",
  "i_formation_ivy",
  "jet_sweep_jo",
  "kneel_down_kai",
  "lateral_lou",
  "muffed_punt_mo",
  "nickel_nell",
  "onside_ollie",
  "pick_six_pam",
];

const FAKE_TEAMS = [
  "Audible Antics",
  "Blitz Brigade",
  "Coffin Corner Crew",
  "Dime Piece Defense",
  "End Zone Express",
  "Fair Catch Fanatics",
  "Goal Line Goblins",
  "Hash Mark Heroes",
  "Ivy Formation",
  "Jet Sweep Jets",
  "Kneel Down Kings",
  "Lateral Thinkers",
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

interface Raw {
  league: Obj;
  schedule: Obj;
  rosters: Obj;
  /** Each week's transactions, asked for week by week as the fetcher does. */
  transactions: Map<number, Obj>;
  boxscores: Map<number, Obj>;
}

export async function scrubEspnFixtures(opts: {
  rawDir: string;
  outDir: string;
  leagueId: string;
  weeks: number[];
}): Promise<Record<string, string>> {
  const raw = trimmed(
    scrubIdentities(await readRaw(opts.rawDir), opts.leagueId),
  );
  const season = String(raw.league.seasonId);

  await rm(opts.outDir, { recursive: true, force: true });
  await mkdir(opts.outDir, { recursive: true });

  const ids: Record<string, string> = {};
  for (const week of opts.weeks) {
    const { id } = await fetchEspnSnapshot({
      transport: servePayloads(asOfWeek(raw, week, opts.leagueId)),
      clock: { now: () => new Date(FIRST_TUESDAY_2025 + (week - 1) * WEEK_MS) },
      snapshotsDir: opts.outDir,
      leagueId: opts.leagueId,
      season,
    });
    ids[String(week)] = id;
  }
  await writeFile(
    join(opts.outDir, "weeks.json"),
    `${JSON.stringify(ids, null, 2)}\n`,
  );
  return ids;
}

async function readRaw(dir: string): Promise<Raw> {
  const read = async (f: string) =>
    JSON.parse(await readFile(join(dir, f), "utf8")) as Obj;
  const byWeek = async (folder: string) => {
    const weeks = new Map<number, Obj>();
    for (const f of (await readdir(join(dir, folder))).sort()) {
      const week = Number(f.match(/^week-(\d+)\.json$/)?.[1]);
      if (week) weeks.set(week, await read(`${folder}/${f}`));
    }
    return weeks;
  };
  return {
    league: await read("league.json"),
    schedule: await read("schedule.json"),
    rosters: await read("rosters.json"),
    transactions: await byWeek("transactions"),
    boxscores: await byWeek("boxscores"),
  };
}

/** Replaces every member's name and ID, team names and logos, and the league ID. */
function scrubIdentities(raw: Raw, leagueId: string): Raw {
  const teams = [...(raw.league.teams as Obj[])].sort(
    (a, b) => Number(a.id) - Number(b.id),
  );
  // Number members by the first team they manage, so fakes don't depend on file order.
  const order = (id: string) => {
    const i = teams.findIndex((t) => (t.owners as Json[]).includes(id));
    return i === -1 ? 99 : i;
  };
  const realIds = (raw.league.members as Obj[])
    .map((m) => String(m.id))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const memberIds = new Map(realIds.map((id, i) => [id, fakeMemberId(i)]));
  const fakeMember = (id: Json): Json => {
    if (typeof id !== "string") return id;
    if (!memberIds.has(id)) memberIds.set(id, fakeMemberId(memberIds.size));
    return memberIds.get(id) as string;
  };
  const teamIndex = new Map(teams.map((t, i) => [Number(t.id), i]));

  /** A team as any payload lists it: name, abbreviation, logo and owners faked. */
  const team = (t: Obj): Obj => {
    const i = teamIndex.get(Number(t.id)) ?? 0;
    const name = FAKE_TEAMS[i] ?? `Team ${i + 1}`;
    const out: Obj = { ...t };
    delete out.logo;
    delete out.logoType;
    if ("name" in t) out.name = name;
    if ("abbrev" in t) out.abbrev = abbreviation(name);
    if ("location" in t) out.location = "";
    if ("nickname" in t) out.nickname = name;
    if (Array.isArray(t.owners)) out.owners = t.owners.map(fakeMember);
    if ("primaryOwner" in t) out.primaryOwner = fakeMember(t.primaryOwner);
    return out;
  };
  const payload = (p: Obj): Obj => {
    const out: Obj = { ...p, id: Number(leagueId) };
    if (Array.isArray(p.teams)) out.teams = (p.teams as Obj[]).map(team);
    return out;
  };

  const members = (raw.league.members as Obj[]).map((m): Obj => {
    const i = realIds.indexOf(String(m.id));
    const handle = FAKE_MANAGERS[i] ?? `manager_${i + 1}`;
    return {
      displayName: handle,
      firstName: handle.split("_")[0] ?? handle,
      id: fakeMember(m.id ?? null),
      isLeagueCreator: m.isLeagueCreator ?? false,
      isLeagueManager: m.isLeagueManager ?? false,
      lastName: "Example",
      notificationSettings: [],
    };
  });

  return {
    league: { ...payload(raw.league), members },
    schedule: payload(raw.schedule),
    rosters: payload(raw.rosters),
    transactions: new Map(
      [...raw.transactions].map(([w, t]) => [
        w,
        {
          ...payload(t),
          transactions: ((t.transactions ?? []) as Obj[]).map((x) => ({
            ...x,
            memberId: fakeMember(x.memberId ?? null),
          })),
        },
      ]),
    ),
    boxscores: new Map([...raw.boxscores].map(([w, b]) => [w, payload(b)])),
  };
}

/**
 * Drops what's too large to commit: projected stat lines (but week 1's, in
 * its box scores) and matchups' per-stat breakdowns.
 */
function trimmed(raw: Raw): Raw {
  const boxscores = new Map(
    [...raw.boxscores].map(([week, b]) => [
      week,
      trim(b, week === 1 ? 1 : undefined),
    ]),
  );
  return {
    league: trim(raw.league),
    schedule: trim(raw.schedule),
    rosters: trim(raw.rosters),
    transactions: new Map([...raw.transactions].map(([w, t]) => [w, trim(t)])),
    boxscores,
  };
}

/** `value` with projections dropped, keeping `keepWeek`'s in lineups. */
function trim<T extends Json>(value: T, keepWeek?: number): T {
  if (Array.isArray(value)) return value.map((v) => trim(v, keepWeek)) as T;
  if (value === null || typeof value !== "object") return value;
  const out: Obj = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "scoreByStat") out[key] = {};
    else if (key === "stats" && Array.isArray(v)) {
      out[key] = (v as Obj[])
        .filter(
          (s) =>
            s.statSourceId === 0 ||
            (keepWeek !== undefined && s.scoringPeriodId === keepWeek),
        )
        .map((s) => trim(s, keepWeek));
    } else out[key] = trim(v, keepWeek);
  }
  return out as T;
}

/** A team's record as of a week, rebuilt from the decided matchups. */
interface Split {
  wins: number;
  losses: number;
  ties: number;
  /** In cents, to avoid float drift. */
  pf: number;
  pa: number;
  streak: { type: "WIN" | "LOSS" | "TIE"; length: number } | undefined;
}

function emptySplit(): Split {
  return { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, streak: undefined };
}

function addResult(
  s: Split,
  result: "WIN" | "LOSS" | "TIE",
  pf: number,
  pa: number,
) {
  if (result === "WIN") s.wins++;
  else if (result === "LOSS") s.losses++;
  else s.ties++;
  s.pf += pf;
  s.pa += pa;
  s.streak =
    s.streak?.type === result
      ? { type: result, length: s.streak.length + 1 }
      : { type: result, length: 1 };
}

/** Each team's overall, home and away splits through `week` of the regular season. */
function recordsThrough(raw: Raw, week: number) {
  const regular = Number(
    ((raw.league.settings as Obj).scheduleSettings as Obj).matchupPeriodCount,
  );
  const splits = new Map<
    number,
    { overall: Split; home: Split; away: Split }
  >();
  for (const t of raw.league.teams as Obj[]) {
    splits.set(Number(t.id), {
      overall: emptySplit(),
      home: emptySplit(),
      away: emptySplit(),
    });
  }
  const games = (raw.schedule.schedule as Obj[])
    .filter(
      (m) => m.away && Number(m.matchupPeriodId) <= Math.min(week, regular),
    )
    .sort((a, b) => Number(a.matchupPeriodId) - Number(b.matchupPeriodId));
  for (const m of games) {
    const home = m.home as Obj;
    const away = m.away as Obj;
    const h = Math.round(Number(home.totalPoints) * 100);
    const a = Math.round(Number(away.totalPoints) * 100);
    const homeResult =
      m.winner === "HOME" ? "WIN" : m.winner === "AWAY" ? "LOSS" : "TIE";
    const awayResult =
      homeResult === "WIN" ? "LOSS" : homeResult === "LOSS" ? "WIN" : "TIE";
    const hs = splits.get(Number(home.teamId));
    const as = splits.get(Number(away.teamId));
    if (!hs || !as) continue;
    addResult(hs.overall, homeResult, h, a);
    addResult(hs.home, homeResult, h, a);
    addResult(as.overall, awayResult, a, h);
    addResult(as.away, awayResult, a, h);
  }
  return { splits, regular };
}

function percentage(s: Split): number {
  const games = s.wins + s.losses + s.ties;
  return games === 0 ? 0 : (s.wins + s.ties / 2) / games;
}

/** A split in ESPN's shape. Only the overall split carries points, as ESPN's does. */
function splitJson(s: Split, gamesBack: number, withPoints: boolean): Obj {
  return {
    gamesBack,
    losses: s.losses,
    percentage: percentage(s),
    pointsAgainst: withPoints ? s.pa / 100 : 0,
    pointsFor: withPoints ? s.pf / 100 : 0,
    streakLength: s.streak?.length ?? 0,
    streakType: s.streak?.type ?? "NONE",
    ties: s.ties,
    wins: s.wins,
  };
}

/** Teams in seed order as of a regular-season week: record, then points for. */
function seedOrder(splits: Map<number, { overall: Split }>): number[] {
  return [...splits]
    .sort(
      ([, a], [, b]) =>
        percentage(b.overall) - percentage(a.overall) ||
        b.overall.pf - a.overall.pf,
    )
    .map(([id]) => id);
}

/** The league's status as ESPN reports it with `week` the current week. */
function statusAsOf(status: Obj, week: number): Obj {
  return {
    ...status,
    currentMatchupPeriod: week,
    latestScoringPeriod: week,
    transactionScoringPeriod: week,
  };
}

/**
 * Teams as they stood after `week`, in the league payload's shape (`league`:
 * every split, points and seed) or a box score's (`boxscore`: the overall
 * W-L-T only). Once the regular season is over, records and seeds are ESPN's
 * own; the final ranks only once the season is.
 */
function teamsAsOf(
  raw: Raw,
  teams: Obj[],
  week: number,
  shape: "league" | "boxscore",
): Obj[] {
  const over = week >= Number((raw.league.status as Obj).finalScoringPeriod);
  const { splits, regular } = recordsThrough(raw, week);
  const seeds = seedOrder(splits);
  const leader = Math.max(
    ...[...splits.values()].map((s) => s.overall.wins - s.overall.losses),
  );
  return teams.map((t): Obj => {
    const out: Obj = over ? { ...t } : { ...t, rankCalculatedFinal: 0 };
    if (!over && shape === "league") out.rankFinal = 0;
    const counter = t.transactionCounter as Obj | undefined;
    if (counter?.matchupAcquisitionTotals) {
      // Each week's acquisitions, through this week only.
      out.transactionCounter = {
        ...counter,
        matchupAcquisitionTotals: Object.fromEntries(
          Object.entries(counter.matchupAcquisitionTotals as Obj).filter(
            ([w]) => Number(w) <= week,
          ),
        ),
      };
    }
    const s = splits.get(Number(t.id));
    if (week >= regular || !s) return out;
    if (shape === "boxscore") {
      const { wins, losses, ties } = s.overall;
      out.record = { overall: { losses, ties, wins } };
      return out;
    }
    const gamesBack = (leader - (s.overall.wins - s.overall.losses)) / 2;
    out.record = {
      away: splitJson(s.away, 0, false),
      division: splitJson(s.overall, gamesBack, false),
      home: splitJson(s.home, 0, false),
      overall: splitJson(s.overall, gamesBack, true),
    };
    out.points = s.overall.pf / 100;
    out.playoffSeed = seeds.indexOf(Number(t.id)) + 1;
    return out;
  });
}

/** A matchup not yet played, as ESPN lists one: no winner, no points, no lineups. */
function unplayed(m: Obj): Obj {
  const side = (s: Obj): Obj => ({
    gamesPlayed: 0,
    teamId: s.teamId ?? null,
    totalPoints: 0,
  });
  return {
    ...(m.away ? { away: side(m.away as Obj) } : {}),
    home: side(m.home as Obj),
    id: m.id ?? null,
    matchupPeriodId: m.matchupPeriodId ?? null,
    winner: "UNDECIDED",
  };
}

/** The league as the fetcher would have seen it the Tuesday after `week`. */
function asOfWeek(raw: Raw, week: number, leagueId: string): Map<string, Json> {
  const regular = Number(
    ((raw.league.settings as Obj).scheduleSettings as Obj).matchupPeriodCount,
  );
  const asOf = (p: Obj, w: number): Obj => ({
    ...p,
    scoringPeriodId: w,
    status: statusAsOf(p.status as Obj, w),
  });

  const league: Obj = {
    ...asOf(raw.league, week),
    teams: teamsAsOf(raw, raw.league.teams as Obj[], week, "league"),
  };
  // A playoff round is listed once the round before it is played.
  const schedule: Obj = {
    ...asOf(raw.schedule, week),
    schedule: (raw.schedule.schedule as Obj[]).flatMap((m): Obj[] => {
      const period = Number(m.matchupPeriodId);
      if (period <= week) return [m];
      if (period <= regular || (period === week + 1 && week >= regular)) {
        return [unplayed(m)];
      }
      return [];
    }),
  };

  const base = espnLeagueUrl(String(raw.league.seasonId), leagueId);
  const key = (views: readonly string[], params: Record<string, string> = {}) =>
    requestKey({ url: espnViewUrl(base, views), params });
  const payloads = new Map<string, Json>([
    [key(ESPN_VIEWS.league), league],
    [key(ESPN_VIEWS.schedule), schedule],
    [key(ESPN_VIEWS.rosters), asOf(raw.rosters, week)],
  ]);
  for (let w = 1; w <= week; w++) {
    const t = raw.transactions.get(w);
    if (t) {
      payloads.set(
        key(ESPN_VIEWS.transactions, { scoringPeriodId: String(w) }),
        asOf(t, w),
      );
    }
    const b = raw.boxscores.get(w);
    if (!b) continue;
    payloads.set(key(ESPN_VIEWS.boxscores, { scoringPeriodId: String(w) }), {
      ...asOf(b, w),
      teams: teamsAsOf(raw, b.teams as Obj[], w, "boxscore"),
    });
  }
  return payloads;
}

function servePayloads(payloads: Map<string, Json>): Transport {
  return {
    async request(req) {
      const body = payloads.get(requestKey(req));
      if (body === undefined) return { status: 404, body: new Uint8Array() };
      return {
        status: 200,
        body: new TextEncoder().encode(JSON.stringify(body)),
      };
    },
  };
}

/** A member ID in ESPN's braced GUID shape. */
function fakeMemberId(i: number): string {
  return `{00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}}`;
}

/** The first letters of a team name's words, as ESPN's abbreviations look. */
function abbreviation(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  for (const [raw, out, leagueId, weeks] of [
    [
      "hot-takery-league-2025",
      "hot-takery-2025",
      HOT_TAKERY_ID,
      HOT_TAKERY_2025_WEEKS,
    ],
    [
      "the-family-league-2025",
      "family-league-2025",
      FAMILY_LEAGUE_ID,
      FAMILY_LEAGUE_2025_WEEKS,
    ],
  ] as const) {
    const ids = await scrubEspnFixtures({
      rawDir: join(root, "fixtures/raw/espn", raw),
      outDir: join(root, "fixtures/espn", out),
      leagueId,
      weeks: [...weeks],
    });
    console.log(`Wrote ${out} snapshots:`, ids);
  }
}
