import { z } from "zod";
import { readCacheEntry, writeCacheEntry } from "../cache.ts";
import type { Clock } from "../clock.ts";
import { dataHash } from "../data-hash.ts";
import type { League } from "../league.ts";
import {
  FetchError,
  listSnapshots,
  type Manifest,
  readBlob,
  SnapshotRecorder,
} from "../snapshot.ts";
import type { Transport } from "../transport.ts";
import { SLEEPER_API, SLEEPER_PLAYERS_URL } from "./api.ts";
import { normalizeSleeper } from "./normalizer.ts";

/** The last week a Sleeper NFL season can have matchups in. */
const LAST_NFL_WEEK = 18;

const PLAYERS_CACHE = "sleeper/players_nfl.json";
const PLAYERS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A fetch this long after the season's last snapshot is a full fetch. */
const FULL_FETCH_GAP_MS = 14 * 24 * 60 * 60 * 1000;

/** Only the league fields the fetcher needs to decide what else to fetch. */
const leagueSchema = z.object({
  league_id: z.string(),
  season: z.string(),
  settings: z.object({
    leg: z.number().int().nonnegative().optional(),
    last_scored_leg: z.number().int().nonnegative().optional(),
  }),
});

export interface FetchSleeperOptions {
  transport: Transport;
  clock: Clock;
  /** The folder snapshots and their shared blobs are written to. */
  snapshotsDir: string;
  /** The operator's cache folder, where the players file is kept. */
  cacheDir: string;
  leagueId: string;
  /** Sent with every request and never recorded. */
  headers?: Record<string, string>;
  /** A full fetch: every week, nothing kept from the last snapshot. */
  full?: boolean;
}

/** A complete fetch held in memory: nothing is on disk until `write`. */
export interface FetchedSleeper {
  league: League;
  /** Writes the fetch as a snapshot. */
  write(): Promise<{ id: string; manifest: Manifest }>;
}

/**
 * Fetches one Sleeper league season through the transport and writes it as a
 * snapshot. Every request must succeed, or nothing is written.
 */
export async function fetchSleeperSnapshot(
  opts: FetchSleeperOptions,
): Promise<{ id: string; manifest: Manifest }> {
  return (await fetchSleeper(opts)).write();
}

/**
 * Fetches one Sleeper league season through the transport and normalizes it,
 * writing no snapshot unless the caller asks. Every request must succeed.
 */
export async function fetchSleeper(
  opts: FetchSleeperOptions,
): Promise<FetchedSleeper> {
  const recorder = new SnapshotRecorder(opts.transport, opts.headers);
  const base = `${SLEEPER_API}/league/${encodeURIComponent(opts.leagueId)}`;

  const payload = await recorder.getJson(base);
  const parsed = leagueSchema.safeParse(payload);
  if (!parsed.success) {
    // Sleeper answers `null` for a league ID it doesn't know.
    throw new FetchError(
      `Sleeper league ${opts.leagueId} is not a league payload`,
      { cause: parsed.error, fix: payload === null ? "league_id" : "update" },
    );
  }
  const league = parsed.data;
  const weeks = Math.min(
    LAST_NFL_WEEK,
    Math.max(league.settings.leg ?? 0, league.settings.last_scored_leg ?? 0),
  );

  const paths = ["users", "rosters", "winners_bracket", "losers_bracket"];
  for (let week = 1; week <= weeks; week++) {
    paths.push(`matchups/${week}`, `transactions/${week}`);
  }
  const kept = opts.full
    ? undefined
    : await keptWeeks(opts, base, league, opts.clock.now());
  const bodies = await Promise.all(
    paths.map(async (path) => {
      const url = `${base}/${path}`;
      const body = await kept?.(path);
      if (!body) return recorder.get(url);
      recorder.put(url, body);
      return body;
    }),
  );

  const payloads = bodies.map(parseJson);
  const named = namedPlayers(payloads);
  const inMatchups = namedPlayers(
    payloads.filter((_, i) => paths[i]?.startsWith("matchups/")),
  );
  const players = await playersFile(recorder, opts, inMatchups);
  const trimmed = Object.fromEntries(
    [...named]
      .sort()
      .flatMap((id) => (id in players ? [[id, players[id]]] : [])),
  );
  recorder.put(
    SLEEPER_PLAYERS_URL,
    new TextEncoder().encode(JSON.stringify(trimmed)),
  );

  // The snapshot ID's short hash follows the data, not the raw payloads.
  const normalized = normalizeSleeper(
    recorder.snapshot({
      platform: "sleeper",
      leagueId: league.league_id,
      season: league.season,
    }),
  );
  return {
    league: normalized,
    write: () =>
      recorder.write({
        snapshotsDir: opts.snapshotsDir,
        clock: opts.clock,
        platform: "sleeper",
        leagueId: league.league_id,
        season: league.season,
        idHash: dataHash(normalized, normalized.lastScoredWeek),
      }),
  };
}

