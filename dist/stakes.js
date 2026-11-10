import { list } from "./evidence-pack.js";
import { isStarter, teamsOfAccounts, } from "./league.js";
import { bestLineupPoints } from "./lineup.js";
import { standingsThrough } from "./standings.js";
/** Every trigger the tool can work out, as `league.md` names it. */
export const TRIGGER_KINDS = [
    "high-score",
    "low-score",
    "most-left-on-bench",
    "last-place",
    "champion",
];
export const UNRECORDED = { kind: "unrecorded" };
/**
 * The pot, each place's payout, and each computable house rule's trigger
 * winners for the ranking week (`wk.rule.<id>`), with every team's count and
 * winnings to date (`rule.<id>.count`, `rule.<id>.winnings`).
 */
export function stakesEvidence(stakes, league, week) {
    const out = { league: {}, teams: {} };
    if (stakes.kind !== "recorded")
        return out;
    const pot = stakes.buyIn === undefined ? undefined : stakes.buyIn * league.teams.length;
    if (pot !== undefined)
        out.league["stakes.pot"] = pot;
    stakes.payouts.forEach((p, i) => {
        const amount = "dollars" in p
            ? p.dollars
            : pot === undefined
                ? undefined
                : round((pot * p.share) / 100);
        if (amount !== undefined)
            out.league[`stakes.payout_${i + 1}`] = amount;
    });
    for (const team of league.teams)
        out.teams[team.id] = {};
    for (const rule of stakes.houseRules) {
        const triggered = triggersThrough(stakes, rule, league, week);
        if (!triggered)
            continue;
        const now = triggered.find((t) => t.week === week);
        if (now)
            out.league[`wk.rule.${rule.id}`] = now.winners.join(",");
        for (const team of league.teams) {
            const count = triggered.filter((t) => t.winners.includes(team.id)).length;
            const ev = out.teams[team.id];
            ev[`rule.${rule.id}.count`] = count;
            if (rule.outcome.kind !== "text") {
                ev[`rule.${rule.id}.winnings`] = round(count * rule.outcome.amount);
            }
        }
    }
    for (const { week: w, pairs } of stakes.rivalryWeeks) {
        if (w !== week && w !== week + 1)
            continue;
        const id = w === week ? "rival" : "next_rival";
        pairs.forEach(([a, b], i) => {
            const rivals = rivalsIn(league, w, a, b);
            if (!rivals)
                return;
            const [x, y] = rivals;
            out.teams[x][id] = y;
            out.teams[y][id] = x;
            if (w !== week)
                return;
            // Numbered by the pair's place in league.md, so a pair that isn't one
            // doesn't renumber the others.
            const pair = `wk.rivalry.${i + 1}`;
            out.league[pair] = inLeagueOrder(league, rivals).join(",");
            const winner = rivalryWinner(league, w, x, y);
            if (winner)
                out.league[`${pair}.winner`] = winner;
        });
    }
    return out;
}
/** Who won a rivalry's matchup in a scored week; none for a tie. */
function rivalryWinner(league, week, x, y) {
    const sides = scheduleOf(league, week)
        ?.find((m) => m.sides.some((s) => s.team === x))
        ?.sides.filter((s) => s.team === x || s.team === y);
    if (sides?.length !== 2)
        return undefined;
    const [p, q] = sides;
    if (p.score === q.score)
        return undefined;
    return p.score > q.score ? p.team : q.team;
}
/** A week's matchups, or undefined before the schedule holds them. */
function scheduleOf(league, week) {
    const matchups = league.weeks.find((w) => w.week === week)?.matchups;
    return matchups && matchups.length > 0 ? matchups : undefined;
}
export function sentStakes(stakes, league, week) {
    if (stakes.kind !== "recorded")
        return stakes;
    return {
        kind: "recorded",
        ...(stakes.buyIn === undefined ? {} : { buyIn: stakes.buyIn }),
        payouts: stakes.payouts.map((p) => "dollars" in p ? `$${p.dollars}` : `${p.share}%`),
        houseRules: stakes.houseRules.map((r) => ({
            ...r,
            outcome: r.outcome.text,
        })),
        rivalryWeeks: stakes.rivalryWeeks.flatMap(({ week: w, pairs }) => {
            const sent = pairs.flatMap(([a, b]) => {
                const rivals = rivalsIn(league, w, a, b);
                return rivals ? [rivals] : [];
            });
            return sent.length > 0 ? [{ week: w, pairs: sent }] : [];
        }),
        sections: stakes.sections,
        log: sentLog(stakes.log, week),
    };
}
/**
 * What `{stakes=…}` and `{log=…}` may cite: each stakes section and house
 * rule by name, and each week `log` has an entry for, as `w<N>`. Pass a sent
 * stakes' Log to hold the LLM to what it was sent.
 */
