import type { Platform } from "./snapshot.ts";

/**
 * The platform-blind league model. Each platform's normalizer produces one
 * from a snapshot, and everything past the normalizer reads only this.
 */
export interface League {
  platform: Platform;
  leagueId: string;
  season: string;
  name: string;
  /** The most recent scored week, or 0 before any week is scored. */
  lastScoredWeek: number;
  teams: Team[];
  /** Every week in the snapshot, in order, scored or in progress. */
  weeks: Week[];
}

/** `<platform>:<team id>`, scoped to one season. */
export type TeamId = `${Platform}:${string}`;

export interface Team {
  id: TeamId;
  name: string;
  /** Standings as the platform reports them. */
  standing: Standing;
}

export interface Standing {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface Week {
  week: number;
  scored: boolean;
  matchups: Matchup[];
  /** Teams with no matchup this week. They get no result. */
  byes: TeamId[];
}

export interface Matchup {
  sides: [MatchupSide, MatchupSide];
}

export interface MatchupSide {
  team: TeamId;
  /** The matchup score: the points the team is credited with. */
  score: number;
  /** Set only once the week is scored. */
  result?: Result;
}

export type Result = "W" | "L" | "T";

/** "7-1", or "6-1-1" with ties. */
export function formatRecord(s: Standing): string {
  return s.ties > 0
    ? `${s.wins}-${s.losses}-${s.ties}`
    : `${s.wins}-${s.losses}`;
}
