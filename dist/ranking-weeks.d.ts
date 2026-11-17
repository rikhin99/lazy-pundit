import { type LlmProseFile } from "./llm-prose-file.ts";
import { type RankingFile } from "./ranking-file.ts";
import { type Workspace } from "./workspace.ts";
/** One ranking week of the pundit's, as the workspace keeps it. */
export interface RankingWeek {
    season: number;
    week: number;
    /** `week-NN.md`, the draft, if the pundit kept it. */
    draft?: RankingFile;
    /** `week-NN.published.md`, the frozen copy, once the week is published. */
    frozenCopy?: RankingFile;
    /** `week-NN.llm.md`, the LLM prose file, when the LLM wrote any of the draft. */
    llmProse?: LlmProseFile;
    /**
     * The week's files that couldn't be read, such as a draft mid-edit, each
     * with the reason, as `<season>/<file>`. The others are read regardless.
     */
    unreadable: {
        kind: RankingWeekFile;
        file: string;
        reason: string;
    }[];
}
/** Which of a ranking week's files: its draft, frozen copy or LLM prose file. */
export type RankingWeekFile = "draft" | "frozenCopy" | "llmProse";
/**
 * Every ranking week the pundit has a draft, frozen copy or LLM prose file
 * for, in every season of the workspace, oldest first. It reads files only.
 */
export declare function readRankingWeeks(ws: Workspace): Promise<RankingWeek[]>;
