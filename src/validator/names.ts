import type { TeamId } from "../league.ts";
import type { Ctx } from "./types.ts";

// ---------- names ----------

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[’‘]/g, "'");
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a name as whole words, in normalized text. */
export function wholeWords(name: string): RegExp {
  return new RegExp(`(?<!\\w)${escapeRe(normalize(name))}(?!\\w)`, "g");
}

export interface Span {
  start: number;
  end: number;
}

export function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Whether the text names the team by one of its nicknames, as whole words. */
export function namesTeam(ctx: Ctx, team: TeamId, text: string): boolean {
  const low = normalize(text);
  return (ctx.input.nicknames[team] ?? []).some((n) => wholeWords(n).test(low));
}

/** Where any team's nickname appears in a sentence. */
export function nameSpans(
  ctx: Ctx,
  s: string,
): { start: number; end: number }[] {
  const low = normalize(s);
  const spans: { start: number; end: number }[] = [];
  for (const names of Object.values(ctx.input.nicknames)) {
    for (const n of names) {
      for (const m of low.matchAll(wholeWords(n))) {
        spans.push({ start: m.index, end: m.index + m[0].length });
      }
    }
  }
  return spans;
}