export function stakesSectionNames(stakes) {
    if (stakes.kind !== "recorded")
        return { stakes: [], log: [] };
    return {
        stakes: [
            ...stakes.sections.map((s) => s.name),
            ...stakes.houseRules.map((r) => r.id),
        ],
        log: [...new Set(stakes.log.map((e) => `w${e.week}`))],
    };
}
/** The Log entries a draft of `week` may send: that week's and last week's, and pinned ones. */
export function sentLog(log, week) {
    return log.filter((e) => e.pinned || e.week === week || e.week === week - 1);
}
/** The teams in this league a rivalry's handle runs, through its linked accounts. */
function teamsOfRival(league, rival) {
    return teamsOfAccounts(league, rival.accounts);
}
/**
 * A rivalry's two teams in `week`: the matchup between them when the
 * schedule holds that week, or, before it does, each handle's one team.
 * None when a handle has no team or the schedule doesn't pair them.
 */
function rivalsIn(league, week, a, b) {
    const as = teamsOfRival(league, a);
    const bs = teamsOfRival(league, b);
    const scheduled = scheduleOf(league, week);
    if (!scheduled) {
        const [x] = as;
        const [y] = bs;
        return as.length === 1 && bs.length === 1 && x !== y && x && y
            ? [x, y]
            : undefined;
    }
    for (const m of scheduled) {
        const teams = m.sides.map((s) => s.team);
        const x = teams.find((t) => as.includes(t));
        const y = teams.find((t) => bs.includes(t) && t !== x);
        if (x && y)
            return [x, y];
    }
    return undefined;
}
/** Why a rivalry week's pair isn't a rivalry, or undefined when it is or can't be told yet. */
function rivalryWarning(league, week, a, b) {
    const [team] = teamsOfRival(league, a);
    for (const r of [a, b]) {
        if (teamsOfRival(league, r).length === 0) {
            return `league.md: rivalry week ${week} names ${r.handle}, whom workspace.md's handles link to no team in this league, so it's no rivalry: link the handle, or fix the pair.`;
        }
    }
    const scheduled = scheduleOf(league, week);
    if (!scheduled || !team || rivalsIn(league, week, a, b))
        return undefined;
    const name = (t) => league.teams.find((x) => x.id === t)?.name ?? t;
    const opponent = scheduled
        .map((m) => m.sides.map((s) => s.team))
        .find((teams) => teams.includes(team))
        ?.find((t) => t !== team);
    const plays = opponent
        ? `${name(team)} plays ${name(opponent)} that week`
        : `${name(team)} has no matchup that week`;
    return `league.md: rivalry week ${week} pairs ${a.handle} and ${b.handle}, but the schedule doesn't: ${plays}.`;
}
/**
 * The warnings the stakes load with against the league: triggers to log by
 * hand, and rivalry pairs that name a handle with no team or that the
 * schedule doesn't pair.
 */
export function stakesWarnings(stakes, league) {
    if (stakes.kind !== "recorded")
        return [];
    return [
        ...stakes.houseRules
            .filter((r) => r.trigger && !computable(stakes, r, league))
            .map((r) => `league.md: ${r.name} (${r.id}) has a trigger the platform data can't work out, so it has no winner: log it by hand.`),
        ...stakes.rivalryWeeks.flatMap(({ week, pairs }) => pairs.flatMap(([a, b]) => rivalryWarning(league, week, a, b) ?? [])),
    ];
}
/** Each house rule's outcome by ID, for a draft to record, or none without house rules. */
export function houseRuleOutcomes(stakes) {
    if (stakes.kind !== "recorded" || stakes.houseRules.length === 0) {
        return undefined;
    }
    return Object.fromEntries(stakes.houseRules.map((r) => [r.id, r.outcome.text]));
}
/**
 * A warning for each dollar or FAAB outcome changed in place since the
 * outcomes `earlier` recorded at `week`: winnings to date count the new
 * outcome for every week.
 */
function changedOutcomeWarnings(stakes, earlier, week) {
    if (stakes.kind !== "recorded" || !earlier)
        return [];
    return stakes.houseRules.flatMap((r) => {
        const was = earlier[r.id];
        if (was === undefined || was === r.outcome.text)
            return [];
        // A rule that starts after that week is a split, not a change in place.
        if (r.from !== undefined && r.from > week)
            return [];
        if (r.outcome.kind === "text")
            return [];
        const now = r.outcome.text;
        return [
            `league.md: ${r.name} (${r.id}) pays ${now}, not the ${was} it paid at week ${week}: winnings to date count ${now} for every week. To keep ${was} for earlier weeks, split the rule with until: and from:.`,
        ];
    });
}
/** The Log entries for `week` and earlier, for a frozen copy of `week` to record. */
export function logRecord(stakes, week) {
    if (stakes.kind !== "recorded")
        return [];
    return stakes.log
        .filter((e) => e.week <= week)
        .map((e) => ({
        week: e.week,
        ...(e.rule !== undefined && { rule: e.rule }),
        text: e.text,
    }));
}
/**
 * What loading `league.md` says against the last published week's frozen
 * copy: the changed-outcome warnings, then a Log-edit warning for each Log
 * entry it recorded that's no longer in the Log as it was. Pinning an entry
 * later, or appending one, changes nothing it recorded. None before the first
 * publish, and no Log-edit warning from a frozen copy with no Log record.
 */
