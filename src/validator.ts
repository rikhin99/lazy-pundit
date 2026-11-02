import type { TeamId } from "./league.ts";

/**
 * The validator: a pure check of every claim in a blurb or week intro against
 * the evidence pack and order evidence, plus the swearing word list. No I/O,
 * and nothing here knows about the ranking file or the workspace.
 */

/** One evidence value: a number, or text such as `7-1`, `W3`, `W` or a team ID. */
export type EvidenceValue = number | string;

/** The stats a claim may cite, by evidence ID, as the ranking week saw them. */
export interface EvidencePack {
  /** The ranking week: untagged weekly claims are read as `w<week>.…`. */
  week: number;
  /** Each team's stats by bare evidence ID (`record`, `w8.points`). */
  teams: Record<TeamId, Record<string, EvidenceValue>>;
  /** League-wide items by evidence ID (`wk.high`). */
  league: Record<string, EvidenceValue>;
}

/** A team's place, movement and group, read from the draft's current order. */
export interface OrderEvidence {
  place: number;
  /** Places climbed since the movement baseline (negative for a fall), or `new`. */
  move: number | "new";
  /** The text of the enclosing group heading, if any. */
  group?: string;
}

export type Swearing = "off" | "mild" | "on";

export interface ValidatorInput {
  /** A blurb or week intro, as written in the draft. */
  text: string;
  /** The team whose section this is, or null for the week intro. */
  team: TeamId | null;
  evidence: EvidencePack;
  /** Order evidence per team. Empty when the text was drafted without it. */
  order: Record<TeamId, OrderEvidence>;
  /** Every name a team goes by: its name, its managers' names and lore nicknames. */
  nicknames: Record<TeamId, string[]>;
  /** The lore, stakes and log sections that exist, as `{lore=…}` and friends cite them. */
  sections: { lore: string[]; stakes: string[]; log: string[] };
  swearing: Swearing;
  /**
   * The evidence and order the text was last checked against, when they
   * differ from now. A claim that held then and fails now is stale.
   */
  before?: { evidence?: EvidencePack; order?: Record<TeamId, OrderEvidence> };
}

export type ClaimStatus =
  | "verified"
  | "wrong"
  | "stale"
  | "unknown-id"
  | "loose"
  | "unchecked";

export interface CheckedClaim {
  /** The claim's words, without any tag. */
  text: string;
  /** Where the claim sits in the input text, tag included when it has one. */
  start: number;
  end: number;
  tagged: boolean;
  /** The evidence ID cited, or for an untagged claim the one it matched. */
  id?: string;
  status: ClaimStatus;
  /** Why, in words the pundit reads. */
  reason: string;
  /** For a stale claim: what changed since it held. */
  cause?: "refresh" | "reorder";
}

/** An evidence tag to add around `[start, end)` of the input text. */
export interface AutoTag {
  start: number;
  end: number;
  id: string;
}

export interface Swear {
  word: string;
  start: number;
  end: number;
}

export interface ValidationResult {
  claims: CheckedClaim[];
  autoTags: AutoTag[];
  swears: Swear[];
}

// ---------- tags ----------

const TAG = /\[([^\][]*)\]\{(ev|lore|stakes|log)=([^{}\s]+)\}/g;

interface Tag {
  /** Offsets of the whole `[…]{…}` in the input text. */
  start: number;
  end: number;
  inner: string;
  kind: "ev" | "lore" | "stakes" | "log";
  value: string;
  /** Offsets of the inner words in the plain text. */
  plainStart: number;
  plainEnd: number;
}

/**
 * The text with every tag unwrapped, the tags, and a map from each plain
 * offset back to the input text.
 */
function unwrap(text: string) {
  const tags: Tag[] = [];
  const toInput: number[] = [];
  let plain = "";
  let last = 0;
  const copy = (from: number, to: number) => {
    for (let i = from; i < to; i++) toInput.push(i);
    plain += text.slice(from, to);
  };
  for (const m of text.matchAll(TAG)) {
    copy(last, m.index);
    const inner = m[1] as string;
    const plainStart = plain.length;
    copy(m.index + 1, m.index + 1 + inner.length);
    tags.push({
      start: m.index,
      end: m.index + m[0].length,
      inner,
      kind: m[2] as Tag["kind"],
      value: m[3] as string,
      plainStart,
      plainEnd: plain.length,
    });
    last = m.index + m[0].length;
  }
  copy(last, text.length);
  toInput.push(text.length);
  return { plain, tags, toInput };
}

/** `[7-1]{ev=record}` → `7-1`: tags are for the tool, not the league. */
export function stripTags(text: string): string {
  return unwrap(text).plain;
}

// ---------- evidence ----------

type Kind =
  | "record"
  | "streak"
  | "result"
  | "team"
  | "ordinal"
  | "luck"
  | "move"
  | "group"
  | "playoffs"
  | "number"
  | "text";

/** The stat an ID names, without its `w<N>.` week prefix. */
function statOf(id: string): string {
  return id.replace(/^w\d+\./, "");
}

function kindOf(id: string, value: EvidenceValue): Kind {
  const stat = statOf(id);
  if (stat === "record" || stat === "allplay") return "record";
  if (stat === "streak") return "streak";
  if (stat === "result") return "result";
  if (stat === "opponent") return "team";
  if (stat === "place" || stat === "standing" || stat === "seed")
    return "ordinal";
  if (stat === "rank" || stat.endsWith("_rank")) return "ordinal";
  if (stat === "luck") return "luck";
  if (stat === "move") return "move";
  if (stat === "group") return "group";
  if (stat === "playoffs") return "playoffs";
  return typeof value === "number" ? "number" : "text";
}

