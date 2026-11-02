import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.ts";
import type { League } from "./league.ts";
import { familyLeague } from "./league-file.ts";
import type { Swearing } from "./validator/types.ts";
import { punditDir, type Workspace } from "./workspace.ts";

export type PresetName = "broadcast" | "family" | "banter" | "roast";
export type Teasing = "none" | "light" | "roast";
export type Formality = "formal" | "casual" | "unhinged";

/** A ready-made persona: its swearing, teasing and formality, its style note and its preset sample. */
export interface Preset {
  name: string;
  swearing: Swearing;
  teasing: Teasing;
  formality: Formality;
  styleNote: string;
  /** A fixed blurb in the preset's manner, shown before a pundit picks it. */
  sample: string;
}

export const PRESETS: Record<PresetName, Preset> = {
  broadcast: {
    name: "Broadcast",
    swearing: "off",
    teasing: "light",
    formality: "formal",
    styleNote:
      "A studio host calling the week: crisp, confident and even-handed, with the odd dry line.",
    sample:
      "The Gridiron Gang handled their business again, a composed win built on a bench that keeps delivering. They look every bit a contender, though the run-in does them few favours.",
  },
  family: {
    name: "Family",
    swearing: "off",
    teasing: "light",
    formality: "casual",
    styleNote:
      "A friendly host anyone at the table could read aloud: warm, upbeat and generous, with gentle jokes.",
    sample:
      "What a week for the Gridiron Gang! Another win, and that bench just keeps on giving. Somebody please save a few points for the rest of us.",
  },
  banter: {
    name: "Banter",
    swearing: "mild",
    teasing: "light",
    formality: "casual",
    styleNote:
      "A mate in the group chat: quick, cheeky and opinionated, ribbing whoever earned it this week.",
    sample:
      "The Gridiron Gang won again and won't shut up about it. Fair play, that bench is stacked, but the luck is starting to look a bit suspicious.",
  },
  roast: {
    name: "Roast",
    swearing: "on",
    teasing: "roast",
    formality: "unhinged",
    styleNote:
      "A roast comic with the mic: merciless, loud and over the top, sparing nobody who had a bad week.",
    sample:
      "The Gridiron Gang won again, which says more about the poor souls they played than about them. That lineup is held together with tape and prayer, and when the wheels come off it'll be a hell of a show.",
  },
};

/**
 * The persona LLM prose is written in: a preset with any overrides applied,
 * the blurb shape and length, whether there's a week intro, and the pundit's
 * own style note, which joins the preset's.
 */
export interface Persona {
  preset: PresetName;
  swearing: Swearing;
  teasing: Teasing;
  formality: Formality;
  shape: "prose" | "bullets";
  /** How long a blurb runs, in sentences (or bullets). */
  length: { min: number; max: number };
  /** Whether the draft has a week intro. */
  intro: boolean;
  /** The pundit's own style note; empty for none. */
  styleNote: string;
  /** A family league's cap lifted by the pundit (`family-league: relaxed`). */
  familyLeagueRelaxed: boolean;
}

/** The persona with no `persona.md`: Broadcast as it comes. */
export const BROADCAST: Persona = fromPreset("broadcast");

function fromPreset(preset: PresetName): Persona {
  const p = PRESETS[preset];
  return {
    preset,
    swearing: p.swearing,
    teasing: p.teasing,
    formality: p.formality,
    shape: "prose",
    length: { min: 2, max: 3 },
    intro: true,
    styleNote: "",
    familyLeagueRelaxed: false,
  };
}

const presetName = z.enum(["broadcast", "family", "banter", "roast"]);
const swearing = z.enum(["off", "mild", "on"]);
const teasing = z.enum(["none", "light", "roast"]);
const formality = z.enum(["formal", "casual", "unhinged"]);
const shape = z.enum(["prose", "bullets"]);
const onOff = z.enum(["on", "off"]);

/** A length as `2-3` or a single count, at least 1. */
const length = z
  .union(
    [z.number().int().positive(), z.string().regex(/^\d+\s*[-–]\s*\d+$/)],
    {
      error: "use a length like 2-3, or a single count",
    },
  )
  .refine((v) => {
    const { min, max } = sentences(v);
    return min >= 1 && min <= max;
  }, "use a length like 2-3, shortest first");

/** A length's shortest and longest count. */
function sentences(v: number | string): { min: number; max: number } {
  const [min = 0, max = 0] =
    typeof v === "number" ? [v, v] : v.split(/[-–]/).map((n) => Number(n));
  return { min, max };
}

/** `persona.md`'s front matter. Its shape is versioned by `FORMAT`. */
export const personaSchema = z.strictObject({
  format: z.literal(1),
  preset: presetName,
  swearing: swearing.optional(),
  teasing: teasing.optional(),
  formality: formality.optional(),
  shape: shape.optional(),
  length: length.optional(),
  intro: onOff.optional(),
  "family-league": z.literal("relaxed").optional(),
});

