import { createHash } from "node:crypto";
import type { League } from "./league.ts";
import { standingsThrough } from "./standings.ts";

/**
 * SHA-256 of the league data a ranking for `throughWeek` stands on, as
 * canonical JSON: the scored weeks up to it (matchups, scores, results,
 * lineups, byes), transactions up to it, the standings through it (with
 * rank, seed and tiebreaks), and the playoff spot count and regular-season
 * length. Names, managers, current rosters, injuries,
 * player details and any in-progress week are left out, so only a change that
 * counts as "data changed" changes it.
 *
 * Snapshot IDs end with this hash, so changing what it covers changes every
 * committed fixture ID: rebuild them (see fixtures/sleeper/README.md).
 */
export function dataHash(league: League, throughWeek: number): string {
  const covered = {
    playoffTeams: league.settings.playoffTeams,
    regularSeasonWeeks: league.settings.regularSeasonWeeks,
    standings: standingsThrough(league, throughWeek),
    weeks: league.weeks
      .filter((w) => w.scored && w.week <= throughWeek)
      .map((w) => ({
        week: w.week,
        byes: w.byes,
        matchups: w.matchups.map((m) => ({
          ...m,
          sides: m.sides.map((s) => ({
            ...s,
            lineup: s.lineup.map(({ player, slot, points }) => ({
              player,
              slot,
              points,
            })),
          })),
        })),
      })),
    transactions: league.transactions.filter((t) => t.week <= throughWeek),
  };
  return createHash("sha256").update(canonicalJson(covered)).digest("hex");
}

/** JSON with every object's keys sorted, so equal data gives equal text. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}