interface Ctx {
  input: ValidatorInput;
  evidence: EvidencePack;
  order: Record<TeamId, OrderEvidence>;
  teamCount: number;
}

interface Resolved {
  team: TeamId | null;
  stat: string;
  value: EvidenceValue;
  kind: Kind;
}

/** Looks an evidence ID up for the section team (or another team, or the league). */
function resolve(
  ctx: Ctx,
  id: string,
  section: TeamId | null,
): Resolved | null {
  if (id.startsWith("wk.") || /^w\d+\.correction$/.test(id)) {
    const value = ctx.evidence.league[id];
    return value === undefined
      ? null
      : { team: null, stat: id, value, kind: kindOf(id, value) };
  }
  let team = section;
  let stat = id;
  const slash = id.lastIndexOf("/");
  if (slash >= 0) {
    team = id.slice(0, slash) as TeamId;
    stat = id.slice(slash + 1);
  }
  if (!team) return null;
  let value: EvidenceValue | undefined;
  if (stat === "place" || stat === "move" || stat === "group") {
    value = ctx.order[team]?.[stat];
  } else {
    value = ctx.evidence.teams[team]?.[stat];
  }
  return value === undefined
    ? null
    : { team, stat, value, kind: kindOf(stat, value) };
}

// ---------- numbers ----------

const WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
};
const ORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
};
const NUMW = Object.keys(WORDS).join("|");
const ORDW = Object.keys(ORDS).join("|");

interface Num {
  n: number;
  /** Decimal places written, for rounding. */
  dp: number;
}

function parseNum(token: string): Num | null {
  const tok = token.toLowerCase().replace(/,/g, "");
  if (tok in WORDS) return { n: WORDS[tok] as number, dp: 0 };
  if (tok in ORDS) return { n: ORDS[tok] as number, dp: 0 };
  const m = tok.match(/^(\d+)(?:\.(\d+))?(?:st|nd|rd|th)?$/);
  if (!m) return null;
  return {
    n: Number.parseFloat(tok.replace(/(st|nd|rd|th)$/, "")),
    dp: m[2]?.length ?? 0,
  };
}

const NUM_TOKEN = new RegExp(
  `(?<![\\w.])(\\d[\\d,]*(?:\\.\\d+)?(?:st|nd|rd|th)?|${NUMW}|${ORDW})\\b`,
  "i",
);

function firstNum(text: string): { num: Num; index: number } | null {
  const m = text.match(NUM_TOKEN);
  if (!m) return null;
  const num = parseNum(m[1] as string);
  return num ? { num, index: m.index as number } : null;
}

type Hedge = "over" | "under" | "approx" | null;

const HEDGE =
  /(?:more than|over|north of|under|less than|fewer than|nearly|almost|about|around|roughly|close to|~)\s*$/;

/** A hedge right before a number: "over 950", "nearly two". */
function hedgeBefore(text: string): Hedge {
  const m = text.toLowerCase().match(HEDGE);
  if (!m) return null;
  if (/more than|over|north of/.test(m[0])) return "over";
  if (/under|less than|fewer than/.test(m[0])) return "under";
  return "approx";
}

/** Does a written number agree with a fact, allowing for rounding and hedges? */
function numMatch(claim: Num, hedge: Hedge, fact: number): boolean {
  if (hedge === "over") return fact > claim.n;
  if (hedge === "under") return fact < claim.n;
  if (hedge === "approx") {
    return Math.abs(fact - claim.n) <= Math.max(0.05 * Math.abs(claim.n), 0.5);
  }
  const f = 10 ** claim.dp;
  return Math.round(fact * f) / f === claim.n;
}

// ---------- does text agree with one fact? ----------

const WIN_WORDS =
  /\b(beat|beats|edged|edges|crushed|smoked|won|wins|win|took down|squeaked past|handled|blew out|outlasted)\b/;
const LOSS_WORDS = /\b(lost|loses|loss|fell|dropped one|lose)\b/;

