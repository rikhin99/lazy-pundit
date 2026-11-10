import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteSnapshots, listSnapshots, SNAPSHOT_ID } from "./snapshot.js";
import { snapshotsDir } from "./workspace.js";
/** How long a snapshot nothing names is kept. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
/** A draft (`week-08.md`) or frozen copy (`week-08.published.md`). */
const RANKING_FILE = /^week-\d+(\.published)?\.md$/;
/**
 * Retention for the workspace's snapshot folder: keeps every snapshot a draft
 * or frozen copy names (as its snapshot or one of its earlier snapshots) and
 * the latest of each season, deletes the others fetched more
 * than 14 days before `now`, then every blob no snapshot left lists.
 */
export async function applyRetention(ws, now) {
    const dir = snapshotsDir(ws);
    const named = await namedSnapshots(ws);
    const listed = await listSnapshots(dir);
    const latest = new Map();
    for (const { id, manifest: m } of listed) {
        latest.set(JSON.stringify([m.platform, m.league_id, m.season]), id);
    }
    const kept = new Set(latest.values());
    await deleteSnapshots(dir, listed
        .filter(({ id, manifest }) => !named.has(id) &&
        !kept.has(id) &&
        now.getTime() - new Date(manifest.fetched_at).getTime() >
            RETENTION_MS)
        .map(({ id }) => id));
}
/**
 * Every snapshot ID any pundit's draft or frozen copy names, in any season.
 * Read as text, not front matter, so a draft broken by a hand edit still
 * keeps its snapshots. Any error but a missing folder throws, so nothing is
 * pruned on a partial reading.
 */
async function namedSnapshots(ws) {
    const root = join(ws.dir, "pundits");
    const entries = await readdir(root, {
        recursive: true,
        withFileTypes: true,
    }).catch((err) => {
        if (err.code === "ENOENT")
            return [];
        throw err;
    });
    const named = new Set();
    for (const entry of entries) {
        if (!entry.isFile() || !RANKING_FILE.test(entry.name))
            continue;
        const text = await readFile(join(entry.parentPath, entry.name), "utf8");
        for (const [id] of text.matchAll(new RegExp(SNAPSHOT_ID, "g"))) {
            named.add(id);
        }
    }
    return named;
}
//# sourceMappingURL=retention.js.map