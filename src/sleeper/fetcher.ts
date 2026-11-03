import { z } from "zod";
import { readCacheEntry, writeCacheEntry } from "../cache.ts";
import type { Clock } from "../clock.ts";
import { dataHash } from "../data-hash.ts";
import type { League } from "../league.ts";
import { FetchError, type Manifest, SnapshotRecorder } from "../snapshot.ts";
import type { Transport } from "../transport.ts";
import { SLEEPER_API, SLEEPER_PLAYERS_URL } from "./api.ts";
import { normalizeSleeper } from "./normalizer.ts";

/** The last week a Sleeper NFL season can have matchups in. */
const LAST_NFL_WEEK = 18;

const PLAYERS_CACHE = "sleeper/players_nfl.json";
const PLAYERS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

  const parsed = leagueSchema.safeParse(await recorder.getJson(base));
  if (!parsed.success) {
    throw new FetchError(
      `Sleeper league ${opts.leagueId} is not a league payload`,
      {
        cause: parsed.error,
      },
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
  const bodies = await Promise.all(
    paths.map((path) => recorder.get(`${base}/${path}`)),
  );

  const payloads = bodies.map(parseJson);
  const named = namedPlayers(payloads);
  const inMatchups = namedPlayers(
    payloads.filter((_, i) => paths[i]?.startsWith("matchups/")),
  );
  const players = await playersFile(recorder, opts, inMatchups);
  const kept = Object.fromEntries(
    [...named]
      .sort()
      .flatMap((id) => (id in players ? [[id, players[id]]] : [])),
  );
  recorder.put(
    SLEEPER_PLAYERS_URL,
    new TextEncoder().encode(JSON.stringify(kept)),
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
