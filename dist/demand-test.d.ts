import type { BlurbProblems } from "./ranking-file.ts";
import { type RankingWeek } from "./ranking-weeks.ts";
/** One published ranking week in the demand-test summary. */
export interface DemandTestWeek {
    season: number;
    week: number;
    /** From the draft's start to its first publish; unknown for a frozen copy that predates the record. */
    minutesToPublish?: number;
    /** Teams placed away from their starting place, against the starting order at publish. */
    movedTeams: number;
    /** The places those teams were moved, in all. */
    placesMoved: number;
    /** Whether the LLM wrote any section of the week's draft. */
    llmUsed: boolean;
    /** The LLM text kept, from 0 to 1, when the LLM was used. */
    llmTextKept?: number;
    /** The blurb problems the frozen copy was published with; unknown for one that predates the record. */
    blurbProblems?: BlurbProblems;
}
export interface DemandTestSummary {
    weeks: DemandTestWeek[];
    /** Frozen copies and LLM prose files that couldn't be read, each left out of `weeks`' numbers. */
    unreadable: RankingWeek["unreadable"];
    /** The summary as the pundit pastes it: a line per week, the medians, then what couldn't be read. */
    text: string;
}
/**
 * The demand-test summary of the workspace at `workspaceDir`: each published
 * ranking week, read from its frozen copy and LLM prose file alone, so nothing
 * is fetched or sent. A draft is never read for it, so one mid-edit doesn't
 * stop it.
 */
export declare function stats(workspaceDir: string): Promise<DemandTestSummary>;
