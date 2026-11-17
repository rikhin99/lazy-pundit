import { type CheckedDraft, type Problem } from "./check.ts";
import { type Credentials } from "./config.ts";
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
    /**
     * What reading the credentials for an ESPN fetch and the lore has to say,
     * personal data included.
     */
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
/** A fetch, or the last complete snapshot when the fetch failed. */
export interface FetchedOrContinued extends FetchedSleeper {
    /** The failed-fetch item, when this continues from the last complete snapshot. */
    failedFetch?: Problem;
    /**
     * What reading the credentials for the ESPN cookie had to say, whether the
     * fetch succeeded or not; none when given `credentials`.
     */
    warnings: string[];
}
/**
 * `fetchFresh`, except that a failed or partial fetch continues from the last
 * complete snapshot: the season's newest whose data all reads, whose `write`
 * writes nothing and gives it back. With no snapshot to continue from, it
 * stops with the fetch's error, its message ending with the fix for what
 * failed. It reads the ESPN cookie itself unless given the `credentials`.
 */
export declare function fetchOrContinue(ws: Workspace, deps: Deps, opts?: {
    full?: boolean;
    credentials?: Credentials;
}): Promise<FetchedOrContinued>;
/** A rejected stored cookie's fix, which `doctor` gives too. */
export declare const SETUP_ESPN_FIX = "Copy a fresh espn_s2 from your browser, then run: lazy-pundit setup espn";
/** A rejected `LAZY_PUNDIT_ESPN_S2`'s fix, which `doctor` gives too. */
export declare const ESPN_ENV_FIX = "Set LAZY_PUNDIT_ESPN_S2 to a fresh espn_s2 from your browser, or unset it to use the stored cookie.";
