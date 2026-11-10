import type { Transport } from "./transport.ts";
/**
 * Replays one snapshot: a request recorded in its manifest gets the recorded
 * payload back, and any other request gets a 404.
 */
export declare function fileTransport(snapshotsDir: string, snapshotId: string): Transport;
