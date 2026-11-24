import type { League } from "./league.ts";

/** How many weeks before a Sleeper deadline's own week the reminder starts. */
const WEEKS_BEFORE = 2;

/** An ESPN deadline less than this far after the data as of is reminded of. */
const ESPN_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * The trade deadline in the weeks a published ranking reminds the league of
 * it, both as the evidence pack's `platform.trade_deadline` holds it and as
 * the deadline reminder says it, or null in any other week and in a league
 * with no deadline. On Sleeper it's the deadline's week (`11`, "Trade
 * deadline: week 11"), from two weeks before it through that week. On ESPN
 * it's the deadline's day in the machine's time zone (`Nov 26`, so a claim
 * may leave out the weekday the reminder gives: "Trade deadline: Wed Nov
 * 26"), while the deadline is after the snapshot's data as of and less than
 * 21 days after it.
 */
function remindedDeadline(
  league: League,
  week: number,
): { evidence: number | string; reminder: string } | null {
  const deadline = league.settings.tradeDeadline;
  if (!deadline) return null;
  if ("week" in deadline) {
    const reminded =
      week >= deadline.week - WEEKS_BEFORE && week <= deadline.week;
    if (!reminded) return null;
    return {
      evidence: deadline.week,
      reminder: `Trade deadline: week ${deadline.week}`,
    };
  }
  const ahead = deadline.at - Date.parse(league.dataAsOf);
  if (ahead <= 0 || ahead >= ESPN_WINDOW_MS) return null;
  const date = new Date(deadline.at);
  const day = `${date.toLocaleDateString("en-US", { month: "short" })} ${date.getDate()}`;
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  return { evidence: day, reminder: `Trade deadline: ${weekday} ${day}` };
}

/**
 * The evidence pack's `platform.trade_deadline` for a ranking of `week`:
 * Sleeper's deadline week or ESPN's day (`Nov 26`), or null outside the
 * reminder weeks.
 */
export function tradeDeadline(
  league: League,
  week: number,
): number | string | null {
  return remindedDeadline(league, week)?.evidence ?? null;
}

/**
 * The deadline reminder a published ranking of `week` carries ("Trade
 * deadline: week 11", "Trade deadline: Wed Nov 26"), or null outside the
 * reminder weeks.
 */
export function deadlineReminder(league: League, week: number): string | null {
  return remindedDeadline(league, week)?.reminder ?? null;
}
