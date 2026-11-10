import { buildEvidencePack, injuredPlayers, list } from "./evidence-pack.js";
import { leagueTriggerParts, stakesEvidence, triggerParts, UNRECORDED, } from "./stakes.js";
import { CLINCHED_LABEL } from "./validator.js";
/**
 * The evidence pack, stat lines and editing-view stats for the ranking week,
 * with the stakes' evidence and this week's triggers when stakes are recorded.
 */
export function draftData(league, week, stakes = UNRECORDED, inProgressWeek) {
    const evidence = buildEvidencePack(league, week, inProgressWeek);
    const fromStakes = stakesEvidence(stakes, league, week);
    Object.assign(evidence.league, fromStakes.league);
    for (const [team, ev] of Object.entries(fromStakes.teams)) {
        const id = team;
        evidence.teams[id] = { ...evidence.teams[id], ...ev };
    }
    const names = new Map(league.teams.map((t) => [t.id, t.name]));
    const teams = {};
    for (const team of league.teams) {
        const ev = evidence.teams[team.id] ?? {};
        const triggers = triggerParts(stakes, team.id, evidence.league, ev, names);
        teams[team.id] = {
            statLine: [statLine(ev, names, week), ...triggers]
                .filter(Boolean)
                .join(" · "),
            stats: {
                ...pick(ev, "record", "streak", "allplay"),
                ...pickNumbers(ev, "pf", "form3", "luck"),
                injuries: injuredPlayers(league, team.id).map((p) => ({
                    name: p.name,
                    status: p.injuryStatus,
                    bodyPart: p.injuryBodyPart,
                })),
            },
        };
    }
    const intro = [
        leagueStatLine(evidence, names),
        ...leagueTriggerParts(stakes, evidence.league, names),
    ].filter(Boolean);
    return {
        week,
        ...(inProgressWeek !== undefined && { inProgressWeek }),
        evidence,
        intro: intro.join(" · "),
        teams,
    };
}
/** A settled playoff status, as a stat line says it. */
const PLAYOFF_WORDS = {
    clinched_bye: "Clinched a bye",
    clinched: "Clinched a playoff spot",
    eliminated: "Eliminated",
};
/**
 * A team's stat line: points rank, a streak of two or more, its last result
 * and any settled playoff status, e.g. `[3rd]{ev=pf_rank} in points ·
 * [won 3 straight]{ev=streak} · [beat]{ev=w8.result} [Pirates]{ev=w8.opponent}
 * by [5.5]{ev=w8.margin} · [Clinched a bye]{ev=playoffs}`. A team knocked
 * out of the bracket ends `[Knocked out]{ev=knocked_out}` in its place.
 * The record is left out: the published line already leads with it.
 */
function statLine(ev, names, week) {
    const parts = [];
    if (typeof ev.pf_rank === "number" && ev.allplay !== undefined) {
        parts.push(`[${ordinal(ev.pf_rank)}]{ev=pf_rank} in points`);
    }
    const run = /^([WLT])(\d+)$/.exec(String(ev.streak ?? ""));
    if (run && Number(run[2]) >= 2) {
        const verb = { W: "won", L: "lost", T: "tied" }[run[1]];
        parts.push(`[${verb} ${run[2]} straight]{ev=streak}`);
    }
    const last = lastMatchup(ev, names, week);
    if (last)
        parts.push(last);
    if (ev.knocked_out !== undefined) {
        parts.push("[Knocked out]{ev=knocked_out}");
    }
    else if (ev.playoffs !== undefined) {
        const status = PLAYOFF_WORDS[ev.playoffs];
        parts.push(`[${status}]{ev=playoffs}`);
    }
    return parts.join(" · ");
}
/**
 * The team's latest matchup through the ranking week `upTo`, never an
 * in-progress week a draft let in: `[beat]{ev=w8.result}
 * [Pirates]{ev=w8.opponent} by [5.5]{ev=w8.margin}`. A losers-bracket
 * matchup, where the lower score advances, or a two-week round not yet
 * decided gives the scores instead.
 */
function lastMatchup(ev, names, upTo) {
    const week = Object.keys(ev)
        .map((k) => /^w(\d+)\.opponent$/.exec(k)?.[1])
        .filter((w) => w !== undefined)
        .map(Number)
        .filter((w) => w <= upTo)
        .sort((a, b) => b - a)[0];
    if (week === undefined)
        return null;
    const w = `w${week}`;
    const opp = `[${names.get(ev[`${w}.opponent`]) ?? ""}]{ev=${w}.opponent}`;
    const result = ev[`${w}.result`];
    if (ev[`${w}.bracket`] === "losers" || result === undefined) {
        const where = ev[`${w}.bracket`] === "losers" ? " in the losers bracket" : "";
        return `${opp}${where}, [${num(ev[`${w}.points`])}]{ev=${w}.points} to [${num(ev[`${w}.opp_points`])}]{ev=${w}.opp_points}`;
    }
    if (result === "T")
        return `[tied]{ev=${w}.result} ${opp}`;
    const verb = result === "W" ? "beat" : "lost to";
    return `[${verb}]{ev=${w}.result} ${opp} by [${num(ev[`${w}.margin`])}]{ev=${w}.margin}`;
}
/** The league stat line: the week's high and low, biggest margin, closest matchup and who clinched. */
function leagueStatLine(pack, names) {
    const lg = pack.league;
    const team = (id) => `[${names.get(lg[id]) ?? ""}]{ev=${id}}`;
    const parts = [];
    if (lg["wk.high"] !== undefined) {
        parts.push(`Week high: ${team("wk.high_team")} [${num(lg["wk.high"])}]{ev=wk.high}`, `Week low: ${team("wk.low_team")} [${num(lg["wk.low"])}]{ev=wk.low}`);
    }
    if (lg["wk.margin_max"] !== undefined) {
        parts.push(`Biggest margin: ${team("wk.margin_max_team")} by [${num(lg["wk.margin_max"])}]{ev=wk.margin_max}`, `Closest matchup: ${team("wk.margin_min_team")} by [${num(lg["wk.margin_min"])}]{ev=wk.margin_min}`);
    }
    const clinched = lg["wk.clinched"];
    if (clinched !== undefined) {
        const teams = String(clinched).split(",");
        const who = list(teams.map((t) => names.get(t) ?? t));
        parts.push(`[${CLINCHED_LABEL} ${who}]{ev=wk.clinched}`);
    }
    return parts.join(" · ");
}
function ordinal(n) {
    const suffix = n % 100 >= 11 && n % 100 <= 13
        ? "th"
        : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
    return `${n}${suffix}`;
}
function num(v) {
    return String(v ?? "");
}
function pick(ev, ...keys) {
    return Object.fromEntries(keys.filter((k) => typeof ev[k] === "string").map((k) => [k, ev[k]]));
}
function pickNumbers(ev, ...keys) {
    return Object.fromEntries(keys.filter((k) => typeof ev[k] === "number").map((k) => [k, ev[k]]));
}
//# sourceMappingURL=draft-data.js.map