function agrees(ctx: Ctx, r: Resolved, words: string): boolean {
  const t = words.toLowerCase();
  const { value } = r;
  switch (r.kind) {
    case "record": {
      const m = t.match(/(\d+)\s*[-–]\s*(\d+)(?:\s*[-–]\s*(\d+))?/);
      if (!m) return false;
      const written = [m[1], m[2], m[3]].filter((x) => x !== undefined);
      const fact = String(value).split("-");
      if (fact.length === 3 && fact[2] === "0" && written.length === 2) {
        fact.pop();
      }
      return written.join("-") === fact.join("-");
    }
    case "team":
      return namesTeam(ctx, String(value) as TeamId, t);
    case "result": {
      const won = WIN_WORDS.test(t);
      const lost = LOSS_WORDS.test(t);
      if (value === "W") return won && !lost;
      if (value === "L") return lost && !won;
      return /\b(tie|tied|draw)\b/.test(t);
    }
    case "streak": {
      const n = firstNum(t);
      if (!n) return false;
      const fact = String(value);
      const dir = /\b(loss|losses|losing|skid|l's)\b/.test(t)
        ? "L"
        : /\b(win|wins|winning|heater|w's)\b/.test(t)
          ? "W"
          : null;
      return n.num.n === Number(fact.slice(1)) && (!dir || dir === fact[0]);
    }
    case "ordinal": {
      if (typeof value !== "number") return false;
      const n = firstNum(t);
      if (!n) {
        if (
          /\b(lead|leads|leading|top|best|highest|most)\b|week[- ]high/.test(t)
        )
          return value === 1;
        if (/\b(last|worst|lowest|fewest)\b|week[- ]low/.test(t))
          return value === ctx.teamCount;
        return false;
      }
      return n.num.n === value;
    }
    case "luck":
    case "number": {
      if (typeof value !== "number") return false;
      const n = firstNum(t);
      if (!n) return false;
      const fact = r.kind === "luck" ? Math.abs(value) : value;
      return numMatch(n.num, hedgeBefore(t.slice(0, n.index)), fact);
    }
    default:
      return t.includes(String(value).toLowerCase());
  }
}

// ---------- names ----------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[’‘]/g, "'");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a name as whole words, in normalized text. */
function wholeWords(name: string): RegExp {
  return new RegExp(`(?<!\\w)${escapeRe(normalize(name))}(?!\\w)`, "g");
}

interface Span {
  start: number;
  end: number;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Whether the text names the team by one of its nicknames, as whole words. */
function namesTeam(ctx: Ctx, team: TeamId, text: string): boolean {
  const low = normalize(text);
  return (ctx.input.nicknames[team] ?? []).some((n) => wholeWords(n).test(low));
}

// ---------- units: sentences, with each bullet its own unit ----------

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Sentences of the plain text, each with its offset. A bullet never runs into the next line. */
function units(plain: string): { s: string; start: number }[] {
  const out: { s: string; start: number }[] = [];
  const blocks: { text: string; start: number }[] = [];
  let offset = 0;
  let current: { text: string; start: number } | null = null;
  for (const line of plain.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    if (!line.trim() || BULLET.test(line)) {
      if (current) blocks.push(current);
      current = null;
      if (!line.trim()) continue;
      const bullet = (line.match(BULLET) as RegExpMatchArray)[0].length;
      blocks.push({ text: line.slice(bullet), start: lineStart + bullet });
      continue;
    }
    if (current) current.text += `\n${line}`;
    else current = { text: line, start: lineStart };
  }
  if (current) blocks.push(current);
  const SENTENCE = /(?:\bNo\.\s|[^.!?]|[.!?](?=\S))+[.!?]*/g;
  for (const b of blocks) {
    for (const m of b.text.matchAll(SENTENCE)) {
      if (m[0].trim()) out.push({ s: m[0], start: b.start + m.index });
    }
  }
  return out;
}

// ---------- untagged claim shapes ----------

type Shape =
  | { type: "result"; won: boolean; opponent: TeamId }
  | ({ type: "score" } & ScoreWords)
  | {
      type: "stat";
      /** Evidence IDs the cue points at; empty when nothing says which stat. */
      keys: string[];
      num?: Num;
      hedge?: Hedge;
      record?: string;
      /** An ordinal claim, so a cue-less one is tried against ordinal stats only. */
      ordinal?: boolean;
      /** A score-shaped record, also tried as a score. */
      score?: ScoreWords;
    }
  | { type: "place"; test: (place: number) => boolean; key: string }
  | { type: "move"; by: number | "new" }
  | {
      type: "group";
      label?: string;
      tier?: number;
      /** "top tier" or "bottom tier": the first or last group in the ranking. */
      edge?: "top" | "bottom";
    }
  | {
      type: "playoffs";
      want: "clinched_bye" | "clinched" | "eliminated" | null;
    };

/** A score as written: its two numbers and where the dash sits. */
interface ScoreWords {
  a: Num;
  b: Num;
  split: number;
}

interface Found {
  start: number;
  end: number;
  shape: Shape;
}

const RESULT_VERBS =
  /\b(beat|beats|edged|edges|crushed|crushes|smoked|smokes|took down|takes down|squeaked past|squeaks past|handled|handles|blew out|blows out|outlasted|outlasts|lost to|loses to|fell to|falls to|dropped one to|drops one to)\s+/gi;
const LOSS_VERB = /^(lost|loses|fell|falls|dropped|drops)/;

const ORDINAL_CUES: [RegExp, (w: number) => string][] = [
  [/all[- ]play/, () => "allplay_rank"],
  [/points against|\bpa\b/, () => "pa_rank"],
  [/\bform\b|\blately\b|last (three|3)/, () => "form_rank"],
  [/this week|the week|week[- ]high|week \d/, (w) => `w${w}.rank`],
  [/points|scoring|\bpf\b|scored/, () => "pf_rank"],
  [/standings/, () => "standing"],
  [/\bseed\b/, () => "seed"],
  [/\branked\b|\branking|\bspot\b|\bpower\b/, () => "place"],
];

const NUMBER_CUES: [RegExp, (w: number) => string][] = [
  [
    /\bmargin\b|\bwon by\b|\blost by\b|\bwinning by\b|\blosing by\b/,
    (w) => `w${w}.margin`,
  ],
  [
    /\b(scored|scores|dropped|drops|put up|puts up|posted|posts|poured in|hung|lit up for)\b/,
    (w) => `w${w}.points`,
  ],
  [/\bseason[- ]high\b|(?<!week[- ])\bhigh\b/, () => "high"],
  [/\bseason[- ]low\b|(?<!week[- ])\blow\b/, () => "low"],
  [/\bpoints for\b|\bon the season\b|\bseason total\b|\btotal\b/, () => "pf"],
  [
    /\baverag|\bper week\b|\bper game\b|\blast three\b|\blast 3\b/,
    () => "form3",
  ],
  [/\bpoints against\b|\ballowed\b/, () => "pa"],
  [
    /\bluck|\bunlucky\b|\blucky\b|\bcost (them|him|her)\b|\brobbed\b/,
    () => "luck",
  ],
];

function ordinalKey(ctx: string, week: number): string | null {
  const c = ctx.toLowerCase();
  for (const [cue, key] of ORDINAL_CUES) if (cue.test(c)) return key(week);
  return null;
}

/** The number cue closest to a number: the last one before it, else the first after. */
function nearestCue(
  before: string,
  after: string,
  week: number,
): string | null {
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [cue, key] of NUMBER_CUES) {
    for (const m of before.matchAll(new RegExp(cue.source, "g"))) {
      const d = before.length - (m.index + m[0].length);
      if (d < bestDist) {
        bestDist = d;
        best = key(week);
      }
    }
    // a cue after the number counts only when none comes before it
    const m = after.match(cue);
    if (m && (m.index as number) + 1000 < bestDist) {
      bestDist = (m.index as number) + 1000;
      best = key(week);
    }
  }
  return best;
}

function groupsOf(ctx: Ctx): string[] {
  const labels = new Set<string>();
  for (const o of Object.values(ctx.order)) if (o.group) labels.add(o.group);
  return [...labels];
}

/** The group of the team in first place, or in last. */
function edgeGroup(ctx: Ctx, edge: "top" | "bottom"): string | undefined {
  const places = Object.values(ctx.order).sort((a, b) => a.place - b.place);
  return (edge === "top" ? places[0] : places.at(-1))?.group;
}

/** The numbers a group label carries: "Tier 2" and "Second tier" both carry 2. */
function labelNumber(label: string): number | null {
  const n = firstNum(label);
  return n ? n.num.n : null;
}

const MOVE_VERBS =
  "climbs?|climbed|climbing|rises|rose|rising|jumps?|jumped|jumping|moves? up|moved up|falls?|fell|falling|drops?|dropped|dropping|slides?|slid|sliding|slips?|slipped|tumbles?|tumbled";
const MOVE_DOWN = /^(fall|fell|drop|slid|slip|tumbl|down)/;

function extract(ctx: Ctx, s: string): Found[] {
  const week = ctx.evidence.week;
  const out: Found[] = [];
  const low = s.toLowerCase();
  const add = (start: number, end: number, shape: Shape) =>
    out.push({ start, end, shape });

  // results: a verb, then a team's name
  for (const m of s.matchAll(RESULT_VERBS)) {
    const restStart = m.index + m[0].length;
    const rest = normalize(s.slice(restStart));
    let best: { team: TeamId; len: number } | null = null;
    for (const [team, names] of Object.entries(ctx.input.nicknames)) {
      for (const n of names) {
        const nn = normalize(n);
        if (
          rest.startsWith(nn) &&
          !/\w/.test(rest[nn.length] ?? "") &&
          (!best || nn.length > best.len)
        ) {
          best = { team: team as TeamId, len: nn.length };
        }
      }
    }
    if (best) {
      add(m.index, restStart + best.len, {
        type: "result",
        won: !LOSS_VERB.test((m[1] as string).toLowerCase()),
        opponent: best.team,
      });
    }
  }

  // scores (133.22-78.22) and records (7-1, 7-1-1)
  for (const m of s.matchAll(
    /(?<![\w.])(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+))?(?![\w.]*\d)/g,
  )) {
    const a = parseNum(m[1] as string) as Num;
    const b = parseNum(m[2] as string) as Num;
    const split = (m[0] as string).search(/[-–]/);
    const end = m.index + m[0].length;
    if (a.dp || b.dp) {
      add(m.index, end, { type: "score", a, b, split });
      continue;
    }
    const near = low.slice(Math.max(0, m.index - 20), end + 20);
    add(m.index, end, {
      type: "stat",
      keys: /all[- ]play/.test(near) ? ["allplay"] : ["record", "allplay"],
      record: m[0],
      ...(a.n > 30 && b.n > 30 && !m[3] ? { score: { a, b, split } } : {}),
    });
  }

  // streaks
  for (const m of s.matchAll(
    new RegExp(
      `\\b(?:\\d+|${NUMW}|${ORDW})(?:[- ]games?)?(?: straight| consecutive| in a row)+(?! weeks?\\b)(?:\\s+(?:wins?|losses|loss|games|w's|l's|heater|skid|win(?:ning)? streak|losing streak)\\b)?|\\b(?:\\d+|${NUMW})[- ]game (?:heater|skid|win(?:ning)? streak|losing streak)\\b|\\b(?:\\d+|${NUMW}) (?:wins|losses) in a row\\b`,
      "gi",
    ),
  )) {
    add(m.index, m.index + m[0].length, {
      type: "stat",
      keys: ["streak"],
    });
  }

  // movement
  for (const m of s.matchAll(
    new RegExp(
      `\\b(${MOVE_VERBS}|up|down)\\s+(\\d+|${NUMW})(\\s+(?:spots?|places?))?`,
      "gi",
    ),
  )) {
    const verb = (m[1] as string).toLowerCase();
    const n = parseNum(m[2] as string) as Num;
    const bare = verb === "up" || verb === "down";
    if (!m[3] && !bare) continue;
    if (bare) {
      const after = low.slice(m.index + m[0].length);
      const before = low.slice(0, m.index);
      if (/^\s*(points|pts|wins|losses|on the (year|season))/.test(after))
        continue;
      if (/\b(put|puts|putting|racked|racks)\s*$/.test(before)) continue;
      if (n.n > ctx.teamCount) continue;
    }
    add(m.index, m.index + m[0].length, {
      type: "move",
      by: MOVE_DOWN.test(verb) ? -n.n : n.n,
    });
  }
  for (const m of s.matchAll(
    /\b(?:debuts?|debuted|debuting)\b|\bnew (?:to|in) the rankings\b|\bnew entry\b|\(new\)|(?<=\b(?:is|are|['’]re|['’]s)\s+)new\b(?!\s+(?:high|low|record|career|season))/gi,
  )) {
    add(m.index, m.index + m[0].length, { type: "move", by: "new" });
  }

  // groups: a heading's text, or a tier with a number
  for (const label of groupsOf(ctx)) {
    for (const m of normalize(s).matchAll(wholeWords(label))) {
      add(m.index, m.index + m[0].length, { type: "group", label });
    }
  }
  for (const m of s.matchAll(
    new RegExp(
      `\\b(\\d+(?:st|nd|rd|th)|${ORDW})[- ]tier\\b|\\btier (\\d+|${NUMW})\\b`,
      "gi",
    ),
  )) {
    add(m.index, m.index + m[0].length, {
      type: "group",
      tier: (parseNum((m[1] ?? m[2]) as string) as Num).n,
    });
  }
  for (const m of s.matchAll(/\b(top|bottom)[- ]tier\b/gi)) {
    add(m.index, m.index + m[0].length, {
      type: "group",
      edge: (m[1] as string).toLowerCase() as "top" | "bottom",
    });
  }

  // playoff words
  const PLAYOFFS: [RegExp, Extract<Shape, { type: "playoffs" }>["want"]][] = [
    [
      /\b(?:clinch(?:ed|es|ing)?|locked up|locks up|secured|secures) (?:a |the )?(?:first-round |round-one |playoff )?bye\b/gi,
      "clinched_bye",
    ],
    [
      /\bclinch(?:ed|es|ing)?\b(?: (?:a|their|his|her) (?:playoff )?(?:spot|berth|place))?/gi,
      "clinched",
    ],
    [
      /\b(?:eliminated|mathematically out|out of (?:the )?playoff (?:race|hunt|picture))\b/gi,
      "eliminated",
    ],
    [
      /\bplayoff (?:lock|bound|hopes?)\b|\bin the (?:playoff )?hunt\b|\bon the bubble\b|\bpunch(?:ed|es)? (?:their|a) (?:playoff )?ticket\b/gi,
      null,
    ],
  ];
  for (const [re, want] of PLAYOFFS) {
    for (const m of s.matchAll(re)) {
      add(m.index, m.index + m[0].length, { type: "playoffs", want });
    }
  }

  // place: #N, No. N, top N, bottom N
  for (const m of s.matchAll(
    new RegExp(
      `(?:#|\\bNo\\.\\s?)(\\d+)\\b|\\b(top|bottom) (\\d+|${NUMW})\\b`,
      "gi",
    ),
  )) {
    const after = low.slice(m.index + m[0].length, m.index + m[0].length + 30);
    const key = m[2] ? (ordinalKey(after, week) ?? "place") : "place";
    if (m[1]) {
      const n = Number(m[1]);
      add(m.index, m.index + m[0].length, {
        type: "place",
        key,
        test: (p) => p === n,
      });
    } else {
      const n = (parseNum(m[3] as string) as Num).n;
      const top = (m[2] as string).toLowerCase() === "top";
      const count = ctx.teamCount;
      add(m.index, m.index + m[0].length, {
        type: "place",
        key,
        test: top ? (p) => p <= n : (p) => p > count - n,
      });
    }
  }

  // ordinals: a stat cue picks the stat, a ranking cue picks place
  for (const m of s.matchAll(
    new RegExp(`\\b(\\d+(?:st|nd|rd|th)|${ORDW})\\b`, "gi"),
  )) {
    const word = m[1] as string;
    const after = low.slice(m.index + word.length, m.index + word.length + 30);
    const before = low.slice(Math.max(0, m.index - 30), m.index);
    if (/^[- ](game|straight|consecutive|tier)/.test(after)) continue;
    const num = parseNum(word) as Num;
    const key = ordinalKey(before + after, week);
    const standingWords = /\bin\s*$/.test(before) || /^ place\b/.test(after);
    if (key) {
      add(m.index, m.index + word.length, {
        type: "stat",
        keys: [key],
        num,
        ordinal: true,
      });
    } else if (standingWords) {
      add(m.index, m.index + word.length, {
        type: "stat",
        keys: ["standing", "place"],
        num,
        ordinal: true,
      });
    } else if (/\d/.test(word)) {
      add(m.index, m.index + word.length, {
        type: "stat",
        keys: [],
        num,
        ordinal: true,
      });
    }
  }

  // bare numbers, and "nearly two wins"
  for (const m of s.matchAll(
    new RegExp(
      `(?<![\\w.#])(\\d[\\d,]*(?:\\.\\d+)?)(?![\\w.]*\\d)(?!\\s*(?:st|nd|rd|th)\\b)|\\b(${NUMW}) (wins|losses|points)\\b`,
      "gi",
    ),
  )) {
    const before = low.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(week|wk|w)\s*$/.test(before)) continue;
    const token = (m[1] ?? m[2]) as string;
    if (m[1] && /^(19|20)\d\d$/.test(token)) continue;
    const num = parseNum(token) as Num;
    const tailStart = m.index + m[0].length;
    let key = /\bby\s*$/.test(before)
      ? `w${week}.margin`
      : nearestCue(before, low.slice(tailStart, tailStart + 25), week);
    const hedge = hedgeBefore(before);
    // "nearly two wins" with no other cue is wins above or below expectation
    if (m[2] && !key && hedge) key = "luck";
    const hedgeLen = hedge
      ? (before.match(HEDGE) as RegExpMatchArray)[0].length
      : 0;
    add(m.index - hedgeLen, m.index + m[0].length, {
      type: "stat",
      keys: key ? [key] : [],
      num,
      hedge,
    });
  }

  // a team's own name is never a claim, and the earlier, longer claim wins an overlap
  const names = nameSpans(ctx, s);
  out.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Found[] = [];
  for (const c of out) {
    const inName =
      c.shape.type !== "result" && names.some((n) => overlaps(c, n));
    if (inName) continue;
    if (!kept.some((k) => overlaps(c, k))) kept.push(c);
  }
  return kept;
}

