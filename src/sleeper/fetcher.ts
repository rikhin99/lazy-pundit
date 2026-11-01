import { z } from "zod";
import type { Clock } from "../clock.ts";
import { FetchError, type Manifest, SnapshotRecorder } from "../snapshot.ts";
import type { Transport } from "../transport.ts";

export const SLEEPER_API = "https://api.sleeper.app/v1";

/** The last week a Sleeper NFL season can have matchups in. */
const LAST_NFL_WEEK = 18;

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
  leagueId: string;
  /** Sent with every request and never recorded. */
  headers?: Record<string, string>;
}

/**
 * Fetches one Sleeper league season through the transport and writes it as a
 * snapshot. Every request must succeed, or nothing is written.
 */
export async function fetchSleeperSnapshot(
  opts: FetchSleeperOptions,
): Promise<{ id: string; manifest: Manifest }> {
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
  await Promise.all(paths.map((path) => recorder.get(`${base}/${path}`)));

  return recorder.write({
    snapshotsDir: opts.snapshotsDir,
    clock: opts.clock,
    platform: "sleeper",
    leagueId: league.league_id,
    season: league.season,
  });
}
