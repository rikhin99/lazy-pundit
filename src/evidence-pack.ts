import {
  formatRecord,
  isStarter,
  type League,
  type LineupEntry,
  type MatchupKind,
  type MatchupSide,
  type Result,
  type TeamId,
} from "./league.ts";
import { bestLineupPoints } from "./lineup.ts";
import { playoffStatuses, settledThisWeek } from "./playoff-status.ts";
import { standingsThrough } from "./standings.ts";
import type { EvidencePack, EvidenceValue } from "./validator/types.ts";

/** A matchup decided by less than this many points is a close matchup. */
const CLOSE_MATCHUP = 5;

/** How many of a team's most recent played weeks its form averages. */
const FORM_WEEKS = 3;

/** One week a team played: its side, its opponent's, and its lineup's best. */
interface Played {
  week: number;
  kind: MatchupKind;
  side: MatchupSide;
  opp: MatchupSide;
  /** The week's rank of the team's score among every team that played. */
  rank: number;
  /** All-play wins, losses and ties against every team that played. */
  allplay: WLT;
  /** The starters' points, before any bonus or override. */
  playersPoints: number;
  /** The best possible lineup's points from the same roster. */
  best: number;
}

interface WLT {
  w: number;
  l: number;
  t: number;
}

/**
 * The evidence pack for the ranking week `week`, built from the model only:
 * every scored week up to and including it and the transactions in those
 * weeks. The in-progress week, any later week and draft picks are left out.
 *
 * Weekly stats (`w<N>.…`) cover the ranking week, or a team's last played
 * week when it had no matchup in the ranking week. All-play, form, luck and
 * the lineup stats count only the weeks a team played.
 */
export function buildEvidencePack(league: League, week: number): EvidencePack {
  const played = playedWeeks(league, week);
  const teams: EvidencePack["teams"] = {};
  for (const team of league.teams) teams[team.id] = {};

  seasonStats(league, week, played, teams);
  for (const team of league.teams) {
    const ev = teams[team.id] as Record<string, EvidenceValue>;
    const weeks = played.get(team.id) ?? [];
    const last = weeks.at(-1);
    if (last) weekStats(league, last, ev);
    for (const g of weeks) {
      const override = round(g.side.score - g.playersPoints);
      if (override !== 0) ev[`w${g.week}.override`] = override;
    }
    injuries(league, team.id, ev);
  }
  activity(league, week, played, teams);
  for (const [team, status] of playoffStatuses(league, week)) {
    (teams[team] as Record<string, EvidenceValue>).playoffs = status;
  }

  const items = leagueItems(league, week, played);
  const { clinched, eliminated } = settledThisWeek(league, week);
  if (clinched.length > 0) items["wk.clinched"] = clinched.join(",");
  if (eliminated.length > 0) items["wk.eliminated"] = eliminated.join(",");
  // The platform settings, read from the fetch and never from a pundit's file.
  const { playoffTeams, playoffStartWeek, faabBudget } = league.settings;
  items["platform.playoff_spots"] = playoffTeams;
  items["platform.playoff_start"] = playoffStartWeek;
  if (faabBudget !== null) items["platform.faab_budget"] = faabBudget;

  return { week, teams, league: items };
}

/** Every team's played weeks through `week`, oldest first. */
function playedWeeks(league: League, week: number): Map<TeamId, Played[]> {
  const out = new Map<TeamId, Played[]>(league.teams.map((t) => [t.id, []]));
  for (const w of league.weeks) {
    if (!w.scored || w.week > week) continue;
    const sides = w.matchups.flatMap((m) => [
      { kind: m.kind, side: m.sides[0], opp: m.sides[1] },
      { kind: m.kind, side: m.sides[1], opp: m.sides[0] },
    ]);
    const cents = (s: MatchupSide) => Math.round(s.score * 100);
    for (const { kind, side, opp } of sides) {
      const others = sides.filter((o) => o.side !== side);
      const starters = side.lineup.filter(isStarter);
      out.get(side.team)?.push({
        week: w.week,
        kind,
        side,
        opp,
        rank: 1 + others.filter((o) => cents(o.side) > cents(side)).length,
        allplay: {
          w: others.filter((o) => cents(o.side) < cents(side)).length,
          l: others.filter((o) => cents(o.side) > cents(side)).length,
          t: others.filter((o) => cents(o.side) === cents(side)).length,
        },
        playersPoints: sum(starters.map((e) => e.points)),
        best: bestLineupPoints(
          side.lineup,
          league.settings.lineupSlots,
          league.players,
        ),
      });
    }
  }
  return out;
}

