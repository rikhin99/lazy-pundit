import type { TeamId } from "../league.ts";
import { CLAUSE_BREAK, RESULT_VERBS } from "./extract.ts";
import { normalize, wholeWords } from "./names.ts";
import type { Ctx } from "./types.ts";

// ---------- the claim's team ----------

/** Prepositions whose team is an object, not a clause's subject. */
const OBJECT_PREPOSITIONS = [
  "to",
  "over",
  "against",
  "vs\\.?",
  "versus",
  "behind",
  "ahead of",
  "above",
  "below",
  "than",
  "of",
  "from",
  "past",
  "on",
];

/**
 * Words before a team's name that make it an object: the team a result is
 * against ("lost to Gus Bus", "beat Gus Bus") or one a preposition names ("a
 * win behind Gus Bus", "dropped 126.89 on Sam").
 */
const OBJECT_BEFORE = new RegExp(
  `(?:${RESULT_VERBS.source}|\\b(?:${OBJECT_PREPOSITIONS.join("|")})\\s+)$`,
  "i",
);

/** Words meaning the section's team: "we", "they", "this team". */
const PRONOUN = /\b(?:we|us|our|they|them|their|this team|the team)\b/gi;

/** A clause about the team named just before it: "Bench Mob, who sit at 7-1". */
const RELATIVE = /^\s*(?:who|which)\b/i;

/** A phrase put before its clause's subject: "At 7-1, Bench Mob lead". */
const FRONTED = /^\s*(?:at|after|on|in)\b/i;

interface Named {
  team: TeamId | null;
  start: number;
  end: number;
}

interface Clause {
  from: number;
  to: number;
  /** The break before it, "" for the sentence's first clause. */
  opener: string;
}

function clauses(s: string): Clause[] {
  const found: Clause[] = [];
  let from = 0;
  let opener = "";
  for (const m of s.matchAll(CLAUSE_BREAK)) {
    found.push({ from, to: m.index, opener });
    from = m.index + m[0].length;
    opener = m[0];
  }
  found.push({ from, to: s.length, opener });
  return found;
}

/** Every team's nickname, and each pronoun as the section's team, in order. */
function named(ctx: Ctx, s: string, section: TeamId | null): Named[] {
  const low = normalize(s);
  const found: Named[] = [];
  const add = (team: TeamId | null, re: RegExp) => {
    for (const m of low.matchAll(re)) {
      found.push({ team, start: m.index, end: m.index + m[0].length });
    }
  };
  for (const [team, names] of Object.entries(ctx.input.nicknames)) {
    for (const n of names) add(team as TeamId, wholeWords(n));
  }
  add(section, PRONOUN);
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The subject of a clause: the first team it names, or the section's team for
 * a pronoun, that isn't an object. Undefined when it names none.
 */
function subjectOf(s: string, names: Named[], c: Clause): Named | undefined {
  return names.find(
    (n) =>
      n.start >= c.from &&
      n.start < c.to &&
      !OBJECT_BEFORE.test(s.slice(0, n.start)),
  );
}

/**
 * The claim's team for an untagged claim at `start` of sentence `s`: the
 * subject of the claim's clause. A claim in brackets or a "who" clause
 * straight after a name is that team's ("lost to Gus Bus (4-4)"); a phrase
 * put before its subject takes the next clause's ("At 7-1, Bench Mob lead");
 * a clause naming no subject carries on the one before it ("Pete lost to Gus
 * Bus and sits at 3-5"), and the sentence starts from the section's team.
 */
export function claimsTeam(
  ctx: Ctx,
  s: string,
  start: number,
  section: TeamId | null,
): TeamId | null {
  const names = named(ctx, s, section);
  const cs = clauses(s);
  const i = cs.findLastIndex((c) => c.from <= start);
  const c = cs[i] as Clause;
  const text = s.slice(c.from, c.to);

  if (c.opener === "(" || (c.opener === "," && RELATIVE.test(text))) {
    const before = s.slice(0, c.from - c.opener.length).trimEnd().length;
    const prior = names.findLast((n) => n.end === before);
    if (prior) return prior.team;
  }
  const own = subjectOf(s, names, c);
  if (own) return own.team;
  const next = cs[i + 1];
  if (i === 0 && next?.opener === "," && FRONTED.test(text)) {
    const later = subjectOf(s, names, next);
    if (later) return later.team;
  }
  for (let j = i - 1; j >= 0; j--) {
    const earlier = subjectOf(s, names, cs[j] as Clause);
    if (earlier) return earlier.team;
  }
  return section;
}
