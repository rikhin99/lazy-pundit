import type { TeamId } from "../league.ts";
import { type Found, type ScoreWords } from "./extract.ts";
import type { ClaimStatus, Ctx, Resolved } from "./types.ts";
export interface Hit {
    team: TeamId | null;
    stat: string;
    /** Sub-span within the claim, for a score's two halves. */
    part?: {
        start: number;
        end: number;
    };
}
export interface Verdict {
    status: ClaimStatus;
    reason: string;
    hits: Hit[];
}
export declare function teamName(ctx: Ctx, team: TeamId): string;
export declare function show(ctx: Ctx, r: Resolved): string;
export declare const LOOSE_PLAYOFF_PHRASE = "a loose playoff phrase; only clinched, a bye or eliminated is checked";
/** Judges an untagged claim against its claim's team's stats only. */
export declare function judge(ctx: Ctx, team: TeamId | null, text: string, f: Found): Verdict;
export declare function judgeScore(ctx: Ctx, 
/** The claim's team; its matchup's score is read from either side. */
team: TeamId | null, shape: ScoreWords, length: number, 
/** The week the claim reads (`Found.week`). */
week: number): Verdict;
export declare function idFor(ctx: Ctx, hit: Hit): string;
export declare function verifiedReason(ctx: Ctx, hits: Hit[]): string;
