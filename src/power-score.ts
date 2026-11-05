import { z } from "zod";
import { buildEvidencePack, ranks } from "./evidence-pack.ts";
import type { League, TeamId } from "./league.ts";
import { standingsThrough, winPercentage } from "./standings.ts";
import type { EvidenceValue } from "./validator/types.ts";

/** How much a blend counts each league percentile. */
export const blendWeightsSchema = z
  .strictObject({
    all_play: z.number().nonnegative(),
    form: z.number().nonnegative(),
    record: z.number().nonnegative(),
  })
  .refine((w) => w.all_play + w.form + w.record > 0, {
    message: "at least one weight must be above 0",
  });

export type BlendWeights = z.infer<typeof blendWeightsSchema>;

export const powerScoreMethodSchema = z.enum([
  "standings",
  "ppg",
  "all-play",
  "form",
  "ffwrapped",
  "ffmwr",
  "ramped-blend",
]);

export type PowerScoreMethod = z.infer<typeof powerScoreMethodSchema>;

/**
 * The method a starting order came from, with the weights it used for that
 * week. A draft records it. Its shape is versioned by `FORMAT`.
 */
export const powerScoreRecordSchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("ramped-blend"),
    weights: blendWeightsSchema,
  }),
  z.strictObject({
    method: powerScoreMethodSchema.exclude(["ramped-blend"]),
  }),
]);

export type PowerScoreRecord = z.infer<typeof powerScoreRecordSchema>;

/** The last ranking week whose starting order means little yet. */
const SMALL_SAMPLE_WEEKS = 4;

/** Whether the season is too young for the power score to mean much. Week 0 has no power score to doubt. */
export function isSmallSample(week: number): boolean {
  return week >= 1 && week <= SMALL_SAMPLE_WEEKS;
}

/**
 * Each team's power score through `week`: higher is better. Scores compare
 * only within one method. A team with no played weeks counts 0 for each stat.
 */
export function powerScores(
  league: League,
  week: number,
  used: PowerScoreRecord,
): Map<TeamId, number> {
  const { teams } = buildEvidencePack(league, week);
  const inputs = standingsThrough(league, week).map((s) => {
    const ev = teams[s.team] ?? {};
    return {
      team: s.team,
      record: winPercentage(s),
      allPlay: allPlayPercentage(ev.allplay),
      ppg: num(ev.ppg),
      form: num(ev.form3),
      high: num(ev.high),
      low: num(ev.low),
      efficiency: num(ev.efficiency),
      luck: num(ev.luck),
    };
  });
  type Input = (typeof inputs)[number];
  // Rounded so a mathematical tie, whatever order its sum ran in, stays a tie.
  const scored = (score: (l: Input) => number) =>
    new Map(inputs.map((l) => [l.team, Math.round(score(l) * 1e9) / 1e9]));

  switch (used.method) {
    case "standings":
      return scored((l) => l.record);
    case "ppg":
      return scored((l) => l.ppg);
    case "all-play":
      return scored((l) => l.allPlay);
    case "form":
      return scored((l) => l.form);
    case "ffwrapped":
      return scored(
        (l) => (l.ppg * 6 + (l.high + l.low) * 2 + l.record * 400) / 10,
      );
    case "ffmwr": {
      const rank = (stat: (l: Input) => number) =>
        ranks(inputs.map((l) => [l.team, stat(l)]));
      const ppg = rank((l) => l.ppg);
      const efficiency = rank((l) => l.efficiency);
      const luck = rank((l) => l.luck);
      // An average of ranks, where lower is better, turned the other way up.
      return scored(
        ({ team }) =>
          -(
            (ppg.get(team) as number) +
            (efficiency.get(team) as number) +
            (luck.get(team) as number)
          ) / 3,
      );
    }
    case "ramped-blend": {
      const { all_play, form, record } = used.weights;
      const allPlayAt = percentiles(inputs.map((l) => l.allPlay));
      const formAt = percentiles(inputs.map((l) => l.form));
      const recordAt = percentiles(inputs.map((l) => l.record));
      return scored(
        (l) =>
          (all_play * allPlayAt(l.allPlay) +
            form * formAt(l.form) +
            record * recordAt(l.record)) /
          (all_play + form + record),
      );
    }
  }
}

/**
 * The order `used` proposes through `week`: by power score, then points for,
 * then the standings' own order, so every tie is broken the same way each run.
 */
export function startingOrder(
  league: League,
  week: number,
  used: PowerScoreRecord,
): TeamId[] {
  const scores = powerScores(league, week, used);
  const score = (team: TeamId) => scores.get(team) as number;
  return standingsThrough(league, week)
    .sort((a, b) => score(b.team) - score(a.team) || b.pointsFor - a.pointsFor)
    .map((s) => s.team);
}

/** A value's place in the league, from 0 (worst) to 1 (best); level values share the lower. */
function percentiles(values: number[]): (value: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  return (value) =>
    sorted.length < 2 ? 0.5 : sorted.indexOf(value) / (sorted.length - 1);
}

/** The win rate of an all-play record written `W-L` or `W-L-T`. */
function allPlayPercentage(record: EvidenceValue | undefined): number {
  if (typeof record !== "string") return 0;
  const [w = 0, l = 0, t = 0] = record.split("-").map(Number);
  return w + l + t === 0 ? 0 : (w + t / 2) / (w + l + t);
}

function num(v: EvidenceValue | undefined): number {
  return typeof v === "number" ? v : 0;
}
