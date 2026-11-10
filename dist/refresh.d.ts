import { type CheckedDraft, type Problem } from "./check.ts";
import { type DataChange } from "./data-diff.ts";
import type { Deps } from "./deps.ts";
import type { League } from "./league.ts";
import { type FetchedSleeper } from "./sleeper/fetcher.ts";
import { type Workspace } from "./workspace.ts";
export interface RefreshResult {
    week: number;
    /** The draft refreshed. */
    path: string;
    /** The data changes found. */
    changes: DataChange[];
    /** Whether the pundit settings asked for another method or weights than the draft recorded. */
    methodChanged: boolean;
    /** The draft's data as of before this refresh. */
    dataAsOf: string;
    /** The snapshot the draft stands on now. */
    snapshot: string;
    /** The claims this refresh made stale. */
    newlyStale: Problem[];
    /** The whole problems list, hard first, moved teams against the new starting order. */
    problems: Problem[];
    /** What reading the lore has to say, personal data included. */
    warnings: string[];
    /** The newest scored week, when it's later than the draft's: time for its own draft. */
    scoredWeek?: number;
    /** The fetch failed, so this refresh continued from the last complete snapshot. */
    fromLastComplete: boolean;
}
/**
 * Refetches and, if the data changed, moves the latest draft onto a new
 * snapshot with a recomputed starting order. A changed method in the pundit
 * settings recomputes the order too, with no new snapshot if the data stands.
 * It never touches the pundit's order, blurbs, week or persona, and doesn't
 * auto-tag. With neither change it only updates `checked_at`. A failed fetch
 * continues from the last complete snapshot, leaving `checked_at`, with the
 * failed-fetch item; with no snapshot to continue from it throws, as a bad
 * settings file does, with the fix for what failed, and changes nothing.
 */
export declare function refresh(workspaceDir: string, deps: Deps, opts?: {
    full?: boolean;
}): Promise<RefreshResult>;
/**
 * The data-changed warning for a checked draft against freshly fetched data,
 * or none when the data through the draft's week is the same. A drastic
 * correction that changes a trigger winner adds its own line.
 */
export declare function dataChangedWarning(checked: CheckedDraft, fresh: League): string | undefined;
/**
 * What a command that doesn't otherwise need fresh data has to say about it. A
 * failed fetch is only noted: it must never stop the command.
 */
export declare function freshDataWarnings(workspaceDir: string, checked: CheckedDraft, deps: Deps): Promise<string[]>;
/**
 * The workspace's latest season, fetched into memory: no snapshot yet. A
 * routine fetch unless `full`. Writing the snapshot applies retention.
 */
export declare function fetchFresh(ws: Workspace, deps: Deps, opts?: {
    full?: boolean;
}): Promise<FetchedSleeper>;
/** A fetch, or the last complete snapshot when the fetch failed. */
export interface FetchedOrContinued extends FetchedSleeper {
    /** The failed-fetch item, when this continues from the last complete snapshot. */
    failedFetch?: Problem;
}
/**
 * `fetchFresh`, except that a failed or partial fetch continues from the last
 * complete snapshot: the season's newest, whose `write` writes nothing and
 * gives it back. With no snapshot to continue from, it stops with the fetch's
 * error, its message ending with the fix for what failed.
 */
export declare function fetchOrContinue(ws: Workspace, deps: Deps, opts?: {
    full?: boolean;
}): Promise<FetchedOrContinued>;
