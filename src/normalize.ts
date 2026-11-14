import { normalizeEspn } from "./espn/normalizer.ts";
import type { League } from "./league.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import type { Snapshot } from "./snapshot.ts";

/** The league model of a snapshot, by the platform its manifest names. */
export function normalizeSnapshot(snapshot: Snapshot): League {
  return snapshot.manifest.platform === "espn"
    ? normalizeEspn(snapshot)
    : normalizeSleeper(snapshot);
}
