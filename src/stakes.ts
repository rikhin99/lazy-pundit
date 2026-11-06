import { list } from "./evidence-pack.ts";
import { isStarter, type League, type TeamId } from "./league.ts";
import { bestLineupPoints } from "./lineup.ts";
import { standingsThrough } from "./standings.ts";
import type { EvidenceValue } from "./validator/types.ts";

/**
 * A season's stakes as `league.md` records them: unrecorded (no file, no
 * stakes fields, or a placeholder), bragging rights only (`stakes: none`),
 * or the recorded fields.
 */
export type Stakes = { kind: "unrecorded" } | { kind: "none" } | RecordedStakes;

export interface RecordedStakes {
  kind: "recorded";
  /** Dollars per team, if recorded. */
  buyIn?: number;
  /** By final place, first place first. */
  payouts: Payout[];
  /** What a `last-place` trigger reads. */
  lastPlace: "standings" | "losers-bracket";
  houseRules: HouseRule[];
}

/** One final place's payout: dollars, or a share of the pot in percent. */
export type Payout = { dollars: number } | { share: number };

/** Every trigger the tool can work out, as `league.md` names it. */
export const TRIGGER_KINDS = [
  "high-score",
  "low-score",
  "most-left-on-bench",
  "last-place",
  "champion",
] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface HouseRule {
  id: string;
  name: string;
  trigger?: { kind: TriggerKind; per: "week" | "season" };
  outcome: Outcome;
  /** The first week the rule applies to. */
  from?: number;
  /** The last week the rule applies to. */
  until?: number;
}

/** A house rule's outcome, as written: dollars, FAAB, or anything in words. */
export type Outcome =
  | { kind: "dollars"; amount: number; text: string }
  | { kind: "faab"; amount: number; text: string }
  | { kind: "text"; text: string };

export const UNRECORDED: Stakes = { kind: "unrecorded" };

/** What the stakes add to the evidence pack for the ranking week. */
export interface StakesEvidence {
  league: Record<string, EvidenceValue>;
  teams: Record<TeamId, Record<string, EvidenceValue>>;
}

/** One week's (or the season's) trigger winners, team order as the league lists them. */
interface Triggered {
  /** The week the winners were decided in. */
  week: number;
  winners: TeamId[];
}

/**
 * The pot, each place's payout, and each computable house rule's trigger
 * winners for the ranking week (`wk.rule.<id>`), with every team's count and
 * winnings to date (`rule.<id>.count`, `rule.<id>.winnings`).
 */
export function stakesEvidence(
  stakes: Stakes,
  league: League,
  week: number,
): StakesEvidence {
  const out: StakesEvidence = { league: {}, teams: {} };
  if (stakes.kind !== "recorded") return out;
  const pot =
    stakes.buyIn === undefined ? undefined : stakes.buyIn * league.teams.length;
  if (pot !== undefined) out.league["stakes.pot"] = pot;
  stakes.payouts.forEach((p, i) => {
    const amount =
      "dollars" in p
        ? p.dollars
        : pot === undefined
          ? undefined
          : round((pot * p.share) / 100);
    if (amount !== undefined) out.league[`stakes.payout_${i + 1}`] = amount;
  });
  for (const team of league.teams) out.teams[team.id] = {};
  for (const rule of stakes.houseRules) {
    const triggered = triggersThrough(stakes, rule, league, week);
    if (!triggered) continue;
    const now = triggered.find((t) => t.week === week);
    if (now) out.league[`wk.rule.${rule.id}`] = now.winners.join(",");
    for (const team of league.teams) {
      const count = triggered.filter((t) => t.winners.includes(team.id)).length;
      const ev = out.teams[team.id] as Record<string, EvidenceValue>;
      ev[`rule.${rule.id}.count`] = count;
      if (rule.outcome.kind !== "text") {
        ev[`rule.${rule.id}.winnings`] = round(count * rule.outcome.amount);
      }
    }
  }
  return out;
}

/** The warnings the stakes load with against the league: triggers to log by hand. */
export function stakesWarnings(stakes: Stakes, league: League): string[] {
  if (stakes.kind !== "recorded") return [];
  return stakes.houseRules
    .filter((r) => r.trigger && !computable(stakes, r, league))
    .map(
      (r) =>
        `league.md: ${r.name} (${r.id}) has a trigger the platform data can't work out, so it has no winner: log it by hand.`,
    );
}

