import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import type { Clock } from "./clock.ts";
import {
  NoAnswer,
  PLATFORM_WAIT_MS,
  requestUrl,
  requestWithin,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from "./transport.ts";
import { writeGitignore } from "./workspace-files.ts";

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

/**
 * What the pundit can do about a failed fetch: `refresh` once fetching works
 * again, check the `league_id` in `workspace.md` when the platform doesn't
 * know the league, or `update` when the platform answers in a shape this
 * version can't read. A throw that passes none gets `refresh`.
 */
export type FetchFix = "refresh" | "league_id" | "update";

export class FetchError extends Error {
  override name = "FetchError";
  readonly fix: FetchFix;

  constructor(message: string, opts: { cause?: unknown; fix?: FetchFix } = {}) {
    super(message, { cause: opts.cause });
    this.fix = opts.fix ?? "refresh";
  }
}

/**
 * Sends one platform request, waiting `PLATFORM_WAIT_MS` for its answer. Any
 * thrown error, running out of time included, becomes a `FetchError`.
 */
export async function platformRequest(
  transport: Transport,
  req: TransportRequest,
): Promise<TransportResponse> {
  try {
    return await requestWithin(transport, req, PLATFORM_WAIT_MS);
  } catch (cause) {
    const failed =
      cause instanceof NoAnswer ? `got ${cause.message}` : "failed";
    throw new FetchError(`GET ${requestUrl(req)} ${failed}`, { cause });
  }
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
    const body = await this.getUnrecorded(url, params);
    this.put(url, body, params);
    return body;
  }

  /**
   * Fetches one payload without recording it, with the same failure rules as
   * `get`. For a payload the snapshot keeps only part of (see `put`).
   */
  async getUnrecorded(
    url: string,
    params: Record<string, string> = {},
  ): Promise<Uint8Array> {
    const req: TransportRequest = { url, params, headers: this.#headers };
    const res = await platformRequest(this.#transport, req);
    if (res.status < 200 || res.status >= 300) {
      throw new FetchError(`GET ${requestUrl(req)} returned ${res.status}`);
    }
    return res.body;
  }

  /**
   * Records `body` as the payload for `url`. Replaying the snapshot serves it
   * back as that URL's response, so a trimmed payload must still parse as one.
   */
  put(url: string, body: Uint8Array, params: Record<string, string> = {}) {
    this.#fetched.push({
      request: { url, params, sha256: sha256(body) },
      body,
    });
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
   * What has been fetched so far, readable as a snapshot before it's written,
   * so a platform can normalize it first.
   */
  snapshot(opts: {
    platform: Platform;
    leagueId: string;
    season: string;
  }): Snapshot {
    const payloads = new Map<string, unknown>();
    for (const f of this.#fetched) {
      payloads.set(
        requestKey(f.request),
        JSON.parse(new TextDecoder().decode(f.body)),
      );
    }
    const manifest: Manifest = {
      format: SNAPSHOT_FORMAT,
      platform: opts.platform,
      league_id: opts.leagueId,
      season: opts.season,
      fetched_at: new Date(0).toISOString(),
      requests: this.#fetched.map((f) => f.request),
    };
    return inMemorySnapshot("(unwritten)", manifest, payloads);
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
    /** The hash the snapshot ID ends with: the platform's data hash. */
    idHash: string;
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
    const id = snapshotId(manifest, opts.idHash);

    // The raw payloads name every manager's account: keep them out of git.
    if ((await mkdir(opts.snapshotsDir, { recursive: true })) !== undefined) {
      await writeGitignore(opts.snapshotsDir, "*");
    }
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

/**
 * A snapshot's manifest or blob that is present but can't be read: not JSON,
 * the wrong shape, not gzip, or not matching its hash. A file that's gone is
 * still the read's own ENOENT.
 */
export class SnapshotDamagedError extends Error {
  override name = "SnapshotDamagedError";
}

/** Reads a snapshot's manifest. */
export async function readManifest(
  snapshotsDir: string,
  id: string,
): Promise<Manifest> {
  const text = await readFile(join(snapshotsDir, id, "manifest.json"), "utf8");
  try {
    return manifestSchema.parse(JSON.parse(text));
  } catch (cause) {
    throw new SnapshotDamagedError(`Snapshot ${id}'s manifest is damaged`, {
      cause,
    });
  }
}

/**
 * Every snapshot in the folder whose manifest this build reads, oldest first
 * (IDs start with their fetch time). A missing folder has none.
 */
export async function listSnapshots(
  snapshotsDir: string,
): Promise<{ id: string; manifest: Manifest }[]> {
  const listed: { id: string; manifest: Manifest }[] = [];
  for (const id of (await snapshotFolders(snapshotsDir)).sort(compareKeys)) {
    try {
      listed.push({ id, manifest: await readManifest(snapshotsDir, id) });
    } catch {
      // Another build's format, or not a snapshot: not this build's to read.
    }
  }
  return listed;
}

/**
 * Deletes these snapshots, then every blob no remaining snapshot lists. If a
 * remaining folder's manifest can't be read, its blobs are unknown, so no
 * blob is deleted.
 */
export async function deleteSnapshots(
  snapshotsDir: string,
  ids: string[],
): Promise<void> {
  for (const id of ids) {
    await rm(join(snapshotsDir, id), { recursive: true, force: true });
  }
  const listed = new Set<string>();
  for (const id of await snapshotFolders(snapshotsDir)) {
    let shas: string[];
    try {
      const raw = JSON.parse(
        await readFile(join(snapshotsDir, id, "manifest.json"), "utf8"),
      );
      shas = z
        .object({ requests: z.array(z.object({ sha256: z.string() })) })
        .parse(raw)
        .requests.map((r) => r.sha256);
    } catch {
      return;
    }
    for (const sha of shas) listed.add(sha);
  }
  const blobsDir = join(snapshotsDir, "blobs");
  for (const name of await readdir(blobsDir).catch(() => [])) {
    const sha = name.match(/^([0-9a-f]{64})\.json\.gz$/)?.[1];
    if (sha && !listed.has(sha))
      await rm(join(blobsDir, name), { force: true });
  }
}

/** The folder's snapshot folders: everything but blobs, temp and dot files. */
async function snapshotFolders(snapshotsDir: string): Promise<string[]> {
  const entries = await readdir(snapshotsDir, { withFileTypes: true }).catch(
    (err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    },
  );
  return entries
    .filter(
      (e) => e.isDirectory() && e.name !== "blobs" && !e.name.startsWith("."),
    )
    .map((e) => e.name);
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
  return inMemorySnapshot(id, manifest, payloads);
}

function inMemorySnapshot(
  id: string,
  manifest: Manifest,
  payloads: Map<string, unknown>,
): Snapshot {
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
  const gz = await readFile(join(snapshotsDir, "blobs", `${sha}.json.gz`));
  let body: Buffer;
  try {
    body = gunzipSync(gz);
  } catch (cause) {
    throw new SnapshotDamagedError(`Snapshot blob ${sha} is damaged`, {
      cause,
    });
  }
  if (sha256(body) !== sha) {
    throw new SnapshotDamagedError(`Snapshot blob ${sha} is damaged`);
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

/** What a snapshot ID looks like, for finding the IDs a file names. */
export const SNAPSHOT_ID = /\b\d{8}T\d{6}Z-[0-9a-f]{8}\b/;

/** `<fetched_at UTC>-<the data hash's first 8 hex digits>`. */
function snapshotId(manifest: Manifest, hash: string): string {
  const stamp = manifest.fetched_at
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${hash.slice(0, 8)}`;
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
