import type { Ctx, Resolved } from "./types.ts";
/** Whether a stat's value is a player's name, or a list of them. */
export declare function isPlayerName(stat: string): boolean;
/** How an evidence ID names another team's stat: `sleeper:3/` outside its section. */
export declare function teamPrefix(ctx: Ctx, r: Resolved): string;
/** Whether the words name one of the players the fact holds. */
export declare function namesFactPlayer(ctx: Ctx, r: Resolved, words: string): boolean;
/**
 * For a player fact, the reason it's wrong when its words name a different
 * player and none the fact holds. A run of capitalised words reads as a
 * player when it's two or more words, the claim's only words, or holds a
 * word of a player the evidence pack names; a team's name (with or without
 * "The"), a day or a month never does. A lone word no player in the pack
 * holds, such as "Indy's", is left alone, so it's never a false hard problem.
 */
export declare function wrongPlayer(ctx: Ctx, r: Resolved, words: string): string | undefined;
