import type { Clock } from "../clock.ts";
import type { League } from "../league.ts";
import { type Manifest } from "../snapshot.ts";
import type { Transport } from "../transport.ts";
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
    write(): Promise<{
        id: string;
        manifest: Manifest;
    }>;
}
/**
 * Fetches one Sleeper league season through the transport and writes it as a
 * snapshot. Every request must succeed, or nothing is written.
 */
export declare function fetchSleeperSnapshot(opts: FetchSleeperOptions): Promise<{
    id: string;
    manifest: Manifest;
}>;
/**
 * Fetches one Sleeper league season through the transport and normalizes it,
 * writing no snapshot unless the caller asks. Every request must succeed.
 */
export declare function fetchSleeper(opts: FetchSleeperOptions): Promise<FetchedSleeper>;
