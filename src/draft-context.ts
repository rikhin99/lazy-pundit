import type { DraftData } from "./draft-data.ts";
import type { League, TeamId } from "./league.ts";
import type { Persona } from "./persona.ts";
import type { EvidencePack } from "./validator/types.ts";

/**
 * Everything the LLM may be told about a league-week, gathered once when a
 * draft begins. An LLM draft, a revision and the eval harness all write from
 * it, and the prompt is built from nothing else. Lore and stakes join it in
 * later tickets.
 *
 * Never in it: credentials, raw payloads, platform account IDs or emails.
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
  /** Each team's last published blurb, if a ranking was published before. */
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
    ...(lastBlurbs ? { lastBlurbs } : {}),
  };
}
