import type { League } from "./league.ts";
import type { Stakes } from "./stakes.ts";
import type { EvidenceValue } from "./validator.ts";
/** One award: its label and what it says, with no tags. */
export interface Award {
    label: string;
    says: string;
}
/**
 * The ranking week's awards, picked from the evidence pack's league items:
 * top and low score, biggest margin, closest matchup, upset, robbed, each
 * house rule's trigger winners, each rivalry week pair, and the teams that
 * clinched this week. An award with no candidate is left out.
 */
export declare function awards(items: Record<string, EvidenceValue>, league: League, stakes: Stakes): Award[];
