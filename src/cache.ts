import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * The person-level cache (the XDG cache dir): large platform files that are
 * shared by every workspace and safe to lose. A missing or unreadable entry is
 * simply a miss.
 *
 *   <cacheDir>/<name>               the payload as fetched
 *   <cacheDir>/<name>.meta.json     when it was fetched
 */
const metaSchema = z.object({ fetched_at: z.iso.datetime() });

export interface CacheEntry {
  body: Uint8Array;
  fetchedAt: Date;
}

/** Reads a cache entry, or undefined if it's missing or unreadable. */
export async function readCacheEntry(
  cacheDir: string,
  name: string,
): Promise<CacheEntry | undefined> {
  const path = join(cacheDir, name);
  try {
    const meta = metaSchema.safeParse(
      JSON.parse(await readFile(`${path}.meta.json`, "utf8")),
    );
    if (!meta.success) return undefined;
    const body = new Uint8Array(await readFile(path));
    return { body, fetchedAt: new Date(meta.data.fetched_at) };
  } catch {
    return undefined;
  }
}

/** Writes a cache entry: the payload first, then its fetch time, each atomically. */
export async function writeCacheEntry(
  cacheDir: string,
  name: string,
  entry: CacheEntry,
): Promise<void> {
  const path = join(cacheDir, name);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, entry.body);
  await writeAtomic(
    `${path}.meta.json`,
    `${JSON.stringify({ fetched_at: entry.fetchedAt.toISOString() })}\n`,
  );
}

async function writeAtomic(path: string, data: Uint8Array | string) {
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}
