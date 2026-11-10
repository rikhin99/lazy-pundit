import { type League, type TeamId } from "./league.ts";
import { type MovementBaseline } from "./movement.ts";
import type { RankingFile } from "./ranking-file.ts";
import { type OrderEvidence } from "./validator.ts";
/**
 * The published ranking as plain text for pasting into a group chat. Rendered
 * from the frozen copy, the league data of its snapshot, and its order
 * evidence, whose `move` is shown after each record. No Markdown. A preseason
 * ranking shows no movement.
 */
export declare function renderPlainText(ranking: RankingFile, league: League, order: Record<TeamId, OrderEvidence>, baseline: MovementBaseline | undefined): string;
