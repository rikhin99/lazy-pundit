import type { DraftData } from "./draft-data.ts";
import type { League, TeamId } from "./league.ts";
import type { SentLore } from "./lore.ts";
import type { Persona } from "./persona.ts";
import type { EvidencePack } from "./validator/types.ts";

/**
 * Everything the LLM may be told about a league-week, gathered once when a
 * draft begins. An LLM draft, a revision and the eval harness all write from
 * it, and the prompt is built from nothing else. Stakes join it in a later
 * ticket.
 *
 * Never in it: credentials, raw payloads, platform account IDs or the
 * platform's emails. Lore is the pundits' own words, so it can hold what they
 * wrote; the personal-data warning says so first.
 */
export interface DraftContext {
  league: string;
  season: string;
  /** The ranking week. */
  week: number;
  /** Each team by name, with its managers' display names. */
  teams: { id: TeamId; name: string; managers: string[] }[];
  evidence: EvidencePack;
  persona: Persona;
  /** The lore, without what a departed manager's sections or comments hold. */
  lore: SentLore;
  /**
   * Each team's last published blurb, if a ranking was published before. It's
   * the pundit's published words, so it may repeat lore about a manager who
   * has since left.
   */
  lastBlurbs?: LastBlurbs;
}

/**
 * Each team's blurb in the last published ranking of an earlier week this
 * season, tags stripped: its evidence IDs aren't in this week's pack.
 */
export interface LastBlurbs {
  /** The published ranking's week, which may be before last week. */
  week: number;
  blurbs: Partial<Record<TeamId, string>>;
}

/** The draft context for a new draft of the ranking week in `data`. */
export function draftContext(
  league: League,
  data: DraftData,
  persona: Persona,
  lore: SentLore,
  lastBlurbs?: LastBlurbs,
): DraftContext {
  return {
    league: league.name,
    season: league.season,
    week: data.week,
    teams: league.teams.map((t) => ({
      id: t.id,
      name: t.name,
      managers: t.managers.map((m) => m.displayName),
    })),
    evidence: data.evidence,
    persona,
    lore,
    ...(lastBlurbs ? { lastBlurbs } : {}),
  };
}
