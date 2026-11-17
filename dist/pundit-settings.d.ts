import { z } from "zod";
import type { League } from "./league.ts";
import { type BlendWeights, type PowerScoreMethod, type PowerScoreRecord } from "./power-score.ts";
import { type Workspace } from "./workspace.ts";
/** `settings.md`'s front matter. Its shape is versioned by `FORMAT`. */
export declare const punditSettingsSchema: z.ZodObject<{
    format: z.ZodLiteral<1>;
    method: z.ZodOptional<z.ZodEnum<{
        "all-play": "all-play";
        ffmwr: "ffmwr";
        ffwrapped: "ffwrapped";
        form: "form";
        ppg: "ppg";
        "ramped-blend": "ramped-blend";
        standings: "standings";
    }>>;
    weights: z.ZodOptional<z.ZodObject<{
        first_week: z.ZodObject<{
            all_play: z.ZodNumber;
            form: z.ZodNumber;
            record: z.ZodNumber;
        }, z.core.$strict>;
        last_week: z.ZodObject<{
            all_play: z.ZodNumber;
            form: z.ZodNumber;
            record: z.ZodNumber;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A pundit's choice of power-score method, with its weights at each end of the ramp. */
export interface PunditSettings {
    method: PowerScoreMethod;
    weights: {
        first_week: BlendWeights;
        last_week: BlendWeights;
    };
}
/** The settings with no `settings.md`: the ramped blend from 5/3/2 to 3/3/7. */
export declare const DEFAULT_SETTINGS: PunditSettings;
/** Where the workspace's pundit keeps their settings. */
export declare function punditSettingsPath(ws: Workspace): string;
/** Reads the pundit's `settings.md`. What it leaves out, or a missing file, is the default. */
export declare function loadPunditSettings(ws: Workspace): Promise<PunditSettings>;
/**
 * What the settings ask of a ranking week, as a draft records it. The weights
 * move in a straight line from the first regular-season week to the last, and
 * hold outside them.
 */
export declare function methodForWeek(settings: PunditSettings, league: League, week: number): PowerScoreRecord;
