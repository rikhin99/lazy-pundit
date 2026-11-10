import { z } from "zod";
import type { Clock } from "./clock.ts";
import { type Transport, type TransportRequest, type TransportResponse } from "./transport.ts";
/**
 * A snapshot folder holds content-addressed blobs shared by every snapshot in
 * it, plus one folder per snapshot holding its manifest:
 *
 *   <snapshotsDir>/blobs/<sha256>.json.gz
 *   <snapshotsDir>/<snapshot id>/manifest.json
 */
export declare const SNAPSHOT_FORMAT = 1;
declare const manifestRequest: z.ZodObject<{
    url: z.ZodString;
    params: z.ZodRecord<z.ZodString, z.ZodString>;
    sha256: z.ZodString;
}, z.core.$strip>;
export declare const manifestSchema: z.ZodObject<{
    format: z.ZodLiteral<1>;
    platform: z.ZodEnum<{
        espn: "espn";
        sleeper: "sleeper";
    }>;
    league_id: z.ZodString;
    season: z.ZodString;
    fetched_at: z.ZodISODateTime;
    requests: z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        params: z.ZodRecord<z.ZodString, z.ZodString>;
        sha256: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestRequest = z.infer<typeof manifestRequest>;
export type Platform = Manifest["platform"];
/**
 * What the pundit can do about a failed fetch: `refresh` once fetching works
 * again, check the `league_id` in `workspace.md` when the platform doesn't
 * know the league, or `update` when the platform answers in a shape this
 * version can't read. A throw that passes none gets `refresh`.
 */
export type FetchFix = "refresh" | "league_id" | "update";
export declare class FetchError extends Error {
    name: string;
    readonly fix: FetchFix;
    constructor(message: string, opts?: {
        cause?: unknown;
        fix?: FetchFix;
    });
}
/**
 * Sends one platform request, waiting `PLATFORM_WAIT_MS` for its answer. Any
 * thrown error, running out of time included, becomes a `FetchError`.
 */
export declare function platformRequest(transport: Transport, req: TransportRequest): Promise<TransportResponse>;
/**
 * Collects a fetch's payloads in memory, then writes them as one snapshot.
 * Nothing touches disk until `write`, so a failed request writes nothing.
 */
export declare class SnapshotRecorder {
    #private;
    constructor(transport: Transport, headers?: Record<string, string>);
    /** Fetches one payload, failing the whole fetch on any non-2xx status. */
    get(url: string, params?: Record<string, string>): Promise<Uint8Array>;
    /**
     * Fetches one payload without recording it, with the same failure rules as
     * `get`. For a payload the snapshot keeps only part of (see `put`).
     */
    getUnrecorded(url: string, params?: Record<string, string>): Promise<Uint8Array>;
    /**
     * Records `body` as the payload for `url`. Replaying the snapshot serves it
     * back as that URL's response, so a trimmed payload must still parse as one.
     */
    put(url: string, body: Uint8Array, params?: Record<string, string>): void;
    getJson(url: string, params?: Record<string, string>): Promise<unknown>;
    /**
     * What has been fetched so far, readable as a snapshot before it's written,
     * so a platform can normalize it first.
     */
    snapshot(opts: {
        platform: Platform;
        leagueId: string;
        season: string;
    }): Snapshot;
    /**
     * Writes the snapshot: blobs first (each atomically), then the manifest
     * into a temp folder that is renamed into place once complete.
     */
    write(opts: {
        snapshotsDir: string;
        clock: Clock;
        platform: Platform;
        leagueId: string;
        season: string;
        /** The hash the snapshot ID ends with: the platform's data hash. */
        idHash: string;
    }): Promise<{
        id: string;
        manifest: Manifest;
    }>;
}
/**
 * A snapshot's manifest or blob that is present but can't be read: not JSON,
 * the wrong shape, not gzip, or not matching its hash. A file that's gone is
 * still the read's own ENOENT.
 */
export declare class SnapshotDamagedError extends Error {
    name: string;
}
/** Reads a snapshot's manifest. */
export declare function readManifest(snapshotsDir: string, id: string): Promise<Manifest>;
/**
 * Every snapshot in the folder whose manifest this build reads, oldest first
 * (IDs start with their fetch time). A missing folder has none.
 */
export declare function listSnapshots(snapshotsDir: string): Promise<{
    id: string;
    manifest: Manifest;
}[]>;
/**
 * Deletes these snapshots, then every blob no remaining snapshot lists. If a
 * remaining folder's manifest can't be read, its blobs are unknown, so no
 * blob is deleted.
 */
export declare function deleteSnapshots(snapshotsDir: string, ids: string[]): Promise<void>;
/** A snapshot read into memory: its manifest and every payload by URL. */
export interface Snapshot {
    id: string;
    manifest: Manifest;
    /** Whether the snapshot holds a payload for this parameterless URL. */
    has(url: string): boolean;
    /** The parsed JSON payload for this parameterless URL. */
    json(url: string): unknown;
}
/** Reads a whole snapshot: its manifest plus every payload it lists. */
export declare function readSnapshot(snapshotsDir: string, id: string): Promise<Snapshot>;
/** Reads one raw payload from the shared blob store. */
export declare function readBlob(snapshotsDir: string, sha: string): Promise<Uint8Array>;
/** The key a request is matched and ordered by: its URL with sorted params. */
export declare function requestKey(req: Pick<TransportRequest, "url" | "params">): string;
/** What a snapshot ID looks like, for finding the IDs a file names. */
export declare const SNAPSHOT_ID: RegExp;
export {};
