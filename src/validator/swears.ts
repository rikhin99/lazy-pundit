import { nameSpans, overlaps } from "./names.ts";
import type { Ctx, Swear } from "./types.ts";

// ---------- swearing ----------

export const SWEARS =
  /\b(?:(?:mother)?fuck(?:s|ed|er|ers|ing|in|face|wit)?|(?:bull)?shit(?:s|ty|ted|ting|head|show|bag)?|bitch(?:es|y|ing)?|bastards?|assholes?|ass|arse|(?:god)?damn(?:ed|it)?|cunts?|dick(?:s|head|heads)?|cock(?:s|sucker|suckers)?|piss(?:ed|es|ing)?|wtf|stfu)\b/gi;

export function swears(ctx: Ctx, plain: string): Swear[] {
  const names = nameSpans(ctx, plain);
  const out: Swear[] = [];
  for (const m of plain.matchAll(SWEARS)) {
    const start = m.index;
    const end = start + m[0].length;
    if (names.some((n) => overlaps({ start, end }, n))) continue;
    out.push({ word: m[0], start, end });
  }
  return out;
}