/** Record, standings, all-play, luck, form, points, streak and lineup totals. */
function seasonStats(
  league: League,
  week: number,
  played: Map<TeamId, Played[]>,
  teams: EvidencePack["teams"],
): void {
  const standings = standingsThrough(league, week);
  const anyPlayed = [...played.values()].some((g) => g.length > 0);
  if (!anyPlayed) return;

  const allplay = new Map<TeamId, WLT>();
  const form = new Map<TeamId, number>();
  for (const [team, weeks] of played) {
    if (weeks.length === 0) continue;
    allplay.set(team, total(weeks.map((g) => g.allplay)));
    form.set(
      team,
      round(
        sum(weeks.slice(-FORM_WEEKS).map((g) => g.side.score)) /
          Math.min(FORM_WEEKS, weeks.length),
      ),
    );
  }
  const matchupCount = (s: { wins: number; losses: number; ties: number }) =>
    s.wins + s.losses + s.ties;
  const pfRank = ranks(standings.map((s) => [s.team, s.pointsFor]));
  const paRank = ranks(standings.map((s) => [s.team, s.pointsAgainst]));
  const ppg = new Map(
    standings
      .filter((s) => matchupCount(s) > 0)
      .map((s) => [s.team, round(s.pointsFor / matchupCount(s))] as const),
  );
  const ppgRank = ranks([...ppg]);
  const allplayRank = ranks([...allplay].map(([t, r]) => [t, pct(r)]));
  const formRank = ranks([...form]);

  for (const s of standings) {
    const ev = teams[s.team] as Record<string, EvidenceValue>;
    ev.record = formatRecord(s);
    if (s.rank !== null) ev.standing = s.rank;
    if (s.seed !== null) ev.seed = s.seed;
    ev.pf = s.pointsFor;
    ev.pf_rank = pfRank.get(s.team) as number;
    ev.pa = s.pointsAgainst;
    ev.pa_rank = paRank.get(s.team) as number;
    const pointsPerWeek = ppg.get(s.team);
    if (pointsPerWeek !== undefined) {
      ev.ppg = pointsPerWeek;
      ev.ppg_rank = ppgRank.get(s.team) as number;
    }

    const mine = played.get(s.team) ?? [];
    const ap = allplay.get(s.team);
    if (!ap || mine.length === 0) continue;
    ev.allplay = recordOf(ap);
    ev.allplay_rank = allplayRank.get(s.team) as number;
    // In the losers bracket the lower score advances, so its results say
    // nothing about winning; a two-week round has none until it's decided.
    const decided = mine.filter((g) => g.kind !== "losers" && g.side.result);
    const won = total(decided.map((g) => resultWLT(g.side.result)));
    // Expected wins: each counted week's all-play win rate.
    const expected = decided.reduce((a, g) => a + pct(g.allplay), 0);
    ev.luck = round(won.w + won.t / 2 - expected);
    ev.form3 = form.get(s.team) as number;
    ev.form_rank = formRank.get(s.team) as number;
    const scores = mine.map((g) => g.side.score);
    ev.high = Math.max(...scores);
    ev.low = Math.min(...scores);
    if (decided.length > 0) ev.streak = streak(decided);
    ev.close = recordOf(
      total(
        decided
          .filter((g) => Math.abs(g.side.score - g.opp.score) < CLOSE_MATCHUP)
          .map((g) => resultWLT(g.side.result)),
      ),
    );
    const actual = sum(mine.map((g) => g.playersPoints));
    const best = sum(mine.map((g) => g.best));
    ev.efficiency = percent(actual, best);
    ev.left_on_bench = round(best - actual);
  }
}

/** One played week's stats and player facts, under `w<N>.`. */
function weekStats(
  league: League,
  g: Played,
  ev: Record<string, EvidenceValue>,
): void {
  const w = `w${g.week}`;
  ev[`${w}.points`] = g.side.score;
  ev[`${w}.opp_points`] = g.opp.score;
  ev[`${w}.margin`] = round(Math.abs(g.side.score - g.opp.score));
  if (g.side.result) ev[`${w}.result`] = g.side.result;
  if (g.kind !== "regular") ev[`${w}.bracket`] = g.kind;
  ev[`${w}.opponent`] = g.opp.team;
  ev[`${w}.rank`] = g.rank;
  ev[`${w}.efficiency`] = percent(g.playersPoints, g.best);
  ev[`${w}.left_on_bench`] = round(g.best - g.playersPoints);

  const name = (e: LineupEntry) => league.players[e.player]?.name ?? e.player;
  const top = topStarter(g.side.lineup);
  if (top) {
    ev[`${w}.top`] = name(top);
    ev[`${w}.top_points`] = top.points;
  }
  const zeros = g.side.lineup.filter((e) => isStarter(e) && e.points === 0);
  if (zeros.length > 0) ev[`${w}.zeros`] = list(zeros.map(name));
  const bench = g.side.lineup
    .filter((e) => !isStarter(e))
    .sort((a, b) => b.points - a.points)[0];
  if (bench && g.best > g.playersPoints) {
    ev[`${w}.benchmiss`] = name(bench);
    ev[`${w}.benchmiss_points`] = bench.points;
  }
  const oppTop = topStarter(g.opp.lineup);
  if (oppTop) {
    ev[`${w}.opp.top`] = name(oppTop);
    ev[`${w}.opp.top_points`] = oppTop.points;
  }
}

