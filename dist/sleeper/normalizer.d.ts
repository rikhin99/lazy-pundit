import type { League } from "../league.ts";
import type { Snapshot } from "../snapshot.ts";
/** Turns one Sleeper snapshot into the league model. Pure. */
export declare function normalizeSleeper(snapshot: Snapshot): League;