export function leagueFileChangeWarnings(stakes, published) {
    if (!published)
        return [];
    const { week, meta } = published;
    // Each entry in the Log now matches at most one recorded entry.
    const now = logRecord(stakes, Number.POSITIVE_INFINITY).map(logKey);
    const gone = (meta.log_entries ?? []).filter((e) => {
        const at = now.indexOf(logKey(e));
        if (at < 0)
            return true;
        now.splice(at, 1);
        return false;
    });
    return [
        ...changedOutcomeWarnings(stakes, meta.house_rule_outcomes, week),
        ...gone.map((e) => `league.md: the Log entry {week=${e.week}}${e.rule === undefined ? "" : `{rule=${e.rule}}`} "${e.text}" was changed or removed after week ${week} was published, so what that week could cite no longer stands as it was. The Log is only appended to: put the entry back as it was and write any change as a new entry, or publish to record the Log as it now stands.`),
    ];
}
function logKey(e) {
    return JSON.stringify([e.week, e.rule ?? null, e.text]);
}
/** The trigger winners that differ from `old` to `next` through `throughWeek`. */
export function triggerWinnerChanges(stakes, old, next, throughWeek) {
    if (stakes.kind !== "recorded")
        return [];
    const changes = [];
    for (const rule of stakes.houseRules) {
        const a = triggersThrough(stakes, rule, old, throughWeek) ?? [];
        const b = triggersThrough(stakes, rule, next, throughWeek) ?? [];
        const weeks = new Set([...a, ...b].map((t) => t.week));
        for (const week of [...weeks].sort((x, y) => x - y)) {
            const from = a.find((t) => t.week === week)?.winners ?? [];
            const to = b.find((t) => t.week === week)?.winners ?? [];
            if (from.join() !== to.join())
                changes.push({ rule, week, from, to });
        }
    }
    return changes;
}
/**
 * The stat line's part for a team's trigger this week: `[Weekly high
 * score]{ev=wk.rule.high-score} ([2]{ev=rule.high-score.count} this season) ·
 * [$20]{ev=rule.high-score.winnings} to date`, with ", tied with …" inside the
 * first tag for a tie, and the winnings only when the outcome is dollars or FAAB.
 * Then its rivalry: `Rivalry: [Pylon Patrol]{ev=rival}` this week, and
 * `Rivalry next week: [Pylon Patrol]{ev=next_rival}`.
 */
export function triggerParts(stakes, team, league, ev, names) {
    if (stakes.kind !== "recorded")
        return [];
    const parts = [];
    for (const rule of stakes.houseRules) {
        const id = `wk.rule.${rule.id}`;
        const winners = String(league[id] ?? "").split(",");
        if (!winners.includes(team))
            continue;
        const others = winners
            .filter((t) => t !== team)
            .map((t) => names.get(t) ?? t);
        const tied = others.length > 0 ? `, tied with ${list(others)}` : "";
        // A rule split with from: counts only its own weeks.
        const span = rule.from ? `since week ${rule.from}` : "this season";
        let part = `[${rule.name}${tied}]{ev=${id}} ([${ev[`rule.${rule.id}.count`]}]{ev=rule.${rule.id}.count} ${span})`;
        if (rule.outcome.kind !== "text") {
            part += ` · [${amount(rule.outcome, ev[`rule.${rule.id}.winnings`])}]{ev=rule.${rule.id}.winnings} to date`;
        }
        parts.push(part);
    }
    const rival = ev.rival;
    if (rival)
        parts.push(`Rivalry: [${names.get(rival) ?? rival}]{ev=rival}`);
    const next = ev.next_rival;
    if (next) {
        parts.push(`Rivalry next week: [${names.get(next) ?? next}]{ev=next_rival}`);
    }
    return parts;
}
/**
 * The league stat line's part for each trigger this week, `[Weekly high
 * score: Gus Bus]{ev=wk.rule.high-score}`, then each of this week's
 * rivalries, `[Rivalry week: Gus Bus and Pylon Patrol]{ev=wk.rivalry.1}, won
 * by [Gus Bus]{ev=wk.rivalry.1.winner}`, with no winner for a tie.
 */
