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
/** Where one clause ends and the next begins. */
export declare const CLAUSE_BREAK: RegExp;
/** A result's verb, finite or "-ing" ("beat", "after beating"), before the opponent. */
export declare const RESULT_VERBS: RegExp;
/** The `RESULT_VERBS` forms that mean a loss, finite or "-ing". */
export declare const LOSS_VERB: RegExp;
export declare const ORDINAL_CUES: [RegExp, (w: number) => string][];
export declare const NUMBER_CUES: [RegExp, (w: number) => string][];
export declare function ordinalKey(ctx: string, week: number): string | null;
/** A number cue: the stat it reads, and where its words start in the sentence. */
export interface Cue {
    key: string;
    at: number;
}
/**
 * The number cue for the number at `start`..`end` of the lowercased `s`: the
 * last one before it, else the first after. The cue before gives way to the
 * first one after when another number sits between them, or when an earlier
 * number took it (`taken` holds where each taken cue starts), so in "allowed
 * 924.43 while scoring 891.03 in total" 891.03 reads points for. An average
 * cue gives way to a form cue in the number's clause.
 */
export declare function nearestCue(s: string, start: number, end: number, week: number, taken: ReadonlySet<number>): Cue | null;
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
/**
 * Each trigger kind's wording as a noun a count can sit before ("2 high
 * scores"). A rule whose trigger has none here is read by its name alone.
 */
export declare const TRIGGER_WORDS: Record<string, string>;
export declare function extract(ctx: Ctx, s: string): Found[];
export {};
