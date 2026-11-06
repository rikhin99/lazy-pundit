import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.ts";
import {
  type HouseRule,
  type Outcome,
  type Payout,
  type Stakes,
  TRIGGER_KINDS,
} from "./stakes.ts";
import { seasonDir, type Workspace } from "./workspace.ts";

/** Where the season's `league.md` lives. */
export function leagueFilePath(ws: Workspace): string {
  return join(seasonDir(ws), "league.md");
}

/** What the season's `league.md` records. */
export interface LeagueFile {
  familyLeague: boolean;
  stakes: Stakes;
}

const DOLLARS = /^\$(\d+(?:\.\d{1,2})?)$/;
const SHARE = /^(\d+(?:\.\d+)?)%$/;
const FAAB = /^(\d+)\s*FAAB$/i;
const RULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEASON_ONLY = new Set(["last-place", "champion"]);

const week = z.number().int().min(1);

const houseRuleSchema = z
  .strictObject({
    id: z.string().regex(RULE_ID, {
      error:
        "an id is lower-case letters, digits and dashes, such as high-score",
    }),
    name: z.string().min(1),
    trigger: z
      .enum(TRIGGER_KINDS, {
        error: `a trigger is one of ${TRIGGER_KINDS.join(", ")}`,
      })
      .optional(),
    per: z.enum(["week", "season"]).optional(),
    outcome: z
      .union([z.string(), z.number()])
      .refine((o) => String(o).trim() !== "", {
        error:
          "write the outcome: dollars such as $10, FAAB such as 5 FAAB, or words",
      })
      .refine((o) => !/[{}]/.test(String(o)), {
        error: "an outcome can't hold a brace",
      }),
    from: week.optional(),
    until: week.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.trigger && SEASON_ONLY.has(r.trigger) && r.per === "week") {
      ctx.addIssue({
        code: "custom",
        message: `${r.id}: a ${r.trigger} trigger is per season, not per week`,
      });
    }
    if (r.per && !r.trigger) {
      ctx.addIssue({
        code: "custom",
        message: `${r.id}: per: needs a trigger`,
      });
    }
    if (r.from !== undefined && r.until !== undefined && r.until < r.from) {
      ctx.addIssue({
        code: "custom",
        message: `${r.id}: until: week ${r.until} comes before from: week ${r.from}`,
      });
    }
  });

/** `league.md`'s front matter. Its shape is versioned by `FORMAT`. */
export const leagueFileSchema = z
  .strictObject({
    league: z.literal(1),
    season: z.union([z.string(), z.number()]).optional(),
    "family-league": z
      .enum(["on", "off"], { error: 'family-league is "on" or "off"' })
      .optional(),
    stakes: z
      .literal("none", { error: 'stakes is "none" or left out' })
      .optional(),
    "buy-in": z
      .string()
      .regex(DOLLARS, { error: "the buy-in is dollars per team, such as $50" })
      .optional(),
    payouts: z
      .array(
        z.string().refine((p) => DOLLARS.test(p) || SHARE.test(p), {
          error: (i) =>
            `"${String(i.input)}" isn't a payout: give dollars, such as $100, or a share of the pot, such as 70%`,
        }),
      )
      .optional(),
    "last-place": z.enum(["standings", "losers-bracket"]).optional(),
    "house-rules": z.array(houseRuleSchema).optional(),
  })
  .superRefine((f, ctx) => {
    const fields = STAKES_FIELDS.filter((k) => f[k] !== undefined);
    if (f.stakes === "none" && fields.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `stakes: none means bragging rights only, so it can't sit beside ${fields.join(", ")}`,
      });
    }
    const shares = (f.payouts ?? [])
      .map((p) => SHARE.exec(p)?.[1])
      .reduce((a, s) => a + Number(s ?? 0), 0);
    if (shares > 100) {
      ctx.addIssue({
        code: "custom",
        message: `the payouts' shares come to ${shares}%, more than the whole pot`,
      });
    }
    const seen = new Set<string>();
    for (const r of f["house-rules"] ?? []) {
      if (seen.has(r.id)) {
        ctx.addIssue({
          code: "custom",
          message: `house rule ${r.id} is there twice: give each rule its own id`,
        });
      }
      seen.add(r.id);
    }
  });

const STAKES_FIELDS = [
  "buy-in",
  "payouts",
  "last-place",
  "house-rules",
] as const;

/** Reads a `league.md`'s text, refusing unknown keys and malformed stakes. */
export function readLeagueFile(text: string): LeagueFile {
  const { data } = readFrontMatter("league.md", text, "league");
  const parsed = leagueFileSchema.safeParse(data);
  if (!parsed.success) {
    throw new WorkspaceFileError(`league.md: ${z.prettifyError(parsed.error)}`);
  }
  const f = parsed.data;
  return { familyLeague: f["family-league"] === "on", stakes: stakesOf(f) };
}

/** The season's `league.md`; a missing file has the family league off and the stakes unrecorded. */
export async function loadLeagueFile(ws: Workspace): Promise<LeagueFile> {
  let text: string;
  try {
    text = await readFile(leagueFilePath(ws), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { familyLeague: false, stakes: { kind: "unrecorded" } };
  }
  return readLeagueFile(text);
}

/** Whether the season's `league.md` turns the family league on. A missing file means off. */
export async function familyLeague(ws: Workspace): Promise<boolean> {
  return (await loadLeagueFile(ws)).familyLeague;
}

function stakesOf(f: z.infer<typeof leagueFileSchema>): Stakes {
  if (f.stakes === "none") return { kind: "none" };
  if (STAKES_FIELDS.every((k) => f[k] === undefined))
    return { kind: "unrecorded" };
  const buyIn = f["buy-in"];
  return {
    kind: "recorded",
    ...(buyIn === undefined ? {} : { buyIn: Number(DOLLARS.exec(buyIn)?.[1]) }),
    payouts: (f.payouts ?? ["100%"]).map(payoutOf),
    lastPlace: f["last-place"] ?? "standings",
    houseRules: (f["house-rules"] ?? []).map(
      (r): HouseRule => ({
        id: r.id,
        name: r.name,
        ...(r.trigger
          ? {
              trigger: {
                kind: r.trigger,
                per: r.per ?? (SEASON_ONLY.has(r.trigger) ? "season" : "week"),
              },
            }
          : {}),
        outcome: outcomeOf(String(r.outcome).trim()),
        ...(r.from === undefined ? {} : { from: r.from }),
        ...(r.until === undefined ? {} : { until: r.until }),
      }),
    ),
  };
}

function payoutOf(p: string): Payout {
  const dollars = DOLLARS.exec(p)?.[1];
  return dollars !== undefined
    ? { dollars: Number(dollars) }
    : { share: Number(SHARE.exec(p)?.[1]) };
}

/** `$N` is dollars, `N FAAB` is FAAB, anything else is words. */
export function outcomeOf(text: string): Outcome {
  const dollars = DOLLARS.exec(text)?.[1];
  if (dollars !== undefined)
    return { kind: "dollars", amount: Number(dollars), text };
  const faab = FAAB.exec(text)?.[1];
  if (faab !== undefined) return { kind: "faab", amount: Number(faab), text };
  return { kind: "text", text };
}
