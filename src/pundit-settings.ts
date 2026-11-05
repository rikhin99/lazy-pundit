import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.ts";
import type { League } from "./league.ts";
import {
  type BlendWeights,
  blendWeightsSchema,
  type PowerScoreMethod,
  type PowerScoreRecord,
  powerScoreMethodSchema,
} from "./power-score.ts";
import { punditDir, type Workspace } from "./workspace.ts";

/**
 * One end of the ramp. Adding up to at least 1 means a week's weights, each
 * rounded to two places as a draft records them, can't all round to 0.
 */
const rampEndSchema = blendWeightsSchema.refine(
  (w) => w.all_play + w.form + w.record >= 1,
  { message: "the weights must add up to at least 1" },
);

/** `settings.md`'s front matter. Its shape is versioned by `FORMAT`. */
export const punditSettingsSchema = z.strictObject({
  format: z.literal(1),
  method: powerScoreMethodSchema.optional(),
  weights: z
    .strictObject({
      first_week: rampEndSchema,
      last_week: rampEndSchema,
    })
    .optional(),
});

/** A pundit's choice of power-score method, with its weights at each end of the ramp. */
export interface PunditSettings {
  method: PowerScoreMethod;
  weights: { first_week: BlendWeights; last_week: BlendWeights };
}

/** The settings with no `settings.md`: the ramped blend from 5/3/2 to 3/3/7. */
export const DEFAULT_SETTINGS: PunditSettings = {
  method: "ramped-blend",
  weights: {
    first_week: { all_play: 5, form: 3, record: 2 },
    last_week: { all_play: 3, form: 3, record: 7 },
  },
};

/** Reads the pundit's `settings.md`. What it leaves out, or a missing file, is the default. */
export async function loadPunditSettings(
  ws: Workspace,
): Promise<PunditSettings> {
  let text: string;
  try {
    text = await readFile(join(punditDir(ws), "settings.md"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return DEFAULT_SETTINGS;
  }
  const { data } = readFrontMatter("settings.md", text, "format");
  const parsed = punditSettingsSchema.safeParse(data);
  if (!parsed.success) {
    throw new WorkspaceFileError(
      `settings.md: ${z.prettifyError(parsed.error)}`,
    );
  }
  return {
    method: parsed.data.method ?? DEFAULT_SETTINGS.method,
    weights: parsed.data.weights ?? DEFAULT_SETTINGS.weights,
  };
}

/**
 * What the settings ask of a ranking week, as a draft records it. The weights
 * move in a straight line from the first regular-season week to the last, and
 * hold outside them.
 */
export function methodForWeek(
  settings: PunditSettings,
  league: League,
  week: number,
): PowerScoreRecord {
  if (settings.method !== "ramped-blend") return { method: settings.method };
  const { first_week: first, last_week: last } = settings.weights;
  const span = league.settings.regularSeasonWeeks - 1;
  const along = span < 1 ? 1 : Math.min(1, Math.max(0, (week - 1) / span));
  const at = (key: keyof BlendWeights) =>
    Math.round((first[key] + (last[key] - first[key]) * along) * 100) / 100;
  return {
    method: "ramped-blend",
    weights: {
      all_play: at("all_play"),
      form: at("form"),
      record: at("record"),
    },
  };
}