/** Each house rule's outcome by ID, for a draft to record, or none without house rules. */
export function houseRuleOutcomes(
  stakes: Stakes,
): Record<string, string> | undefined {
  if (stakes.kind !== "recorded" || stakes.houseRules.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    stakes.houseRules.map((r) => [r.id, r.outcome.text]),
  );
}

/**
 * A warning for each dollar or FAAB outcome changed in place since the
 * outcomes `earlier` recorded at `week`: winnings to date count the new
 * outcome for every week.
 */
export function changedOutcomeWarnings(
  stakes: Stakes,
  earlier: Record<string, string> | undefined,
  week: number,
): string[] {
  if (stakes.kind !== "recorded" || !earlier) return [];
  return stakes.houseRules.flatMap((r) => {
    const was = earlier[r.id];
    if (was === undefined || was === r.outcome.text) return [];
    // A rule that starts after that week is a split, not a change in place.
    if (r.from !== undefined && r.from > week) return [];
    if (r.outcome.kind === "text") return [];
    const now = r.outcome.text;
    return [
      `league.md: ${r.name} (${r.id}) pays ${now}, not the ${was} it paid at week ${week}: winnings to date count ${now} for every week. To keep ${was} for earlier weeks, split the rule with until: and from:.`,
    ];
  });
}

/** One house rule's trigger winners that changed between two leagues' data. */
export interface TriggerWinnerChange {
  rule: HouseRule;
  week: number;
  from: TeamId[];
  to: TeamId[];
}

/** The trigger winners that differ from `old` to `next` through `throughWeek`. */
export function triggerWinnerChanges(
  stakes: Stakes,
  old: League,
  next: League,
  throughWeek: number,
): TriggerWinnerChange[] {
  if (stakes.kind !== "recorded") return [];
  const changes: TriggerWinnerChange[] = [];
  for (const rule of stakes.houseRules) {
    const a = triggersThrough(stakes, rule, old, throughWeek) ?? [];
    const b = triggersThrough(stakes, rule, next, throughWeek) ?? [];
    const weeks = new Set([...a, ...b].map((t) => t.week));
    for (const week of [...weeks].sort((x, y) => x - y)) {
      const from = a.find((t) => t.week === week)?.winners ?? [];
      const to = b.find((t) => t.week === week)?.winners ?? [];
      if (from.join() !== to.join()) changes.push({ rule, week, from, to });
    }
  }
  return changes;
}

/**
 * The stat line's part for a team's trigger this week: `[Weekly high
 * score]{ev=wk.rule.high-score} ([2]{ev=rule.high-score.count} this season) ·
 * [$20]{ev=rule.high-score.winnings} to date`, with ", tied with …" inside the
 * first tag for a tie, and the winnings only when the outcome is dollars or FAAB.
 */
export function triggerParts(
  stakes: Stakes,
  team: TeamId,
  league: Record<string, EvidenceValue>,
  ev: Record<string, EvidenceValue>,
  names: Map<TeamId, string>,
): string[] {
  if (stakes.kind !== "recorded") return [];
  const parts: string[] = [];
  for (const rule of stakes.houseRules) {
    const id = `wk.rule.${rule.id}`;
    const winners = String(league[id] ?? "").split(",");
    if (!winners.includes(team)) continue;
    const others = winners
      .filter((t) => t !== team)
      .map((t) => names.get(t as TeamId) ?? t);
    const tied = others.length > 0 ? `, tied with ${list(others)}` : "";
    // A rule split with from: counts only its own weeks.
    const span = rule.from ? `since week ${rule.from}` : "this season";
    let part = `[${rule.name}${tied}]{ev=${id}} ([${ev[`rule.${rule.id}.count`]}]{ev=rule.${rule.id}.count} ${span})`;
    if (rule.outcome.kind !== "text") {
      part += ` · [${amount(rule.outcome, ev[`rule.${rule.id}.winnings`] as number)}]{ev=rule.${rule.id}.winnings} to date`;
    }
    parts.push(part);
  }
  return parts;
}

/** The league stat line's part for each trigger this week: `[Weekly high score: Gus Bus]{ev=wk.rule.high-score}`. */
export function leagueTriggerParts(
  stakes: Stakes,
  league: Record<string, EvidenceValue>,
  names: Map<TeamId, string>,
): string[] {
  if (stakes.kind !== "recorded") return [];
  return stakes.houseRules.flatMap((rule) => {
    const id = `wk.rule.${rule.id}`;
    if (league[id] === undefined) return [];
    const teams = String(league[id]).split(",") as TeamId[];
    return [
      `[${rule.name}: ${list(teams.map((t) => names.get(t) ?? t))}]{ev=${id}}`,
    ];
  });
}

