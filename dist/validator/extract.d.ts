import type { TeamId } from "../league.ts";
import { type Hedge, type Num } from "./numbers.ts";
import type { Ctx } from "./types.ts";
export declare const BULLET: RegExp;
/** Sentences of the plain text, each with its offset. A bullet never runs into the next line. */
export declare function units(plain: string): {
    s: string;
    start: number;
}[];
export type Shape = {
    type: "result";
    won: boolean;
    opponent: TeamId;
} | ({
    type: "score";
} & ScoreWords) | {
    type: "stat";
    /** Evidence IDs the cue points at; empty when nothing says which stat. */
    keys: string[];
    num?: Num;
    hedge?: Hedge;
    record?: string;
    /** An ordinal claim, so a cue-less one is tried against ordinal stats only. */
    ordinal?: boolean;
    /** A score-shaped record, also tried as a score. */
    score?: ScoreWords;
} | {
    type: "place";
    test: (place: number) => boolean;
    key: string;
} | {
    type: "move";
    by: number | "new";
} | {
    type: "group";
    label?: string;
    tier?: number;
    /** "top tier" or "bottom tier": the first or last group in the ranking. */
    edge?: "top" | "bottom";
} | {
    type: "playoffs";
    want: "clinched_bye" | "clinched" | "eliminated" | null;
};
/** A score as written: its two numbers and where the dash sits. */
export interface ScoreWords {
    a: Num;
    b: Num;
    split: number;
}
export interface Found {
    start: number;
    end: number;
    shape: Shape;
    /** The week the claim reads: the one its clause names, else the ranking week. */
    week: number;
}
export declare const RESULT_VERBS: RegExp;
export declare const LOSS_VERB: RegExp;
export declare const ORDINAL_CUES: [RegExp, (w: number) => string][];
export declare const NUMBER_CUES: [RegExp, (w: number) => string][];
export declare function ordinalKey(ctx: string, week: number): string | null;
/**
 * The number cue closest to a number: the last one before it, else the first
 * after. An average cue gives way to a form cue in the number's clause.
 */
export declare function nearestCue(before: string, after: string, week: number): string | null;
export declare function groupsOf(ctx: Ctx): string[];
/** The group of the team in first place, or in last. */
export declare function edgeGroup(ctx: Ctx, edge: "top" | "bottom"): string | undefined;
/** The numbers a group label carries: "Tier 2" and "Second tier" both carry 2. */
export declare function labelNumber(label: string): number | null;
export declare const MOVE_VERBS = "climbs?|climbed|climbing|rises|rose|rising|jumps?|jumped|jumping|moves? up|moved up|falls?|fell|falling|drops?|dropped|dropping|slides?|slid|sliding|slips?|slipped|tumbles?|tumbled";
export declare const MOVE_DOWN: RegExp;
type PlayoffWant = Extract<Shape, {
    type: "playoffs";
}>["want"];
/** What these words state about playoff status: undefined when they're no playoff phrase. */
export declare function playoffWant(words: string): PlayoffWant | undefined;
export declare function extract(ctx: Ctx, s: string): Found[];
export {};
