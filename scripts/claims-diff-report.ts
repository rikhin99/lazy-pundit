/**
 * What `npm run claims:diff` compares and prints: a corpus of blurb sentences
 * run through two validators on the week-8 fixture, and each sentence whose
 * claims read differently.
 */
import type {
  CheckedClaim,
  ValidationResult,
  ValidatorInput,
} from "../src/validator/types.ts";
import {
  CLAIM_HEAVY,
  PLAIN_PROSE,
  TAGGED_PLAIN,
  TRUE_UNTAGGED,
} from "../test/support/plain-prose.ts";
import { blurb, id, week8Nicknames } from "../test/support/week8-evidence.ts";

/** A validator to compare: HEAD's or the working tree's `validate`. */
export type Check = (input: ValidatorInput) => ValidationResult;

/** One sentence run in one section (`null`: a blurb with no team). */
export interface Case {
  team: number | null;
  text: string;
}

/**
 * Sentences that pair cue kinds in one clause, so a change to which cue
 * picks a claim's stat shows up before any test holds the sentence. Each is
 * true for Baron Von Trade, section 5 (all-play 6th, points
 * against 2nd, form 5th, week 7th, points 4th, standings 9th; 19.95 margin,
 * 110.08 scored, high 120.02, low 97.02, 891.03 for, 112.71 over three,
 * 111.38 a week, 924.43 against, luck -1.09), but "seed", which the pack
 * doesn't hold. Add one when a cue is added. `CUE_PAIRS_MISREAD` lists those
 * the validator reads wrong.
 */
export const CUE_PAIRS = [
  // a ranking cue beside each stat cue
  "Ranked 6th in all-play.",
  "Ranked 2nd in points against.",
  "Ranked 5th in form lately.",
  "Ranked 7th this week.",
  "Ranked 4th in points.",
  "Ranked 9th in the standings.",
  "Ranked 9th by seed.",
  "In the 9th spot, but 4th in scoring.",
  "9th in the power rankings and 4th in points.",
  // two stat cues
  "4th in points and 9th in the standings.",
  "9th in the standings and 4th in points.",
  "6th in all-play, 2nd in points against.",
  "5th in form and 7th this week.",
  "7th this week but 4th in points on the season.",
  "2nd in points against and 4th in points for.",
  // a number beside each number cue
  "Lost by 19.95 after they scored 110.08.",
  "They put up 110.08, under their season high of 120.02.",
  "A season low of 97.02 and a season high of 120.02.",
  "891.03 points for, averaging 111.38 per week.",
  "Averaging 112.71 over the last three, with 891.03 on the season.",
  "They've allowed 924.43 while scoring 891.03 in total.",
  "Bad luck has cost them 1.09 wins after they scored 110.08.",
];

/**
 * True cue-pair sentences the validator reads wrong: "891.03" after a form or
 * points-against cue takes that cue, the last before the number, over "on
 * the season" or "in total". A fix turns `test/claims-diff-report.test.ts`
 * red until the sentence comes off this list.
 */
export const CUE_PAIRS_MISREAD = [
  "Averaging 112.71 over the last three, with 891.03 on the season.",
  "They've allowed 924.43 while scoring 891.03 in total.",
];

const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, null];

/**
 * Every case to run, as `test/validator.test.ts`'s invariants run them: a
 * `TRUE_UNTAGGED` sentence in its own section, every other sentence in each
 * team's section and in none.
 */
export function corpus(): Case[] {
  const everywhere = [
    ...PLAIN_PROSE,
    ...TAGGED_PLAIN,
    ...CLAIM_HEAVY,
    ...CUE_PAIRS,
  ];
  return [
    ...TRUE_UNTAGGED.map(([team, text]) => ({ team, text })),
    ...everywhere.flatMap((text) => SECTIONS.map((team) => ({ team, text }))),
  ];
}

/** A claim's status and evidence ID, as an unchanged claim prints. */
const statusAndId = (c: CheckedClaim) =>
  `${c.status}${c.id === undefined ? "" : ` ${c.id}`}`;
/** A claim's status, evidence ID and reason, or "none" when it isn't found. */
const fullReading = (c: CheckedClaim | undefined) =>
  c === undefined ? "none" : `${statusAndId(c)} (${c.reason})`;
/** Which claim this is, so the two validators' claims pair up. */
const claimKey = (c: CheckedClaim) => `${c.start}:${c.end}:${c.text}`;
/** Every field alike; both sides come from one shape, so key order matches. */
const readsTheSame = (
  a: CheckedClaim | undefined,
  b: CheckedClaim | undefined,
) => JSON.stringify(a) === JSON.stringify(b);

function section(team: number | null): string {
  if (team === null) return "section none";
  const name = week8Nicknames()[id(team)]?.[0];
  return `section ${team}${name === undefined ? "" : ` (${name})`}`;
}

/**
 * The lines to print: each case whose claims read differently under `after`
 * than under `before`, with every claim's words and both readings, or one
 * line saying nothing changed.
 */
export function claimsDiff(
  before: Check,
  after: Check,
  cases: Case[] = corpus(),
): string[] {
  const changed: string[][] = [];
  for (const { team, text } of cases) {
    const beforeClaims = before(blurb(team, text)).claims;
    const afterClaims = after(blurb(team, text)).claims;
    const keys = new Set([...afterClaims, ...beforeClaims].map(claimKey));
    const pairs = [...keys].map((k) => ({
      before: beforeClaims.find((c) => claimKey(c) === k),
      after: afterClaims.find((c) => claimKey(c) === k),
    }));
    if (pairs.every((p) => readsTheSame(p.before, p.after))) continue;
    changed.push([
      `${section(team)}: ${text}`,
      ...pairs.map(({ before: b, after: a }) => {
        const words = (a ?? b)?.text;
        return readsTheSame(b, a) && a !== undefined
          ? `  "${words}": unchanged, ${statusAndId(a)}`
          : `  "${words}": ${fullReading(b)} → ${fullReading(a)}`;
      }),
    ]);
  }
  if (changed.length === 0) {
    return ["No claim reads differently in any sentence."];
  }
  const count = `${changed.length} sentence${changed.length === 1 ? "" : "s"}`;
  return [
    `${count} ${changed.length === 1 ? "reads" : "read"} differently:`,
    ...changed.flatMap((lines) => ["", ...lines]),
  ];
}
