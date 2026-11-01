/**
 * Dev only. Turns the private raw Sleeper fixtures (the local `fixtures/raw`
 * branch, never pushed) into the small anonymized snapshot set committed to
 * `main`.
 *
 *   npm run fixtures:raw   # untracked, gitignored
 *   npm run scrub:sleeper
 *
 * The raw files were fetched after the 2025 season ended. Each output snapshot
 * replays the season as of one ranking week N, as if fetched the Tuesday after
 * week N: the league is scored through N, only weeks 1..N are fetched, and
 * standings (W-L-T, points for and against) are rebuilt from those weeks.
 * Other roster fields (max points, waiver use, current players and injuries)
 * stay as they were at the season's end.
 *
 * Users, display names, team names, `p_nick_*` player nicknames, user IDs and
 * the league and draft IDs (which lead back to the real league) become
 * deterministic fakes. Bracket and transaction IDs are kept: they don't.
 * Sleeper's players file (`players_nfl.json.gz`, next to the league folders,
 * fetched in October 2026) is public NFL data and is kept as it is; each
 * snapshot holds only the players its league names. The snapshots
 * are written by the real fetcher, so the fixture format is the snapshot
 * format.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fetchSleeperSnapshot, type Transport } from "../src/index.ts";
import { SLEEPER_API, SLEEPER_PLAYERS_URL } from "../src/sleeper/api.ts";

/** Week 1, a mid-season week, the first clinch week, the first playoff week, and the week before each. */
export const FEAR_THE_TURTLE_2025_WEEKS = [1, 7, 8, 9, 10, 14, 15];

/** Tuesday after week 1 of the 2025 NFL season, noon UTC. */
const FIRST_TUESDAY_2025 = Date.UTC(2025, 8, 9, 12);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const FAKE_LEAGUE_ID = "900000000000000001";
const FAKE_DRAFT_ID = "900000000000000002";

const FAKE_MANAGERS = [
  "gridiron_gus",
  "waiver_wendy",
  "benchwarmer_bo",
  "faab_frank",
  "trade_baron",
  "pylon_pete",
  "kicker_kim",
  "redzone_rita",
  "hail_mary_hal",
  "tank_commander",
  "bye_week_bea",
  "snap_count_sam",
];

const FAKE_TEAMS = [
  "Gus Bus",
  "Wendy's Wire",
  "Bench Mob",
  "Frank's FAAB Fund",
  "Baron Von Trade",
  "Pylon Patrol",
  "Kim Possible Kicks",
  "Red Zone Rascals",
  "Hail Mary Hustle",
  "Tank Brigade",
  "Bye Bye Bea",
  "Snap Judgement",
];

