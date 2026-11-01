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
  settings: LeagueSettings;
  /** The most recent scored week, or 0 before any week is scored. */
  lastScoredWeek: number;
  teams: Team[];
  /** Every week in the snapshot, in order, scored or in progress. */
  weeks: Week[];
  /** Completed transactions, oldest first. Failed waiver claims are left out. */
  transactions: Transaction[];
  /** Every NFL player the league names, by the platform's player ID. */
  players: Record<string, NflPlayer>;
}

/** `<platform>:<team id>`, scoped to one season. */
export type TeamId = `${Platform}:${string}`;

export interface LeagueSettings {
  /** How many teams make the winners bracket. */
  playoffTeams: number;
  playoffStartWeek: number;
  /** The last regular-season week: the week before the playoffs start. */
  regularSeasonWeeks: number;
  /** The FAAB budget per team, or null when the league doesn't use FAAB. */
  faabBudget: number | null;
  /** Whether non-playoff teams play a losers bracket. */
  losersBracket: boolean;
  /** Median scoring: each week also scores a result against the league median. */
  median: boolean;
  /** How many divisions, or 0 with none. */
  divisions: number;
  /** Keeper or dynasty rules, or null for a redraft league. */
  keepers: "keeper" | "dynasty" | null;
  /** The starting lineup's slots, in order. */
  lineupSlots: LineupSlot[];
}

/** One starting slot and the positions that may fill it. */
export interface LineupSlot {
  /** The platform's slot name, such as `QB` or `FLEX`. */
  slot: string;
  positions: string[];
}

export interface Team {
  id: TeamId;
  /** The team's name, or its first manager's display name if it has none. */
  name: string;
  /** Everyone managing the team. Empty when the team has no manager. */
  managers: Manager[];
  /** The team's division (1, 2, …), when the league has divisions. */
  division?: number;
  /** Standings as the platform reports them. */
  standing: Standing;
  /** The team's players now, at the time of the snapshot. */
  roster: RosterSpot[];
}

export interface Manager {
  /** The platform's account ID. */
  accountId: string;
  displayName: string;
}

export interface Standing {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface RosterSpot {
  player: string;
  status: "starter" | "bench" | "IR" | "taxi";
}

/** An NFL player as the platform describes them now. */
export interface NflPlayer {
  id: string;
  name: string;
  /** The primary position, such as `WR` or `DEF`. */
  position: string;
  /** Every position the player is eligible to play in a lineup. */
  positions: string[];
  /** The NFL team's abbreviation, or null for a free agent. */
  nflTeam: string | null;
  /** Such as `Questionable`, `Out` or `IR`; null when healthy. */
  injuryStatus: string | null;
  injuryBodyPart: string | null;
}

export interface Week {
  week: number;
  scored: boolean;
  matchups: Matchup[];
  /** Teams with no matchup this week. They get no result. */
  byes: TeamId[];
}

export type MatchupKind = "regular" | "winners" | "consolation" | "losers";

export interface Matchup {
  /**
   * A regular-season matchup, or a playoff matchup in the winners bracket,
   * its consolation matchups (for 3rd, 5th, … place) or the losers bracket.
   */
  kind: MatchupKind;
  /** The playoff round, from 1. Absent for regular-season matchups. */
  round?: number;
  sides: [MatchupSide, MatchupSide];
}

export interface MatchupSide {
  team: TeamId;
  /** The matchup score: the points the team is credited with. */
  score: number;
  /**
   * Set once the week is scored; in a two-week playoff round, only once the
   * bracket has a winner.
   */
  result?: Result;
  /** Set when the scores tied and the platform's tiebreak gave the result. */
  tiebreak?: true;
  /** Everyone on the team's roster that week, starters first in slot order. */
  lineup: LineupEntry[];
}

export interface LineupEntry {
  player: string;
  position: string;
  /**
   * The starting slot, such as `QB` or `FLEX`, or `BN` for a player who
   * didn't start. Sleeper's matchups don't say which non-starters were on IR.
   */
  slot: string;
  /** The player's points this week, before any bonus or override. */
  points: number;
}

export type Result = "W" | "L" | "T";

export type Transaction = Trade | Claim;

interface TransactionBase {
  id: string;
  week: number;
  /** When it went through, as an ISO timestamp. */
  at: string;
  /** Players gained, with the team that gained each. */
  adds: { player: string; team: TeamId }[];
  /** Players let go, with the team that let each go. */
  drops: { player: string; team: TeamId }[];
}

export interface Trade extends TransactionBase {
  kind: "trade";
  teams: TeamId[];
  /** FAAB sent with the trade. */
  faab: { from: TeamId; to: TeamId; amount: number }[];
  /** Draft picks that changed hands: `team` is the team whose pick it was. */
  draftPicks: {
    season: string;
    round: number;
    team: TeamId;
    from: TeamId;
    to: TeamId;
  }[];
}

export interface Claim extends TransactionBase {
  /** A waiver claim, a free-agent pickup or drop, or a commissioner move. */
  kind: "waiver" | "free_agent" | "commissioner";
  team: TeamId;
  /** The winning FAAB bid, when the league uses FAAB. */
  faabBid?: number;
}

/** "7-1", or "6-1-1" with ties. */
export function formatRecord(s: Standing): string {
  return s.ties > 0
    ? `${s.wins}-${s.losses}-${s.ties}`
    : `${s.wins}-${s.losses}`;
}
