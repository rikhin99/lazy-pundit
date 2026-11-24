import { type League, type TeamId } from "./league.ts";
import { type MovementBaseline } from "./movement.ts";
import type { RankingFile } from "./ranking-file.ts";
import { type OrderEvidence } from "./validator.ts";
/** Each platform's name as the pundit reads it. */
export declare const PLATFORM_NAMES: Record<League["platform"], string>;
/**
 * The published ranking as plain text for pasting into a group chat. Rendered
 * from the frozen copy, the league data of its snapshot, and its order
 * evidence, whose `move` is shown after each record. No Markdown. A preseason
 * ranking shows no movement.
 */
export declare function renderPlainText(ranking: RankingFile, league: League, order: Record<TeamId, OrderEvidence>, baseline: MovementBaseline | undefined): string;
/**
 * One block of the plain text, with what it's about: a team's entry by its
 * team ID, the week intro as `intro`, or null for the header, a group's label
 * and the credit.
 */
export interface PlainTextBlock {
    entry: TeamId | "intro" | null;
    text: string;
}
/**
 * The plain text's blocks in order. Joined by a blank line they're the plain
 * text, so the preview page can mark each entry where it starts.
 */
export declare function plainTextBlocks(ranking: RankingFile, league: League, order: Record<TeamId, OrderEvidence>, baseline: MovementBaseline | undefined): PlainTextBlock[];
/** A published ranking's week: "after Week 8", or "Preseason" for week 0. */
export declare function weekTitle(week: number): string;
/**
 * "Movement since week M" (or "since Preseason") when the movement baseline
 * isn't the week before the ranking week; otherwise, and at week 0, none.
 */
export declare function movementSince(week: number, baseline: MovementBaseline | undefined): string | undefined;
/** The published ranking's credit line. */
export declare function credit(league: League): string;
