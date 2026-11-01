import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import type { Clock } from "./clock.ts";
import {
  requestUrl,
  type Transport,
  type TransportRequest,
} from "./transport.ts";

/**
 * A snapshot folder holds content-addressed blobs shared by every snapshot in
 * it, plus one folder per snapshot holding its manifest:
 *
 *   <snapshotsDir>/blobs/<sha256>.json.gz
 *   <snapshotsDir>/<snapshot id>/manifest.json
 */
export const SNAPSHOT_FORMAT = 1;

const manifestRequest = z.object({
  url: z.string(),
  params: z.record(z.string(), z.string()),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const manifestSchema = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  platform: z.enum(["sleeper", "espn"]),
  league_id: z.string(),
  season: z.string(),
  fetched_at: z.iso.datetime(),
  requests: z.array(manifestRequest),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestRequest = z.infer<typeof manifestRequest>;

export type Platform = Manifest["platform"];

export class FetchError extends Error {
  override name = "FetchError";
}

/** One payload fetched and held in memory until the whole snapshot is complete. */
interface Fetched {
  request: ManifestRequest;
  body: Uint8Array;
}

/**
 * Collects a fetch's payloads in memory, then writes them as one snapshot.
 * Nothing touches disk until `write`, so a failed request writes nothing.
 */
export class SnapshotRecorder {
  readonly #fetched: Fetched[] = [];
  readonly #transport: Transport;
  readonly #headers: Record<string, string>;

  constructor(transport: Transport, headers: Record<string, string> = {}) {
    this.#transport = transport;
    this.#headers = headers;
  }

  /** Fetches one payload, failing the whole fetch on any non-2xx status. */
  async get(
    url: string,
    params: Record<string, string> = {},
  ): Promise<Uint8Array> {
    const req: TransportRequest = { url, params, headers: this.#headers };
    let res: Awaited<ReturnType<Transport["request"]>>;
    try {
      res = await this.#transport.request(req);
    } catch (cause) {
      throw new FetchError(`GET ${requestUrl(req)} failed`, { cause });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new FetchError(`GET ${requestUrl(req)} returned ${res.status}`);
    }
    this.#fetched.push({
      request: { url, params, sha256: sha256(res.body) },
      body: res.body,
    });
    return res.body;
  }

  async getJson(
    url: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const body = await this.get(url, params);
    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch (cause) {
      throw new FetchError(`GET ${url} returned invalid JSON`, { cause });
    }
  }

  /**
   * Writes the snapshot: blobs first (each atomically), then the manifest
   * into a temp folder that is renamed into place once complete.
   */
  async write(opts: {
    snapshotsDir: string;
    clock: Clock;
    platform: Platform;
    leagueId: string;
    season: string;
  }): Promise<{ id: string; manifest: Manifest }> {
    const requests = [...this.#fetched]
      .map((f) => f.request)
      .sort((a, b) => compareKeys(requestKey(a), requestKey(b)));
    const manifest: Manifest = {
      format: SNAPSHOT_FORMAT,
      platform: opts.platform,
      league_id: opts.leagueId,
      season: opts.season,
      fetched_at: opts.clock.now().toISOString(),
      requests,
    };
    const id = snapshotId(manifest);

    const blobsDir = join(opts.snapshotsDir, "blobs");
    await mkdir(blobsDir, { recursive: true });
    for (const f of this.#fetched) {
      await writeAtomic(
        join(blobsDir, `${f.request.sha256}.json.gz`),
        gzipSync(f.body),
      );
    }

    const tmp = join(opts.snapshotsDir, `.tmp-${randomUUID()}`);
    await mkdir(tmp);
    try {
      await writeFile(
        join(tmp, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await rename(tmp, join(opts.snapshotsDir, id));
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      // The same ID means the same fetch time and payloads: already written.
      if (!isAlreadyExists(err)) throw err;
    }
    return { id, manifest };
  }
}

/** Reads a snapshot's manifest. */
export async function readManifest(
  snapshotsDir: string,
  id: string,
): Promise<Manifest> {
  const text = await readFile(join(snapshotsDir, id, "manifest.json"), "utf8");
  return manifestSchema.parse(JSON.parse(text));
}

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
export async function readSnapshot(
  snapshotsDir: string,
  id: string,
): Promise<Snapshot> {
  const manifest = await readManifest(snapshotsDir, id);
  const payloads = new Map<string, unknown>();
  for (const r of manifest.requests) {
    const body = await readBlob(snapshotsDir, r.sha256);
    payloads.set(requestKey(r), JSON.parse(new TextDecoder().decode(body)));
  }
  const key = (url: string) => requestKey({ url, params: {} });
  return {
    id,
    manifest,
    has: (url) => payloads.has(key(url)),
    json(url) {
      const k = key(url);
      if (!payloads.has(k)) {
        throw new Error(`Snapshot ${id} has no payload for ${url}`);
      }
      return payloads.get(k);
    },
  };
}

/** Reads one raw payload from the shared blob store. */
export async function readBlob(
  snapshotsDir: string,
  sha: string,
): Promise<Uint8Array> {
  const body = gunzipSync(
    await readFile(join(snapshotsDir, "blobs", `${sha}.json.gz`)),
  );
  if (sha256(body) !== sha) {
    throw new Error(`Snapshot blob ${sha} is corrupt`);
  }
  return new Uint8Array(body);
}

/** The key a request is matched and ordered by: its URL with sorted params. */
export function requestKey(
  req: Pick<TransportRequest, "url" | "params">,
): string {
  const params = Object.entries(req.params ?? {}).sort(([a], [b]) =>
    compareKeys(a, b),
  );
  return JSON.stringify([req.url, params]);
}

/**
 * `<fetched_at UTC>-<short hash>`. The hash covers the requests and their
 * payloads' SHA-256.
 */
function snapshotId(manifest: Manifest): string {
  const stamp = manifest.fetched_at
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const hash = createHash("sha256")
    .update(JSON.stringify(manifest.requests))
    .digest("hex")
    .slice(0, 8);
  return `${stamp}-${hash}`;
}

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function writeAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

function isAlreadyExists(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "EEXIST" || code === "ENOTEMPTY";
}
