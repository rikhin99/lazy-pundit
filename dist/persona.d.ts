import { z } from "zod";
import type { League } from "./league.ts";
import { type Lore } from "./lore.ts";
import type { Swearing } from "./validator/types.ts";
import { type Workspace } from "./workspace.ts";
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
export declare const PRESETS: Record<PresetName, Preset>;
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
    length: {
        min: number;
        max: number;
    };
    /** Whether the draft has a week intro. */
    intro: boolean;
    /** The pundit's own style note; empty for none. */
    styleNote: string;
    /** A family league's cap lifted by the pundit (`family-league: relaxed`). */
    familyLeagueRelaxed: boolean;
}
/** The persona with no `persona.md`: Broadcast as it comes. */
export declare const BROADCAST: Persona;
/** `persona.md`'s front matter. Its shape is versioned by `FORMAT`. */
export declare const personaSchema: z.ZodObject<{
    format: z.ZodLiteral<1>;
    preset: z.ZodEnum<{
        banter: "banter";
        broadcast: "broadcast";
        family: "family";
        roast: "roast";
    }>;
    swearing: z.ZodOptional<z.ZodEnum<{
        mild: "mild";
        off: "off";
        on: "on";
    }>>;
    teasing: z.ZodOptional<z.ZodEnum<{
        light: "light";
        none: "none";
        roast: "roast";
    }>>;
    formality: z.ZodOptional<z.ZodEnum<{
        casual: "casual";
        formal: "formal";
        unhinged: "unhinged";
    }>>;
    shape: z.ZodOptional<z.ZodEnum<{
        bullets: "bullets";
        prose: "prose";
    }>>;
    length: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
    intro: z.ZodOptional<z.ZodEnum<{
        off: "off";
        on: "on";
    }>>;
    "family-league": z.ZodOptional<z.ZodLiteral<"relaxed">>;
}, z.core.$strict>;
/**
 * The persona a draft records in its front matter. Its shape is versioned by
 * `FORMAT`, with the ranking file's.
 */
export declare const personaRecordSchema: z.ZodObject<{
    preset: z.ZodEnum<{
        banter: "banter";
        broadcast: "broadcast";
        family: "family";
        roast: "roast";
    }>;
    swearing: z.ZodEnum<{
        mild: "mild";
        off: "off";
        on: "on";
    }>;
    teasing: z.ZodEnum<{
        light: "light";
        none: "none";
        roast: "roast";
    }>;
    formality: z.ZodEnum<{
        casual: "casual";
        formal: "formal";
        unhinged: "unhinged";
    }>;
    shape: z.ZodEnum<{
        bullets: "bullets";
        prose: "prose";
    }>;
    length: z.ZodString;
    intro: z.ZodEnum<{
        off: "off";
        on: "on";
    }>;
    style_note: z.ZodOptional<z.ZodString>;
    family_league_relaxed: z.ZodBoolean;
}, z.core.$strict>;
export type PersonaRecord = z.infer<typeof personaRecordSchema>;
/** The persona as a draft records it. */
export declare function personaRecord(p: Persona): PersonaRecord;
/** Where the workspace's pundit keeps their persona. */
export declare function personaPath(ws: Workspace): string;
export interface LoadedPersona {
    persona: Persona;
    /** Lowered, relaxed or naming a manager: one line each. */
    warnings: string[];
}
/**
 * Reads the pundit's `persona.md`, under the season's family-league setting.
 * With no file, it's Broadcast. Unknown keys and any braced tag are errors.
 */
export declare function loadPersona(ws: Workspace, league: League, lore: Lore): Promise<LoadedPersona>;
