import { z } from "zod";
import type { League, TeamId } from "./league.ts";
/** How much a blend counts each league percentile. */
export declare const blendWeightsSchema: z.ZodObject<{
    all_play: z.ZodNumber;
    form: z.ZodNumber;
    record: z.ZodNumber;
}, z.core.$strict>;
export type BlendWeights = z.infer<typeof blendWeightsSchema>;
export declare const powerScoreMethodSchema: z.ZodEnum<{
    "all-play": "all-play";
    ffmwr: "ffmwr";
    ffwrapped: "ffwrapped";
    form: "form";
    ppg: "ppg";
    "ramped-blend": "ramped-blend";
    standings: "standings";
}>;
export type PowerScoreMethod = z.infer<typeof powerScoreMethodSchema>;
/**
 * The method a starting order came from, with the weights it used for that
 * week. A draft records it. Its shape is versioned by `FORMAT`.
 */
export declare const powerScoreRecordSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    method: z.ZodLiteral<"ramped-blend">;
    weights: z.ZodObject<{
        all_play: z.ZodNumber;
        form: z.ZodNumber;
        record: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    method: z.ZodEnum<{
        "all-play": "all-play";
        ffmwr: "ffmwr";
        ffwrapped: "ffwrapped";
        form: "form";
        ppg: "ppg";
        standings: "standings";
    }>;
}, z.core.$strict>], "method">;
export type PowerScoreRecord = z.infer<typeof powerScoreRecordSchema>;
/** Whether the season is too young for the power score to mean much. Week 0 has no power score to doubt. */
export declare function isSmallSample(week: number): boolean;
/**
 * Each team's power score through `week`: higher is better. Scores compare
 * only within one method. A team with no played weeks counts 0 for each stat.
 */
export declare function powerScores(league: League, week: number, used: PowerScoreRecord): Map<TeamId, number>;
/**
 * The order `used` proposes through `week`: by power score, then points for,
 * then the standings' own order, so every tie is broken the same way each run.
 */
export declare function startingOrder(league: League, week: number, used: PowerScoreRecord): TeamId[];
