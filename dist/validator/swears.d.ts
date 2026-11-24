import type { Ctx, Swear } from "./types.ts";
export declare const SWEARS: RegExp;
/**
 * Words that mention money, a prize or a punishment, for a league that plays
 * for bragging rights only. Narrow on purpose: "fine", "bet" and
 * "punishing" are everyday words, so only their stakes forms are listed.
 */
export declare const STAKES_WORDS: RegExp;
export declare function swears(ctx: Ctx, plain: string): Swear[];
/** Each mention of money, a prize or a punishment, outside team names. */
export declare function stakesMentions(ctx: Ctx, plain: string): Swear[];
