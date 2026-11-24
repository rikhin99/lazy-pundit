import type { League } from "./league.ts";
/**
 * The evidence pack's `platform.trade_deadline` for a ranking of `week`:
 * Sleeper's deadline week or ESPN's day (`Nov 26`), or null outside the
 * reminder weeks.
 */
export declare function tradeDeadline(league: League, week: number): number | string | null;
/**
 * The deadline reminder a published ranking of `week` carries ("Trade
 * deadline: week 11", "Trade deadline: Wed Nov 26"), or null outside the
 * reminder weeks.
 */
export declare function deadlineReminder(league: League, week: number): string | null;