/**
 * A routine fetch's reuse: for a week's matchups or transactions path, the
 * payload from the season's last snapshot, or nothing when the path must be
 * fetched. Fetched are the last 2 scored weeks, every week after them, and any
 * week the last snapshot didn't hold as scored. Nothing is reused (a full
 * fetch) without a last snapshot of this league and season, or when it's more
 * than 2 weeks old. A fetch that wrote no snapshot doesn't count as the last,
 * which can only make a fetch full sooner.
 */
async function keptWeeks(
  opts: FetchSleeperOptions,
  base: string,
  league: z.infer<typeof leagueSchema>,
  now: Date,
): Promise<((path: string) => Promise<Uint8Array | undefined>) | undefined> {
  const last = (await listSnapshots(opts.snapshotsDir))
    .filter(
      ({ manifest: m }) =>
        m.platform === "sleeper" &&
        m.league_id === league.league_id &&
        m.season === league.season,
    )
    .at(-1)?.manifest;
  if (
    !last ||
    now.getTime() - new Date(last.fetched_at).getTime() > FULL_FETCH_GAP_MS
  ) {
    return undefined;
  }
  const shas = new Map(last.requests.map((r) => [r.url, r.sha256]));
  const read = async (url: string) => {
    const sha = shas.get(url);
    return sha === undefined
      ? undefined
      : readBlob(opts.snapshotsDir, sha).catch(() => undefined);
  };
  const lastBase = await read(base);
  const lastLeague = leagueSchema.safeParse(lastBase && parseJson(lastBase));
  if (!lastLeague.success) return undefined;
  const scored = league.settings.last_scored_leg ?? 0;
  const lastScored = lastLeague.data.settings.last_scored_leg ?? 0;
  const firstFetched = Math.min(scored - 1, lastScored + 1);
  return async (path) => {
    const week = Number(path.match(/^(?:matchups|transactions)\/(\d+)$/)?.[1]);
    return week < firstFetched ? read(`${base}/${path}`) : undefined;
  };
}

/**
 * The players file from the cache, refetched when it's missing, more than 7
 * days old, or lacks a player a matchup names. (A player only in an old
 * transaction may have left the file for good, so that alone never refetches.)
 */
async function playersFile(
  recorder: SnapshotRecorder,
  opts: FetchSleeperOptions,
  inMatchups: Set<string>,
): Promise<Record<string, unknown>> {
  const now = opts.clock.now();
  const cached = await readCacheEntry(opts.cacheDir, PLAYERS_CACHE);
  if (
    cached &&
    now.getTime() - cached.fetchedAt.getTime() <= PLAYERS_MAX_AGE_MS
  ) {
    const players = playersSchema.safeParse(parseJson(cached.body));
    if (players.success && [...inMatchups].every((id) => id in players.data)) {
      return players.data;
    }
  }
  const body = await recorder.getUnrecorded(SLEEPER_PLAYERS_URL);
  const players = playersSchema.safeParse(parseJson(body));
  if (!players.success) {
    throw new FetchError(
      `GET ${SLEEPER_PLAYERS_URL} is not a players file; try again later`,
      { cause: players.error },
    );
  }
  await writeCacheEntry(opts.cacheDir, PLAYERS_CACHE, { body, fetchedAt: now });
  return players.data;
}

const playersSchema = z.record(z.string(), z.unknown());

const ids = z.array(z.string()).nullish();
const idKeys = z.record(z.string(), z.unknown()).nullish();
/** Wherever a league payload names players: rosters, matchups, transactions. */
const namingSchema = z.array(
  z.object({
    players: ids,
    starters: ids,
    reserve: ids,
    taxi: ids,
    adds: idKeys,
    drops: idKeys,
  }),
);

/** Every player ID the league's payloads name. "0" marks an empty slot. */
function namedPlayers(payloads: unknown[]): Set<string> {
  const named = new Set<string>();
  for (const payload of payloads) {
    const rows = namingSchema.safeParse(payload);
    if (!rows.success) continue;
    for (const row of rows.data) {
      for (const id of [
        ...(row.players ?? []),
        ...(row.starters ?? []),
        ...(row.reserve ?? []),
        ...(row.taxi ?? []),
        ...Object.keys(row.adds ?? {}),
        ...Object.keys(row.drops ?? {}),
      ]) {
        if (id !== "0") named.add(id);
      }
    }
  }
  return named;
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
}
