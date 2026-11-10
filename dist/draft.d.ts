import { type Problem } from "./check.ts";
import type { Deps } from "./deps.ts";
export interface DraftResult {
    /** The ranking file written. */
    path: string;
    /** The ranking week: the last scored week when the draft began. */
    week: number;
    /** The snapshot the draft was built from. */
    snapshot: string;
    /** The new draft's problems list, hard first. */
    problems: Problem[];
    /** Anything the operator should fix, such as a credentials file others can read. */
    warnings: string[];
    /** Why the LLM didn't run or stopped partway, and what the draft has instead. */
    fallback?: string;
}
export interface DraftOptions {
    /**
     * Told each warning as it arises, so that one about what the LLM is to be
     * sent is seen before the call.
     */
    onWarnings?: (warnings: string[]) => void;
    /**
     * `--include-in-progress`: let the in-progress week's stats in as evidence,
     * every claim citing them provisional.
     */
    includeInProgress?: boolean;
}
export declare class DraftExistsError extends Error {
    name: string;
}
/**
 * Fetches the workspace's latest season and writes a new draft for its
 * ranking week, starting in the order the pundit's settings give, and checks it.
 */
export declare function draft(workspaceDir: string, deps: Deps, opts?: DraftOptions): Promise<DraftResult>;
