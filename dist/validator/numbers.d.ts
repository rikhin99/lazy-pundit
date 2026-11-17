export declare const WORDS: Record<string, number>;
export declare const ORDS: Record<string, number>;
export declare const NUMW: string;
export declare const ORDW: string;
export interface Num {
    n: number;
    /** Decimal places written, for rounding. */
    dp: number;
}
export declare function parseNum(token: string): Num | null;
export declare const NUM_TOKEN: RegExp;
export declare function firstNum(text: string): {
    num: Num;
    index: number;
} | null;
export type Hedge = "over" | "under" | "approx" | null;
export declare const HEDGE: RegExp;
/** A hedge right before a number: "over 950", "nearly two". */
export declare function hedgeBefore(text: string): Hedge;
/** Does a written number agree with a fact, allowing for rounding and hedges? */
export declare function numMatch(claim: Num, hedge: Hedge, fact: number): boolean;
