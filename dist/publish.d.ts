import { type Problem } from "./check.ts";
import type { Deps } from "./deps.ts";
import type { PersonaRecord } from "./persona.ts";
export interface PublishOptions {
    /** Publish even with hard problems, without asking (`--yes`). */
    yes?: boolean;
    /**
     * Asked once when the draft has hard problems: true is Publish anyway,
     * false is Back to editing. With no one to ask, it's Back to editing.
     */
    confirm?: (hard: Problem[]) => Promise<boolean>;
    /**
     * Asked when the draft's persona relaxes the family league and differs from
     * the persona of the last ranking published (or none was): true publishes.
     * With no one to ask, it's No. `yes` skips it too.
     */
    confirmRelaxed?: (persona: PersonaRecord) => Promise<boolean>;
    /**
     * Told the data-changed warning or the failed fetch's note before anything
     * is asked or written. The result carries them too.
     */
    onWarnings?: (warnings: string[]) => void;
}
export type PublishResult = {
    published: true;
    week: number;
    /** The frozen copy. */
    publishedPath: string;
    /** The plain text file. */
    textPath: string;
    /** The plain text, as written and copied. */
    text: string;
    /** Whether the text reached a clipboard. */
    copied: boolean;
    /** The problems published with, hard first. */
    problems: Problem[];
    /** The data-changed warning, or a note that the fetch failed. */
    warnings: string[];
} | {
    /** Nothing was written. */
    published: false;
    /** Hard problems, or a relaxed persona the pundit didn't confirm. */
    stoppedBy: "hard" | "relaxed";
    week: number;
    problems: Problem[];
    warnings: string[];
};
/**
 * Checks the latest draft and diffs fresh data against its snapshot, warning
 * without re-snapshotting. Then it freezes the draft as `week-NN.published.md`,
 * renders the plain text from the frozen copy into `week-NN.txt`, and copies it
 * to the clipboard. Hard problems are put to `confirm` first; soft ones are only
 * returned.
 */
export declare function publish(workspaceDir: string, deps: Deps, opts?: PublishOptions): Promise<PublishResult>;
