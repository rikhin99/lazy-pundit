import type { League } from "./league.ts";
import { type Stakes } from "./stakes.ts";
import { type Workspace } from "./workspace.ts";
/** A draft's drastic corrections, from its own data against the published ranking's. */
export interface Corrections {
    /**
     * One `w<N>.correction` league item per corrected week: each flipped
     * matchup and changed trigger winner in it, joined by "; ".
     */
    items: Record<string, string>;
    /** The can't-compare item's reason, when the published ranking's snapshot can't be read. */
    cantCompare?: string;
}
/**
 * The drastic corrections in `league`, a draft's data for `week`: its data
 * against the snapshot behind the season's latest published ranking before
 * `week`, through that ranking's week. Nothing is stored, so they stop once a
 * ranking on the corrected data is published. A snapshot that's gone, damaged
 * or no longer normalizes gives the can't-compare item instead.
 */
export declare function corrections(ws: Workspace, week: number, league: League, stakes: Stakes): Promise<Corrections>;
/**
 * The week intro's line for each correction item, oldest week first, each
 * tagged to its item: `[Correction from week 7: …]{ev=w7.correction}`.
 */
export declare function correctionLines(items: Record<string, string>): string[];
/**
 * The reason for each correction item a draft's `text` cites nowhere, such as
 * one a `refresh` found after the draft was written: the league won't hear of
 * it unless the pundit adds its line.
 */
export declare function uncarriedCorrections(items: Record<string, string>, text: string): string[];