/** Where any team's nickname appears in a sentence. */
function nameSpans(ctx: Ctx, s: string): { start: number; end: number }[] {
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

// ---------- judging ----------

interface Hit {
  team: TeamId | null;
  stat: string;
  /** Sub-span within the claim, for a score's two halves. */
  part?: { start: number; end: number };
}

interface Verdict {
  status: ClaimStatus;
  reason: string;
  hits: Hit[];
}

function teamName(ctx: Ctx, team: TeamId): string {
  return ctx.input.nicknames[team]?.[0] ?? team;
}

function show(ctx: Ctx, r: Resolved): string {
  const who = r.team && r.team !== ctx.input.team ? `${r.team}/` : "";
  const value =
    r.kind === "team" ? teamName(ctx, String(r.value) as TeamId) : r.value;
  return `${who}${r.stat} is ${value}`;
}

function judge(ctx: Ctx, teams: TeamId[], text: string, f: Found): Verdict {
  const week = ctx.evidence.week;
  const shape = f.shape;
  const none = (status: ClaimStatus, reason: string): Verdict => ({
    status,
    reason,
    hits: [],
  });

  if (shape.type === "result") {
    const subjects = teams.filter((t) => t !== shape.opponent);
    const want = shape.won ? "W" : "L";
    for (const t of subjects) {
      const opp = resolve(ctx, `w${week}.opponent`, t);
      const res = resolve(ctx, `w${week}.result`, t);
      if (opp?.value === shape.opponent && res?.value === want) {
        return {
          status: "verified",
          reason: `w${week}.result is ${want} against ${teamName(ctx, shape.opponent)}`,
          hits: [{ team: t, stat: `w${week}.result` }],
        };
      }
    }
    const me = subjects[0];
    if (!me) return none("unchecked", "no team to check this result against");
    const opp = resolve(ctx, `w${week}.opponent`, me);
    const res = resolve(ctx, `w${week}.result`, me);
    if (!opp || !res)
      return none("unchecked", `no week ${week} result in the evidence pack`);
    if (opp.value !== shape.opponent) {
      return none(
        "wrong",
        `w${week}.opponent is ${teamName(ctx, String(opp.value) as TeamId)}`,
      );
    }
    return none("wrong", `w${week}.result is ${res.value}`);
  }

  if (shape.type === "score")
    return judgeScore(ctx, teams, shape, f.end - f.start);

  if (shape.type === "place") {
    const hits: Hit[] = [];
    let first: Resolved | null = null;
    for (const t of teams) {
      const r = resolve(ctx, shape.key, t);
      if (!r || typeof r.value !== "number") continue;
      first ??= r;
      if (shape.test(r.value)) hits.push({ team: t, stat: shape.key });
    }
    if (hits.length)
      return { status: "verified", reason: verifiedReason(ctx, hits), hits };
    if (!first) return none("unchecked", `no ${shape.key} to check against`);
    return none("wrong", show(ctx, first));
  }

  if (shape.type === "move") {
    const t = teams[0];
    const r = t ? resolve(ctx, "move", t) : null;
    if (!t || !r) return none("unchecked", "no movement to check against");
    const ok = r.value === shape.by;
    if (ok)
      return {
        status: "verified",
        reason: verifiedReason(ctx, [{ team: t, stat: "move" }]),
        hits: [{ team: t, stat: "move" }],
      };
    if (r.value === "new")
      return none("wrong", "move is new: the team has no earlier place");
    return none("wrong", show(ctx, r));
  }

  if (shape.type === "group") {
    if (!groupsOf(ctx).length)
      return none("unchecked", "the ranking has no groups");
    const t = teams[0];
    const r = t ? resolve(ctx, "group", t) : null;
    if (!t) return none("unchecked", "no team to check this group against");
    const label = r ? String(r.value) : null;
    const ok =
      label !== null &&
      (shape.label !== undefined
        ? normalize(label) === normalize(shape.label)
        : shape.edge !== undefined
          ? label === edgeGroup(ctx, shape.edge)
          : labelNumber(label) === shape.tier);
    if (ok)
      return {
        status: "verified",
        reason: `group is ${label}`,
        hits: [{ team: t, stat: "group" }],
      };
    return none(
      "wrong",
      label ? `group is ${label}` : "the team isn't in a group",
    );
  }

  if (shape.type === "playoffs") {
    if (shape.want === null) {
      return none(
        "unchecked",
        "a loose playoff phrase; only clinched, a bye or eliminated is checked",
      );
    }
    for (const t of teams) {
      const r = resolve(ctx, "playoffs", t);
      const v = r?.value;
      const ok =
        v === shape.want || (shape.want === "clinched" && v === "clinched_bye");
      if (ok) {
        return {
          status: "verified",
          reason: verifiedReason(ctx, [{ team: t, stat: "playoffs" }]),
          hits: [{ team: t, stat: "playoffs" }],
        };
      }
    }
    const t = teams[0];
    const r = t ? resolve(ctx, "playoffs", t) : null;
    return none(
      "wrong",
      r
        ? show(ctx, r)
        : "no settled playoff status: it still depends on games to come",
    );
  }

  // a stat
  const matches = (r: Resolved): boolean => {
    if (shape.record)
      return r.kind === "record" && agrees(ctx, r, shape.record);
    if (
      shape.num &&
      (r.kind === "number" || r.kind === "luck" || r.kind === "ordinal")
    ) {
      if (typeof r.value !== "number") return false;
      if (r.kind === "ordinal" && (shape.num.dp || shape.hedge)) return false;
      const fact = r.kind === "luck" ? Math.abs(r.value) : r.value;
      return numMatch(shape.num, shape.hedge ?? null, fact);
    }
    if (r.kind === "streak") return agrees(ctx, r, text);
    return false;
  };
  const hitsFor = (keys: string[]): Hit[] => {
    const hits: Hit[] = [];
    for (const t of teams) {
      for (const k of keys) {
        const r = resolve(ctx, k, t);
        if (r && matches(r)) hits.push({ team: t, stat: k });
      }
    }
    return hits;
  };

  if (shape.keys.length) {
    const hits = hitsFor(shape.keys);
    if (hits.length)
      return { status: "verified", reason: verifiedReason(ctx, hits), hits };
    if (shape.score) {
      const v = judgeScore(ctx, teams, shape.score, f.end - f.start);
      if (v.status === "verified") return v;
    }
    const t = teams[0];
    const facts = t
      ? shape.keys
          .map((k) => resolve(ctx, k, t))
          .filter((r): r is Resolved => !!r)
      : [];
    if (!facts.length)
      return none(
        "unchecked",
        `no ${shape.keys.join(" or ")} to check against`,
      );
    return none("wrong", facts.map((r) => show(ctx, r)).join(", "));
  }

  // nothing says which stat: try every stat of the right shape
  const pool = new Set<string>();
  for (const t of teams) {
    for (const [k, v] of Object.entries(ctx.evidence.teams[t] ?? {})) {
      const kind = kindOf(k, v);
      if (
        shape.ordinal
          ? kind === "ordinal"
          : kind === "number" || (kind === "ordinal" && !shape.num?.dp)
      ) {
        pool.add(k);
      }
    }
    if (shape.ordinal && ctx.order[t]) pool.add("place");
  }
  const hits = hitsFor([...pool]);
  if (!shape.ordinal) {
    for (const [k, v] of Object.entries(ctx.evidence.league)) {
      if (
        typeof v === "number" &&
        shape.num &&
        numMatch(shape.num, shape.hedge ?? null, v)
      ) {
        hits.push({ team: null, stat: k });
      }
    }
  }
  if (hits.length) {
    return {
      status: "loose",
      reason: `matches ${verifiedReason(ctx, hits)}, but the sentence doesn't say which stat`,
      hits: [],
    };
  }
  return none("unchecked", "no stat in the evidence pack matches");
}

function judgeScore(
  ctx: Ctx,
  teams: TeamId[],
  shape: ScoreWords,
  length: number,
): Verdict {
  const week = ctx.evidence.week;
  const P = `w${week}.points`;
  const O = `w${week}.opp_points`;
  const first = { start: 0, end: shape.split };
  const second = { start: shape.split + 1, end: length };
  for (const t of teams) {
    const pts = resolve(ctx, P, t)?.value;
    const opp = resolve(ctx, O, t)?.value;
    if (typeof pts !== "number" || typeof opp !== "number") continue;
    if (numMatch(shape.a, null, pts) && numMatch(shape.b, null, opp)) {
      return {
        status: "verified",
        reason: `week ${week} score was ${pts}-${opp}`,
        hits: [
          { team: t, stat: P, part: first },
          { team: t, stat: O, part: second },
        ],
      };
    }
    if (numMatch(shape.a, null, opp) && numMatch(shape.b, null, pts)) {
      return {
        status: "verified",
        reason: `week ${week} score was ${opp}-${pts}, from the opponent's side`,
        hits: [
          { team: t, stat: O, part: first },
          { team: t, stat: P, part: second },
        ],
      };
    }
  }
  const t = teams[0];
  const pts = t ? resolve(ctx, P, t)?.value : undefined;
  const opp = t ? resolve(ctx, O, t)?.value : undefined;
  if (pts === undefined || opp === undefined) {
    return {
      status: "unchecked",
      reason: `no week ${week} score to check against`,
      hits: [],
    };
  }
  return {
    status: "wrong",
    reason: `week ${week} score was ${pts}-${opp}`,
    hits: [],
  };
}

function idFor(ctx: Ctx, hit: Hit): string {
  return hit.team && hit.team !== ctx.input.team
    ? `${hit.team}/${hit.stat}`
    : hit.stat;
}

function verifiedReason(ctx: Ctx, hits: Hit[]): string {
  return hits
    .map((h) => {
      const r = resolve(ctx, h.stat, h.team);
      return r ? show(ctx, r) : idFor(ctx, h);
    })
    .join(", ");
}

// ---------- swearing ----------

const SWEARS =
  /\b(?:(?:mother)?fuck(?:s|ed|er|ers|ing|in|face|wit)?|(?:bull)?shit(?:s|ty|ted|ting|head|show|bag)?|bitch(?:es|y|ing)?|bastards?|assholes?|ass|arse|(?:god)?damn(?:ed|it)?|cunts?|dick(?:s|head|heads)?|cock(?:s|sucker|suckers)?|piss(?:ed|es|ing)?|wtf|stfu)\b/gi;

function swears(ctx: Ctx, plain: string): Swear[] {
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

// ---------- validate ----------

interface Claim {
  text: string;
  /** Plain-text offsets. */
  start: number;
  end: number;
  tag?: Tag;
  /** For an untagged claim: its shape and the teams its sentence names. */
  untagged?: { shape: Found; teams: TeamId[] };
}

function judgeClaim(ctx: Ctx, claim: Claim, section: TeamId | null): Verdict {
  if (claim.tag && claim.tag.kind !== "ev") {
    const { kind, value } = claim.tag;
    return ctx.input.sections[kind].includes(value)
      ? {
          status: "verified",
          reason: `the ${kind} section ${value} exists`,
          hits: [],
        }
      : {
          status: "unknown-id",
          reason: `cites the ${kind} section "${value}", which doesn't exist`,
          hits: [],
        };
  }
  if (claim.tag) {
    const id = claim.tag.value;
    const r = resolve(ctx, id, section);
    if (!r) {
      return {
        status: "unknown-id",
        reason: `cites "${id}", which isn't in the evidence pack`,
        hits: [],
      };
    }
    return agrees(ctx, r, claim.text)
      ? { status: "verified", reason: show(ctx, r), hits: [] }
      : { status: "wrong", reason: show(ctx, r), hits: [] };
  }
  const u = claim.untagged as NonNullable<Claim["untagged"]>;
  return judge(ctx, u.teams, claim.text, u.shape);
}

export function validate(input: ValidatorInput): ValidationResult {
  const ctxFor = (
    evidence: EvidencePack,
    order: Record<TeamId, OrderEvidence>,
  ): Ctx => ({
    input,
    evidence,
    order,
    teamCount: Object.keys(evidence.teams).length,
  });
  const ctx = ctxFor(input.evidence, input.order);
  const { plain, tags, toInput } = unwrap(input.text);
  /** A plain-text span's place in the text as written. */
  const written = (start: number, end: number): Span => ({
    start: toInput[start] as number,
    end: (toInput[end - 1] as number) + 1,
  });

  const found: Claim[] = [];
  for (const tag of tags) {
    found.push({
      text: tag.inner,
      start: tag.plainStart,
      end: tag.plainEnd,
      tag,
    });
  }
  for (const { s, start } of units(plain)) {
    const named = (Object.keys(input.nicknames) as TeamId[]).filter(
      (t) => t !== input.team && namesTeam(ctx, t, s),
    );
    const teams = input.team ? [input.team, ...named] : named;
    for (const f of extract(ctx, s)) {
      const a = start + f.start;
      const b = start + f.end;
      if (tags.some((t) => a < t.plainEnd && t.plainStart < b)) continue;
      found.push({
        text: s.slice(f.start, f.end),
        start: a,
        end: b,
        untagged: { shape: f, teams },
      });
    }
  }
  found.sort((a, b) => a.start - b.start);

  const claims: CheckedClaim[] = [];
  const autoTags: AutoTag[] = [];
  for (const claim of found) {
    let verdict = judgeClaim(ctx, claim, input.team);
    let cause: CheckedClaim["cause"];
    if (verdict.status === "wrong" && input.before) {
      const tries: [Ctx | null, "refresh" | "reorder"][] = [
        [
          input.before.evidence
            ? ctxFor(input.before.evidence, input.order)
            : null,
          "refresh",
        ],
        [
          input.before.order
            ? ctxFor(input.evidence, input.before.order)
            : null,
          "reorder",
        ],
      ];
      for (const [then, why] of tries) {
        if (!then) continue;
        const was = judgeClaim(then, claim, input.team);
        if (was.status === "verified") {
          verdict = {
            status: "stale",
            reason: `true when written (${was.reason}); now ${verdict.reason}`,
            hits: [],
          };
          cause = why;
          break;
        }
      }
    }
    const out: CheckedClaim = {
      text: claim.text,
      ...(claim.tag
        ? { start: claim.tag.start, end: claim.tag.end }
        : written(claim.start, claim.end)),
      tagged: !!claim.tag,
      status: verdict.status,
      reason: verdict.reason,
    };
    if (claim.tag) {
      out.id =
        claim.tag.kind === "ev"
          ? claim.tag.value
          : `${claim.tag.kind}=${claim.tag.value}`;
    }
    if (cause) out.cause = cause;

    const own = verdict.hits.filter((h) => h.team === input.team);
    const hits = own.length && !own.some((h) => h.part) ? own : verdict.hits;
    const single =
      hits.length === 1 || (hits.length === 2 && hits.every((h) => h.part));
    if (!claim.tag && verdict.status === "verified" && single) {
      if (hits.length === 1) out.id = idFor(ctx, hits[0] as Hit);
      for (const h of hits) {
        const from = claim.start + (h.part?.start ?? 0);
        const to = h.part ? claim.start + h.part.end : claim.end;
        const words = plain.slice(from, to);
        autoTags.push({
          ...written(
            from + (words.length - words.trimStart().length),
            to - (words.length - words.trimEnd().length),
          ),
          id: idFor(ctx, h),
        });
      }
    }
    claims.push(out);
  }

  return {
    claims,
    autoTags,
    swears:
      input.swearing === "off"
        ? swears(ctx, plain).map((w) => ({ ...w, ...written(w.start, w.end) }))
        : [],
  };
}

/** The text with each auto-tag added around its words; no word changes. */
export function applyAutoTags(text: string, tags: AutoTag[]): string {
  let out = text;
  for (const t of [...tags].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, t.start)}[${out.slice(t.start, t.end)}]{ev=${t.id}}${out.slice(t.end)}`;
  }
  return out;
}

/** Hard problems block nothing on their own, but publish asks before going ahead. */
export function isHard(status: ClaimStatus): boolean {
  return status === "wrong" || status === "stale" || status === "unknown-id";
}

/**
 * The LLM gate: an LLM draft passes only if every claim is tagged and
 * verified and the word list is clean.
 */
export function gateLlm(result: ValidationResult): {
  pass: boolean;
  claims: CheckedClaim[];
  swears: Swear[];
} {
  const claims = result.claims.filter(
    (c) => !c.tagged || c.status !== "verified",
  );
  return {
    pass: claims.length === 0 && result.swears.length === 0,
    claims,
    swears: result.swears,
  };
}