/** The team's injured players now, starters and bench (not IR or taxi). */
function injuries(
  league: League,
  team: TeamId,
  ev: Record<string, EvidenceValue>,
): void {
  const hurt = injuredPlayers(league, team);
  ev.injuries = hurt.length;
  if (hurt.length > 0) ev.injured = list(hurt.map((p) => p.name));
}

export function injuredPlayers(league: League, team: TeamId) {
  const roster = league.teams.find((t) => t.id === team)?.roster ?? [];
  return roster
    .filter((r) => r.status === "starter" || r.status === "bench")
    .map((r) => league.players[r.player])
    .filter((p) => p?.injuryStatus != null)
    .map((p) => p as NonNullable<typeof p>);
}

/**
 * Trades, adds, drops and FAAB: season to date, and for the ranking week.
 * Each trade lists what the team got and gave and the points those players
 * have scored as starters for their new team since. Draft picks are left out.
 */
function activity(
  league: League,
  week: number,
  played: Map<TeamId, Played[]>,
  teams: EvidencePack["teams"],
): void {
  const budget = league.settings.faabBudget;
  const name = (p: string) => league.players[p]?.name ?? p;
  /** Points `player` scored as a starter for `team` from `from` on. */
  const startedFor = (team: TeamId, player: string, from: number) =>
    sum(
      (played.get(team) ?? [])
        .filter((g) => g.week >= from)
        .flatMap((g) =>
          g.side.lineup.filter((e) => e.player === player && isStarter(e)),
        )
        .map((e) => e.points),
    );

  for (const team of league.teams) {
    const ev = teams[team.id] as Record<string, EvidenceValue>;
    const count = { trades: 0, adds: 0, drops: 0, faab: 0 };
    const thisWeek = { trades: 0, adds: 0, drops: 0, faab: 0 };
    let faabTraded = 0;
    for (const t of league.transactions) {
      if (t.week > week) continue;
      const bump = (k: keyof typeof count, n: number) => {
        count[k] += n;
        if (t.week === week) thisWeek[k] += n;
      };
      if (t.kind === "trade") {
        if (!t.teams.includes(team.id)) continue;
        bump("trades", 1);
        const k = `trade.${count.trades}`;
        const got = t.adds.filter((a) => a.team === team.id);
        const gave = t.adds.filter(
          (a) =>
            a.team !== team.id &&
            t.drops.some((d) => d.player === a.player && d.team === team.id),
        );
        const partners = t.teams.filter((x) => x !== team.id);
        ev[`${k}.week`] = t.week;
        if (partners.length === 1) ev[`${k}.with`] = partners[0] as TeamId;
        if (got.length > 0)
          ev[`${k}.got`] = list(got.map((a) => name(a.player)));
        if (gave.length > 0) {
          ev[`${k}.gave`] = list(gave.map((a) => name(a.player)));
        }
        ev[`${k}.got_points`] = round(
          sum(got.map((a) => startedFor(team.id, a.player, t.week))),
        );
        ev[`${k}.gave_points`] = round(
          sum(gave.map((a) => startedFor(a.team, a.player, t.week))),
        );
        for (const f of t.faab) {
          if (f.to === team.id) faabTraded += f.amount;
          if (f.from === team.id) faabTraded -= f.amount;
        }
        continue;
      }
      if (t.team !== team.id) continue;
      bump("adds", t.adds.filter((a) => a.team === team.id).length);
      bump("drops", t.drops.filter((d) => d.team === team.id).length);
      if (t.faabBid) bump("faab", t.faabBid);
    }
    ev.trades = count.trades;
    ev.adds = count.adds;
    ev.drops = count.drops;
    if (budget !== null) {
      ev.faab = count.faab;
      ev.faab_left = budget - count.faab + faabTraded;
    }
    for (const k of ["trades", "adds", "drops", "faab"] as const) {
      if (k === "faab" && budget === null) continue;
      if (thisWeek[k] > 0) ev[`w${week}.${k}`] = thisWeek[k];
    }
  }
}