/**
 * The persona a draft records in its front matter. Its shape is versioned by
 * `FORMAT`, with the ranking file's.
 */
export const personaRecordSchema = z.strictObject({
  preset: presetName,
  swearing,
  teasing,
  formality,
  shape,
  length: z.string().regex(/^\d+-\d+$/),
  intro: onOff,
  style_note: z.string().optional(),
  family_league_relaxed: z.boolean(),
});

export type PersonaRecord = z.infer<typeof personaRecordSchema>;

/** The persona as a draft records it. */
export function personaRecord(p: Persona): PersonaRecord {
  return {
    preset: p.preset,
    swearing: p.swearing,
    teasing: p.teasing,
    formality: p.formality,
    shape: p.shape,
    length: `${p.length.min}-${p.length.max}`,
    intro: p.intro ? "on" : "off",
    ...(p.styleNote ? { style_note: p.styleNote } : {}),
    family_league_relaxed: p.familyLeagueRelaxed,
  };
}

/** Where the workspace's pundit keeps their persona. */
export function personaPath(ws: Workspace): string {
  return join(punditDir(ws), "persona.md");
}

export interface LoadedPersona {
  persona: Persona;
  /** Lowered, relaxed or naming a manager: one line each. */
  warnings: string[];
}

/**
 * Reads the pundit's `persona.md`, under the season's family-league setting.
 * With no file, it's Broadcast. Unknown keys and any braced tag are errors.
 */
export async function loadPersona(
  ws: Workspace,
  league: League,
): Promise<LoadedPersona> {
  let text: string;
  try {
    text = await readFile(personaPath(ws), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { persona: BROADCAST, warnings: [] };
  }
  const { data, body, bodyLine } = readFrontMatter(
    "persona.md",
    text,
    "format",
  );
  const parsed = personaSchema.safeParse(data);
  if (!parsed.success) {
    throw new WorkspaceFileError(
      `persona.md: ${z.prettifyError(parsed.error)}`,
    );
  }
  const tags = body
    .split("\n")
    .flatMap((line, i) =>
      [...line.matchAll(/\{[^{}]*\}/g)].map(
        (m) => `line ${bodyLine + i}: ${m[0]}`,
      ),
    );
  if (tags.length > 0) {
    throw new WorkspaceFileError(
      `persona.md uses no tags, so remove each one: ${tags.join(", ")}`,
    );
  }
  const f = parsed.data;
  const base = fromPreset(f.preset);
  const persona: Persona = {
    ...base,
    ...(f.swearing && { swearing: f.swearing }),
    ...(f.teasing && { teasing: f.teasing }),
    ...(f.formality && { formality: f.formality }),
    ...(f.shape && { shape: f.shape }),
    ...(f.length !== undefined && { length: sentences(f.length) }),
    ...(f.intro && { intro: f.intro === "on" }),
    styleNote: body.trim().replace(/\s+/g, " "),
  };
  const warnings: string[] = [];
  const family = await familyLeague(ws);
  let held = persona;
  if (family && f["family-league"] === "relaxed") {
    held = { ...persona, familyLeagueRelaxed: true };
    warnings.push(
      `The family league is on, but persona.md relaxes it (family-league: relaxed): swearing ${persona.swearing}, teasing ${persona.teasing}. Publishing with it asks you to confirm the first time and whenever the persona changes.`,
    );
  } else if (family) {
    held = familyCap(persona);
    const lowered = [
      held.swearing !== persona.swearing &&
        `swearing (${persona.swearing}) is lowered to ${held.swearing}`,
      held.teasing !== persona.teasing &&
        `teasing (${persona.teasing}) ${held.swearing !== persona.swearing ? "to" : "is lowered to"} ${held.teasing}`,
    ].filter((s) => typeof s === "string");
    if (lowered.length > 0) {
      warnings.push(
        `The family league is on, so persona.md's ${lowered.join(" and its ")}. To keep them, add "family-league: relaxed" to persona.md.`,
      );
    }
  }
  const named = managersNamed(held.styleNote, league);
  if (named.length > 0) {
    warnings.push(
      `persona.md's style note names ${named.join(" and ")}, ${named.length === 1 ? "a manager" : "managers"} in the league. It's sent to the LLM provider with every draft.`,
    );
  }
  return { persona: held, warnings };
}

/** A family league's cap: no swearing, and teasing at most light. */
function familyCap(p: Persona): Persona {
  return {
    ...p,
    swearing: "off",
    teasing: p.teasing === "roast" ? "light" : p.teasing,
  };
}

/** The league's managers whose display names the text uses, as whole words. */
function managersNamed(text: string, league: League): string[] {
  if (!text) return [];
  const names = new Set(
    league.teams.flatMap((t) => t.managers.map((m) => m.displayName)),
  );
  return [...names].filter((name) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
      "iu",
    ).test(text),
  );
}