/** An amount in the outcome's unit: `$20` or `10 FAAB`. */
function amount(outcome: Outcome, n: number): string {
  return outcome.kind === "faab" ? `${n} FAAB` : `$${n}`;
}

/** Whether the platform data can work out a rule's trigger. */
function computable(
  stakes: RecordedStakes,
  rule: HouseRule,
  league: League,
): boolean {
  if (rule.trigger?.kind !== "last-place") return true;
  // The model doesn't carry which losers-bracket matchup decides last place.
  return stakes.lastPlace === "standings" && league.settings.divisions === 0;
}

/**
 * Every period's trigger winners for a rule through `week`, or null when the
 * rule has no trigger the data can work out. A week counts once it's scored,
 * from `from` (default week 1) to `until` (default the last regular-season week).
 */
function triggersThrough(
  stakes: RecordedStakes,
  rule: HouseRule,
  league: League,
  week: number,
): Triggered[] | null {
  const trigger = rule.trigger;
  if (!trigger || !computable(stakes, rule, league)) return null;
  const first = rule.from ?? 1;
  const last = rule.until ?? league.settings.regularSeasonWeeks;
  const scored = league.weeks.filter(
    (w) =>
      w.scored &&
      w.week <= week &&
      w.week <= league.lastScoredWeek &&
      w.week >= first &&
      w.week <= last,
  );
  if (trigger.kind === "last-place") {
    const end = league.settings.regularSeasonWeeks;
    if (week < end || league.lastScoredWeek < end) return [];
    const standings = standingsThrough(league, end);
    const bottom = Math.max(...standings.map((s) => s.rank ?? 0));
    const winners = standings
      .filter((s) => s.rank === bottom)
      .map((s) => s.team);
    return [{ week: end, winners: inLeagueOrder(league, winners) }];
  }
  if (trigger.kind === "champion") return champion(league, week);
  const perWeek = scored.map((w) => ({
    week: w.week,
    scores: weekScores(league, w.week, trigger.kind),
  }));
  if (trigger.per === "week") {
    return perWeek.map(({ week, scores }) => ({
      week,
      winners: best(league, scores, trigger.kind),
    }));
  }
  // Per season: the season's single best week, decided once its last week is scored.
  if (week < last || league.lastScoredWeek < last) return [];
  const all = perWeek.flatMap((w) => w.scores);
  return [{ week: last, winners: best(league, all, trigger.kind) }];
}

/** Each team's number for a score trigger in one week, in cents. */
function weekScores(
  league: League,
  week: number,
  kind: TriggerKind,
): [TeamId, number][] {
  const w = league.weeks.find((x) => x.week === week);
  if (!w) return [];
  return w.matchups.flatMap((m) =>
    m.sides.map((side): [TeamId, number] => {
      if (kind !== "most-left-on-bench") {
        return [side.team, Math.round(side.score * 100)];
      }
      const scored = side.lineup
        .filter(isStarter)
        .reduce((a, e) => a + e.points, 0);
      const bestPoints = bestLineupPoints(
        side.lineup,
        league.settings.lineupSlots,
        league.players,
      );
      return [side.team, Math.round((bestPoints - scored) * 100)];
    }),
  );
}

/** The teams with the trigger's best number: highest, or lowest for a low score. */
function best(
  league: League,
  scores: [TeamId, number][],
  kind: TriggerKind,
): TeamId[] {
  if (scores.length === 0) return [];
  const values = scores.map(([, v]) => v);
  const target =
    kind === "low-score" ? Math.min(...values) : Math.max(...values);
  return inLeagueOrder(
    league,
    scores.filter(([, v]) => v === target).map(([t]) => t),
  );
}

/** The champion: the winner of the winners bracket's last round, once it has a result. */
function champion(league: League, week: number): Triggered[] {
  const rounds = Math.ceil(
    Math.log2(Math.max(2, league.settings.playoffTeams)),
  );
  for (const w of league.weeks) {
    if (!w.scored || w.week > week) continue;
    for (const m of w.matchups) {
      if (m.kind !== "winners" || m.round !== rounds) continue;
      const won = m.sides.find((s) => s.result === "W");
      if (won) return [{ week: w.week, winners: [won.team] }];
    }
  }
  return [];
}

function inLeagueOrder(league: League, teams: TeamId[]): TeamId[] {
  return league.teams.map((t) => t.id).filter((id) => teams.includes(id));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