/**
 * The ranking week's league-wide items: high and low scores, the biggest and
 * smallest winning margins, the upset (the winner with the worse all-play
 * rank going into the week) and the highest score in a loss. Each names its
 * team under a `_team` ID (for an upset, the loser under `wk.upset_over`).
 * Winning and losing here go by score, whatever the bracket's result: in a
 * losers bracket the lower score advances.
 */
function leagueItems(
  league: League,
  week: number,
  played: Map<TeamId, Played[]>,
): Record<string, EvidenceValue> {
  const out: Record<string, EvidenceValue> = {};
  const matchups = [...played.values()]
    .flat()
    .filter((g) => g.week === week)
    .sort((a, b) =>
      a.side.team.localeCompare(b.side.team, "en", { numeric: true }),
    );
  if (matchups.length === 0) return out;

  const byScore = [...matchups].sort((a, b) => b.side.score - a.side.score);
  const high = byScore[0] as Played;
  const low = byScore.at(-1) as Played;
  out["wk.high"] = high.side.score;
  out["wk.high_team"] = high.side.team;
  out["wk.low"] = low.side.score;
  out["wk.low_team"] = low.side.team;

  const wins = matchups
    .filter((g) => g.side.score > g.opp.score)
    .map((g) => ({ g, margin: round(g.side.score - g.opp.score) }))
    .sort((a, b) => b.margin - a.margin);
  const widest = wins[0];
  const closest = wins.at(-1);
  if (widest && closest) {
    out["wk.margin_max"] = widest.margin;
    out["wk.margin_max_team"] = widest.g.side.team;
    out["wk.margin_min"] = closest.margin;
    out["wk.margin_min_team"] = closest.g.side.team;
  }

  const before = playedWeeks(league, week - 1);
  const rankBefore = ranks(
    [...before]
      .filter(([, gs]) => gs.length > 0)
      .map(([t, gs]) => [t, pct(total(gs.map((g) => g.allplay)))]),
  );
  const upsets = wins
    .map(({ g }) => ({
      g,
      gap:
        (rankBefore.get(g.side.team) ?? 0) - (rankBefore.get(g.opp.team) ?? 0),
    }))
    .filter(
      (u) =>
        rankBefore.has(u.g.side.team) &&
        rankBefore.has(u.g.opp.team) &&
        u.gap > 0,
    )
    .sort((a, b) => b.gap - a.gap);
  const upset = upsets[0];
  if (upset) {
    out["wk.upset"] = upset.g.side.team;
    out["wk.upset_over"] = upset.g.opp.team;
  }

  const robbed = byScore.find((g) => g.side.score < g.opp.score);
  if (robbed) {
    out["wk.robbed"] = robbed.side.team;
    out["wk.robbed_points"] = robbed.side.score;
  }
  return out;
}

// ---------- helpers ----------

function topStarter(lineup: LineupEntry[]): LineupEntry | undefined {
  return lineup
    .filter(isStarter)
    .reduce<LineupEntry | undefined>(
      (best, e) => (!best || e.points > best.points ? e : best),
      undefined,
    );
}

/** The current run of one result, such as `W3`, from the latest week back. */
function streak(matchups: Played[]): string {
  const results = matchups.map((g) => g.side.result).filter((r) => r);
  const last = results.at(-1);
  if (!last) return "";
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
  return `${last}${n}`;
}

function resultWLT(r: Result | undefined): WLT {
  return { w: r === "W" ? 1 : 0, l: r === "L" ? 1 : 0, t: r === "T" ? 1 : 0 };
}

function total(xs: WLT[]): WLT {
  return xs.reduce((a, b) => ({ w: a.w + b.w, l: a.l + b.l, t: a.t + b.t }), {
    w: 0,
    l: 0,
    t: 0,
  });
}

function pct(r: WLT): number {
  const n = r.w + r.l + r.t;
  return n === 0 ? 0 : (r.w + r.t / 2) / n;
}

function recordOf(r: WLT): string {
  return formatRecord({
    wins: r.w,
    losses: r.l,
    ties: r.t,
    pointsFor: 0,
    pointsAgainst: 0,
  });
}

/** Competition ranks, highest value first: tied teams share the better rank. */
export function ranks(values: [TeamId, number][]): Map<TeamId, number> {
  return new Map(
    values.map(([t, v]) => [t, 1 + values.filter(([, o]) => o > v).length]),
  );
}

/** A percentage to one decimal place. */
function percent(part: number, whole: number): number {
  return whole === 0 ? 100 : Math.round((part / whole) * 1000) / 10;
}

/** Sums points in cents, so the total doesn't drift. */
function sum(xs: number[]): number {
  return xs.reduce((a, x) => a + Math.round(x * 100), 0) / 100;
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

/** "A", "A and B", "A, B and C". */
export function list(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
