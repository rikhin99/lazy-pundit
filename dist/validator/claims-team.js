import { CLAUSE_BREAK, LOSS_VERB, RESULT_VERBS } from "./extract.js";
import { normalize, wholeWords } from "./names.js";
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
const OBJECT_BEFORE = new RegExp(`(?:${RESULT_VERBS.source}|\\b(?:${OBJECT_PREPOSITIONS.join("|")})\\s+)$`, "i");
/** Words meaning the section's team: "we", "they", "this team". */
const PRONOUN = /\b(?:we|us|our|they|them|their|this team|the team)\b/gi;
/**
 * The pronouns of `PRONOUN` that, in the clause straight after a result,
 * mean the team that lost instead.
 */
const BEATEN_PRONOUN = /^(?:them|their)$/;
/** A clause about the team named just before it: "Bench Mob, who sit at 7-1". */
const RELATIVE = /^\s*(?:who|which)\b/i;
/** A phrase put before its clause's subject: "At 7-1, Bench Mob lead". */
const FRONTED = /^\s*(?:at|after|on|in)\b/i;
function clauses(s) {
    const found = [];
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
function named(ctx, s, section) {
    const low = normalize(s);
    const found = [];
    const add = (team, re) => {
        for (const m of low.matchAll(re)) {
            found.push({ team, start: m.index, end: m.index + m[0].length });
        }
    };
    for (const [team, names] of Object.entries(ctx.input.nicknames)) {
        for (const n of names)
            add(team, wholeWords(n));
    }
    add(section, PRONOUN);
    return found.sort((a, b) => a.start - b.start);
}
/**
 * The subject of a clause: the first team it names, or the section's team for
 * a pronoun, that isn't an object. Undefined when it names none.
 */
function subjectOf(s, names, c) {
    return names.find((n) => n.start >= c.from &&
        n.start < c.to &&
        !OBJECT_BEFORE.test(s.slice(0, n.start)));
}
/**
 * The team that lost a result between two teams in clause `c`: the object of
 * a win ("Gus Bus beat Pete"), the subject of a loss ("Pete lost to Gus
 * Bus"). Null when that's the section's team and the section has none;
 * undefined when the clause holds no such result.
 */
function beatenIn(s, names, c) {
    const subject = subjectOf(s, names, c);
    if (!subject)
        return undefined;
    for (const m of s.slice(c.from, c.to).matchAll(RESULT_VERBS)) {
        const at = c.from + m.index + m[0].length;
        const object = names.find((n) => n.start === at);
        if (!object)
            continue;
        const lost = LOSS_VERB.test(m[1].toLowerCase());
        return lost ? subject.team : object.team;
    }
    return undefined;
}
/**
 * `names` with "them" or "their" as the team that lost, in the clause straight
 * after a result between two teams ("Gus Bus beat Pete, handing them a third
 * loss in a row"). A clause holding only space, as between ", and", is
 * skipped. Only the claim's own clause reads these: a later clause carrying
 * on the subject is the sentence's ("…, handing them a loss, and sits at 4-4").
 */
function withBeaten(s, names, cs) {
    const said = cs.filter((c) => /\S/.test(s.slice(c.from, c.to)));
    return names.map((n) => {
        if (!BEATEN_PRONOUN.test(normalize(s.slice(n.start, n.end))))
            return n;
        const k = said.findLastIndex((c) => c.from <= n.start);
        const before = said[k - 1];
        const beaten = before && beatenIn(s, names, before);
        return beaten === undefined ? n : { ...n, team: beaten };
    });
}
/**
 * The claim's team for an untagged claim at `start` of sentence `s`: the
 * subject of the claim's clause. A claim in brackets or a "who" clause
 * straight after a name is that team's ("lost to Gus Bus (4-4)"); a phrase
 * put before its subject takes the next clause's ("At 7-1, Bench Mob lead");
 * a clause naming no subject carries on the one before it ("Pete lost to Gus
 * Bus and sits at 3-5"), and the sentence starts from the section's team.
 */
export function claimsTeam(ctx, s, start, section) {
    const names = named(ctx, s, section);
    const cs = clauses(s);
    const here = withBeaten(s, names, cs);
    const i = cs.findLastIndex((c) => c.from <= start);
    const c = cs[i];
    const text = s.slice(c.from, c.to);
    if (c.opener === "(" || (c.opener === "," && RELATIVE.test(text))) {
        const before = s.slice(0, c.from - c.opener.length).trimEnd().length;
        const prior = here.findLast((n) => n.end === before);
        if (prior)
            return prior.team;
    }
    const own = subjectOf(s, here, c);
    if (own)
        return own.team;
    const next = cs[i + 1];
    if (i === 0 && next?.opener === "," && FRONTED.test(text)) {
        const later = subjectOf(s, names, next);
        if (later)
            return later.team;
    }
    for (let j = i - 1; j >= 0; j--) {
        const earlier = subjectOf(s, names, cs[j]);
        if (earlier)
            return earlier.team;
    }
    return section;
}
//# sourceMappingURL=claims-team.js.map