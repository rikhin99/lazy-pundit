import type { Clock } from "../clock.ts";
import type { Credentials } from "../config.ts";
import type { League } from "../league.ts";
import { type Manifest, type Snapshot } from "../snapshot.ts";
import { type Transport } from "../transport.ts";
export interface FetchEspnOptions {
    transport: Transport;
    clock: Clock;
    /** The folder snapshots and their shared blobs are written to. */
    snapshotsDir: string;
    leagueId: string;
    /** The season's year: an ESPN league keeps one ID across seasons. */
    season: string;
    /** The ESPN cookie, sent with every request and never recorded. */
    cookie?: NonNullable<Credentials["espnS2"]>;
    /** A full fetch: every week, nothing kept from the last snapshot. */
    full?: boolean;
}
/** A complete fetch held in memory: nothing is on disk until `write`. */
export interface FetchedEspn {
    snapshot: Snapshot;
    league: League;
    /** Writes the fetch as a snapshot. */
    write(): Promise<{
        id: string;
        manifest: Manifest;
    }>;
}
/**
 * Fetches one ESPN league season through the transport and writes it as a
 * snapshot. Every request must succeed, or nothing is written.
 */
export declare function fetchEspnSnapshot(opts: FetchEspnOptions): Promise<{
    id: string;
    manifest: Manifest;
}>;
/**
 * Fetches one ESPN league season through the transport, writing no snapshot
 * unless the caller asks. Every request must succeed. A rejected cookie (401)
 * and a league ESPN doesn't know (404) each stop it with their own fix.
 */
export declare function fetchEspn(opts: FetchEspnOptions): Promise<FetchedEspn>;
/**
 * Checks a cookie, or none, live with one request for an ESPN league's own
 * payload, as `doctor` does: read, rejected (401), a league ESPN doesn't
 * know (404), or why it couldn't be checked.
 */
export declare function checkEspnCookie(transport: Transport, cookie: string | undefined, league: {
    leagueId: string;
    season: string;
}): Promise<"ok" | "rejected" | "no league" | {
    unreachable: string;
}>;
