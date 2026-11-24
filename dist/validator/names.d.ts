import type { TeamId } from "../league.ts";
import type { Ctx } from "./types.ts";
export declare function normalize(s: string): string;
export declare function escapeRe(s: string): string;
/** Matches a name as whole words, in normalized text. */
export declare function wholeWords(name: string): RegExp;
export interface Span {
    start: number;
    end: number;
}
export declare function overlaps(a: Span, b: Span): boolean;
/** Whether the text names the team by one of its nicknames, as whole words. */
export declare function namesTeam(ctx: Ctx, team: TeamId, text: string): boolean;
/** Where any team's nickname appears in a sentence. */
export declare function nameSpans(ctx: Ctx, s: string): {
    start: number;
    end: number;
}[];
