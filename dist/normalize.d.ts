import type { League } from "./league.ts";
import type { Snapshot } from "./snapshot.ts";
/** The league model of a snapshot, by the platform its manifest names. */
export declare function normalizeSnapshot(snapshot: Snapshot): League;
