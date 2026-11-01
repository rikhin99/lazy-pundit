import { readBlob, readManifest, requestKey } from "./snapshot.ts";
import type { Transport } from "./transport.ts";

/**
 * Replays one snapshot: a request recorded in its manifest gets the recorded
 * payload back, and any other request gets a 404.
 */
export function fileTransport(
  snapshotsDir: string,
  snapshotId: string,
): Transport {
  let index: Promise<Map<string, string>> | undefined;
  const load = async () => {
    const manifest = await readManifest(snapshotsDir, snapshotId);
    return new Map(manifest.requests.map((r) => [requestKey(r), r.sha256]));
  };
  return {
    async request(req) {
      index ??= load();
      const sha = (await index).get(requestKey(req));
      if (sha === undefined) return { status: 404, body: new Uint8Array() };
      return { status: 200, body: await readBlob(snapshotsDir, sha) };
    },
  };
}