const PLAYER_NICK_ADJECTIVES = [
  "Big",
  "Sneaky",
  "Golden",
  "Rusty",
  "Turbo",
  "Lucky",
  "Sleepy",
  "Mighty",
];
const PLAYER_NICK_NOUNS = [
  "Moose",
  "Toaster",
  "Cannon",
  "Biscuit",
  "Hammer",
  "Noodle",
  "Rocket",
  "Waffle",
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

interface Raw {
  league: Obj;
  users: Obj[];
  rosters: Obj[];
  winners: Obj[];
  losers: Obj[];
  matchups: Map<number, Obj[]>;
  transactions: Map<number, Obj[]>;
  /** Sleeper's whole players file. */
  players: Obj;
}

export async function scrubSleeperFixtures(opts: {
  rawDir: string;
  outDir: string;
  weeks?: number[];
}): Promise<Record<string, string>> {
  const raw = scrubIdentities(await readRaw(opts.rawDir));
  const weeks = opts.weeks ?? FEAR_THE_TURTLE_2025_WEEKS;

  await rm(opts.outDir, { recursive: true, force: true });
  await mkdir(opts.outDir, { recursive: true });

  // One cache across the weeks, as one pundit's machine would have.
  const cacheDir = await mkdtemp(join(tmpdir(), "lazy-pundit-scrub-cache-"));
  const ids: Record<string, string> = {};
  for (const week of weeks) {
    const { id } = await fetchSleeperSnapshot({
      transport: servePayloads(asOfWeek(raw, week)),
      clock: { now: () => new Date(FIRST_TUESDAY_2025 + (week - 1) * WEEK_MS) },
      snapshotsDir: opts.outDir,
      cacheDir,
      leagueId: FAKE_LEAGUE_ID,
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
    JSON.parse(await readFile(join(dir, f), "utf8"));
  const league = (await read("league.json")) as Obj;
  const lastWeek = Number((league.settings as Obj).last_scored_leg);
  const matchups = new Map<number, Obj[]>();
  const transactions = new Map<number, Obj[]>();
  for (let w = 1; w <= lastWeek; w++) {
    const nn = String(w).padStart(2, "0");
    matchups.set(w, await read(`matchups/week_${nn}.json`));
    transactions.set(w, await read(`transactions/week_${nn}.json`));
  }
  return {
    league,
    users: await read("league_users.json"),
    rosters: await read("league_rosters.json"),
    winners: await read("league_winners_bracket.json"),
    losers: await read("league_losers_bracket.json"),
    matchups,
    transactions,
    players: JSON.parse(
      gunzipSync(
        await readFile(join(dirname(dir), "players_nfl.json.gz")),
      ).toString("utf8"),
    ),
  };
}

/** Replaces every name and account ID with a deterministic fake. */
function scrubIdentities(raw: Raw): Raw {
  // Number users by the roster they manage, so fakes don't depend on file order.
  const rosterOf = new Map<string, number>();
  for (const r of raw.rosters) {
    for (const managerId of [
      r.owner_id,
      ...((r.co_owners as Json[] | null) ?? []),
    ]) {
      if (typeof managerId === "string")
        rosterOf.set(managerId, Number(r.roster_id));
    }
  }
  const realIds = raw.users
    .map((u) => String(u.user_id))
    .sort(
      (a, b) =>
        (rosterOf.get(a) ?? 99) - (rosterOf.get(b) ?? 99) || a.localeCompare(b),
    );
  const userIds = new Map(realIds.map((id, i) => [id, fakeUserId(i)]));
  const fakeUser = (id: Json): Json => {
    if (typeof id !== "string") return id;
    if (!userIds.has(id)) userIds.set(id, fakeUserId(userIds.size));
    return userIds.get(id) as string;
  };

  const league: Obj = {
    ...raw.league,
    league_id: FAKE_LEAGUE_ID,
    draft_id: FAKE_DRAFT_ID,
    previous_league_id: null,
    avatar: null,
    group_id: null,
    company_id: null,
    last_message_id: null,
    last_message_text_map: null,
    last_message_attachment: null,
    last_message_time: null,
    last_author_avatar: null,
    last_author_display_name: null,
    last_author_id: null,
    last_author_is_bot: null,
    last_pinned_message_id: null,
    last_read_id: null,
  };

  const users = raw.users.map((u): Obj => {
    const i = realIds.indexOf(String(u.user_id));
    const meta = (u.metadata as Obj | null) ?? {};
    return {
      user_id: fakeUser(u.user_id ?? null),
      display_name: FAKE_MANAGERS[i] ?? `manager_${i + 1}`,
      avatar: null,
      is_bot: u.is_bot ?? false,
      is_owner: u.is_owner ?? null,
      league_id: FAKE_LEAGUE_ID,
      metadata:
        typeof meta.team_name === "string"
          ? { team_name: FAKE_TEAMS[i] ?? `Team ${i + 1}` }
          : {},
      settings: null,
    };
  });

  const rosters = raw.rosters.map((r): Obj => {
    const metadata: Obj = {};
    for (const [key, value] of Object.entries(
      (r.metadata as Obj | null) ?? {},
    )) {
      if (key.startsWith("p_nick_")) metadata[key] = fakePlayerNickname(key);
      else if (key.startsWith("allow_")) metadata[key] = value;
      // Everything else (custom text, avatars) is dropped.
    }
    return {
      ...r,
      league_id: FAKE_LEAGUE_ID,
      owner_id: fakeUser(r.owner_id ?? null),
      co_owners: Array.isArray(r.co_owners) ? r.co_owners.map(fakeUser) : null,
      metadata,
    };
  });

  const transactions = new Map(
    [...raw.transactions].map(([w, txs]) => [
      w,
      txs.map((t): Obj => ({ ...t, creator: fakeUser(t.creator ?? null) })),
    ]),
  );

  return { ...raw, league, users, rosters, transactions };
}

/** The league as the fetcher would have seen it the Tuesday after `week`. */
function asOfWeek(raw: Raw, week: number): Map<string, Json> {
  const settings = raw.league.settings as Obj;
  const playoffStart = Number(settings.playoff_week_start);
  const regularSeasonEnd = playoffStart - 1;

  const league: Obj = {
    ...raw.league,
    status: "in_season",
    // The season's champion isn't known until the end.
    metadata: {
      ...(raw.league.metadata as Obj),
      latest_league_winner_roster_id: null,
    },
    settings: {
      ...settings,
      leg: week,
      last_scored_leg: week,
      last_report: Math.min(week, Number(settings.last_report)),
    },
  };

  // Standings count regular-season weeks only, in cents to avoid float drift.
  const standings = new Map<
    number,
    { w: number; l: number; t: number; pf: number; pa: number }
  >();
  for (const r of raw.rosters) {
    standings.set(Number(r.roster_id), { w: 0, l: 0, t: 0, pf: 0, pa: 0 });
  }
  for (let w = 1; w <= Math.min(week, regularSeasonEnd); w++) {
    const games = new Map<number, { roster: number; cents: number }[]>();
    for (const m of raw.matchups.get(w) ?? []) {
      if (m.matchup_id === null) continue;
      const score = m.custom_points ?? m.points;
      const side = {
        roster: Number(m.roster_id),
        cents: Math.round(Number(score) * 100),
      };
      games.set(Number(m.matchup_id), [
        ...(games.get(Number(m.matchup_id)) ?? []),
        side,
      ]);
    }
    for (const [a, b] of games.values()) {
      if (!a || !b) continue;
      const sa = standings.get(a.roster);
      const sb = standings.get(b.roster);
      if (!sa || !sb) continue;
      sa.pf += a.cents;
      sa.pa += b.cents;
      sb.pf += b.cents;
      sb.pa += a.cents;
      if (a.cents > b.cents) {
        sa.w++;
        sb.l++;
      } else if (b.cents > a.cents) {
        sb.w++;
        sa.l++;
      } else {
        sa.t++;
        sb.t++;
      }
    }
  }
  const rosters = raw.rosters.map((r): Obj => {
    const s = standings.get(Number(r.roster_id));
    if (!s) return r;
    return {
      ...r,
      settings: {
        ...(r.settings as Obj),
        wins: s.w,
        losses: s.l,
        ties: s.t,
        fpts: Math.floor(s.pf / 100),
        fpts_decimal: s.pf % 100,
        fpts_against: Math.floor(s.pa / 100),
        fpts_against_decimal: s.pa % 100,
      },
    };
  });

  // Sleeper seeds the brackets once the regular season is scored. Results
  // (and teams fed in by a result) appear only for rounds already played.
  const roundsPlayed = week - playoffStart + 1;
  const bracket = (games: Obj[]): Obj[] =>
    week < regularSeasonEnd
      ? []
      : games.map((g) => bracketAsOf(g, roundsPlayed));

  const base = `${SLEEPER_API}/league/${FAKE_LEAGUE_ID}`;
  const payloads = new Map<string, Json>([
    [base, league],
    [`${base}/users`, raw.users],
    [`${base}/rosters`, rosters],
    [`${base}/winners_bracket`, bracket(raw.winners)],
    [`${base}/losers_bracket`, bracket(raw.losers)],
    [SLEEPER_PLAYERS_URL, raw.players],
  ]);
  for (let w = 1; w <= week; w++) {
    payloads.set(`${base}/matchups/${w}`, raw.matchups.get(w) ?? []);
    payloads.set(`${base}/transactions/${w}`, raw.transactions.get(w) ?? []);
  }
  return payloads;
}

function servePayloads(payloads: Map<string, Json>): Transport {
  return {
    async request(req) {
      const body = payloads.get(req.url);
      if (body === undefined) return { status: 404, body: new Uint8Array() };
      return {
        status: 200,
        body: new TextEncoder().encode(JSON.stringify(body)),
      };
    },
  };
}

/** One bracket game as it stood with `roundsPlayed` rounds played. */
function bracketAsOf(game: Obj, roundsPlayed: number): Obj {
  const round = Number(game.r);
  const out: Obj = { ...game };
  if (round > roundsPlayed) {
    delete out.w;
    delete out.l;
  }
  // A team fed in from the previous round is known once that round is played.
  if (round - 1 > roundsPlayed) {
    if (game.t1_from) delete out.t1;
    if (game.t2_from) delete out.t2;
  }
  return out;
}

function fakeUserId(i: number): string {
  return `8000000000000000${String(i + 1).padStart(2, "0")}`;
}

/** A stable fake for a manager's nickname for an NFL player (`p_nick_<player id>`). */
function fakePlayerNickname(key: string): string {
  const h = createHash("sha256").update(key).digest();
  const adjective =
    PLAYER_NICK_ADJECTIVES[(h[0] ?? 0) % PLAYER_NICK_ADJECTIVES.length];
  const noun = PLAYER_NICK_NOUNS[(h[1] ?? 0) % PLAYER_NICK_NOUNS.length];
  return `${adjective} ${noun}`;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  const ids = await scrubSleeperFixtures({
    rawDir: join(root, "fixtures/raw/sleeper/fear-the-turtle-2025"),
    outDir: join(root, "fixtures/sleeper/fear-the-turtle-2025"),
  });
  console.log("Wrote Fear The Turtle 2025 snapshots:", ids);
}