export function leagueTriggerParts(stakes, league, names) {
    if (stakes.kind !== "recorded")
        return [];
    const named = (id) => list(String(league[id]).split(",").map((t) => names.get(t) ?? t));
    return [
        ...stakes.houseRules.flatMap((rule) => {
            const id = `wk.rule.${rule.id}`;
            return league[id] === undefined
                ? []
                : [`[${rule.name}: ${named(id)}]{ev=${id}}`];
        }),
        ...Object.keys(league)
            .filter((id) => /^wk\.rivalry\.\d+$/.test(id))
            .map((id) => {
            const winner = league[`${id}.winner`];
            const won = winner
                ? `, won by [${names.get(winner) ?? winner}]{ev=${id}.winner}`
                : "";
            return `[Rivalry week: ${named(id)}]{ev=${id}}${won}`;
        }),
    ];
}
/** An amount in the outcome's unit: `$20` or `10 FAAB`. */
function amount(outcome, n) {
    return outcome.kind === "faab" ? `${n} FAAB` : `$${n}`;
}
/** Whether the platform data can work out a rule's trigger. */
function computable(stakes, rule, league) {
    if (rule.trigger?.kind !== "last-place")
        return true;
    // The model doesn't carry which losers-bracket matchup decides last place.
    return stakes.lastPlace === "standings" && league.settings.divisions === 0;
}
/**
 * Every period's trigger winners for a rule through `week`, or null when the
 * rule has no trigger the data can work out. A week counts once it's scored,
 * from `from` (default week 1) to `until` (default the last regular-season week).
 */
function triggersThrough(stakes, rule, league, week) {
    const trigger = rule.trigger;
    if (!trigger || !computable(stakes, rule, league))
        return null;
    const first = rule.from ?? 1;
    const last = rule.until ?? league.settings.regularSeasonWeeks;
    const scored = league.weeks.filter((w) => w.scored &&
        w.week <= week &&
        w.week <= league.lastScoredWeek &&
        w.week >= first &&
        w.week <= last);
    if (trigger.kind === "last-place") {
        const end = league.settings.regularSeasonWeeks;
        if (week < end || league.lastScoredWeek < end)
            return [];
        const standings = standingsThrough(league, end);
        const bottom = Math.max(...standings.map((s) => s.rank ?? 0));
        const winners = standings
            .filter((s) => s.rank === bottom)
            .map((s) => s.team);
        return [{ week: end, winners: inLeagueOrder(league, winners) }];
    }
    if (trigger.kind === "champion")
        return champion(league, week);
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
    // Per season, decided once its last week is scored: a high or low score is
    // the season's single best or worst week, points left on the bench the total.
    if (week < last || league.lastScoredWeek < last)
        return [];
    const all = perWeek.flatMap((w) => w.scores);
    if (trigger.kind !== "most-left-on-bench") {
        return [{ week: last, winners: best(league, all, trigger.kind) }];
    }
    const totals = new Map();
    for (const [team, n] of all)
        totals.set(team, (totals.get(team) ?? 0) + n);
    return [{ week: last, winners: best(league, [...totals], trigger.kind) }];
}
/** Each team's number for a score trigger in one week, in cents. */
function weekScores(league, week, kind) {
    const w = league.weeks.find((x) => x.week === week);
    if (!w)
        return [];
    return w.matchups.flatMap((m) => m.sides.map((side) => {
        if (kind !== "most-left-on-bench") {
            return [side.team, Math.round(side.score * 100)];
        }
        const scored = side.lineup
            .filter(isStarter)
            .reduce((a, e) => a + e.points, 0);
        const bestPoints = bestLineupPoints(side.lineup, league.settings.lineupSlots, league.players);
        return [side.team, Math.round((bestPoints - scored) * 100)];
    }));
}
/** The teams with the trigger's best number: highest, or lowest for a low score. */
function best(league, scores, kind) {
    if (scores.length === 0)
        return [];
    const values = scores.map(([, v]) => v);
    const target = kind === "low-score" ? Math.min(...values) : Math.max(...values);
    return inLeagueOrder(league, scores.filter(([, v]) => v === target).map(([t]) => t));
}
/** The champion: the winner of the winners bracket's last round, once it has a result. */
function champion(league, week) {
    const rounds = Math.ceil(Math.log2(Math.max(2, league.settings.playoffTeams)));
    for (const w of league.weeks) {
        if (!w.scored || w.week > week)
            continue;
        for (const m of w.matchups) {
            if (m.kind !== "winners" || m.round !== rounds)
                continue;
            const won = m.sides.find((s) => s.result === "W");
            if (won)
                return [{ week: w.week, winners: [won.team] }];
        }
    }
    return [];
}
function inLeagueOrder(league, teams) {
    return league.teams.map((t) => t.id).filter((id) => teams.includes(id));
}
function round(n) {
    return Math.round(n * 100) / 100;
}
//# sourceMappingURL=stakes.js.map