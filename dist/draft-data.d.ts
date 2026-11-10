import type { League, TeamId } from "./league.ts";
import { type Stakes } from "./stakes.ts";
import type { EvidencePack } from "./validator/types.ts";
/** What a draft carries for its ranking week, all from the model. */
export interface DraftData {
    week: number;
    /** The in-progress week whose own stats the evidence lets in, if any. */
    inProgressWeek?: number;
    evidence: EvidencePack;
    /** The league stat line, the week intro when there's no LLM. Empty before week 1. */
    intro: string;
    teams: Record<TeamId, {
        statLine: string;
        stats: StatSet;
    }>;
}
/** The stats the editing view shows beside a team. */
export interface StatSet {
    record?: string;
    streak?: string;
    allplay?: string;
    pf?: number;
    form3?: number;
    luck?: number;
    injuries: {
        name: string;
        status: string;
        bodyPart: string | null;
    }[];
}
/**
 * The evidence pack, stat lines and editing-view stats for the ranking week,
 * with the stakes' evidence and this week's triggers when stakes are recorded.
 */
export declare function draftData(league: League, week: number, stakes?: Stakes, inProgressWeek?: number): DraftData;
