import type { DraftData } from "./draft-data.ts";
import type { League, TeamId } from "./league.ts";
import type { EvidencePack, Swearing } from "./validator/types.ts";

/**
 * The persona LLM prose is written in. Until `persona.md` exists (#54), every
 * draft uses the Broadcast preset.
 */
export interface Persona {
  preset: "Broadcast";
  swearing: Swearing;
  teasing: "none" | "light" | "roast";
  formality: "formal" | "casual" | "unhinged";
  shape: "prose" | "bullets";
  /** How long a blurb runs, in sentences (or bullets). */
  length: { min: number; max: number };
  /** The preset's own style note. */
  styleNote: string;
}

export const BROADCAST: Persona = {
  preset: "Broadcast",
  swearing: "off",
  teasing: "light",
  formality: "formal",
  shape: "prose",
  length: { min: 2, max: 3 },
  styleNote:
    "A studio host calling the week: crisp, confident and even-handed, with the odd dry line.",
};

/**
 * Everything the LLM may be told about a league-week, gathered once when a
 * draft begins. An LLM draft, a revision and the eval harness all write from
 * it, and the prompt is built from nothing else. Lore, stakes and each team's
 * last published blurb join it in later tickets.
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
}

/** The draft context for a new draft of the ranking week in `data`. */
export function draftContext(league: League, data: DraftData): DraftContext {
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
    persona: BROADCAST,
  };
}
