import { nameSpans, normalize, overlaps, wholeWords } from "./names.js";
import { firstNum, HEDGE, hedgeBefore, NUMW, ORDW, parseNum, } from "./numbers.js";
// ---------- units: sentences, with each bullet its own unit ----------
export const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
/** Sentences of the plain text, each with its offset. A bullet never runs into the next line. */
export function units(plain) {
    const out = [];
    const blocks = [];
    let offset = 0;
    let current = null;
    for (const line of plain.split("\n")) {
        const lineStart = offset;
        offset += line.length + 1;
        if (!line.trim() || BULLET.test(line)) {
            if (current)
                blocks.push(current);
            current = null;
            if (!line.trim())
                continue;
            const bullet = line.match(BULLET)[0].length;
            blocks.push({ text: line.slice(bullet), start: lineStart + bullet });
            continue;
        }
        if (current)
            current.text += `\n${line}`;
        else
            current = { text: line, start: lineStart };
    }
    if (current)
        blocks.push(current);
    const SENTENCE = /(?:\bNo\.\s|[^.!?]|[.!?](?=\S))+[.!?]*/g;
    for (const b of blocks) {
        for (const m of b.text.matchAll(SENTENCE)) {
            if (m[0].trim())
                out.push({ s: m[0], start: b.start + m.index });
        }
    }
    return out;
}
/**
 * A week a clause names as the one its claims are about: "in week 8",
 * "during week 8", "for week 8", "week 8's", or "this week" for the ranking
 * week. "Since week 3" or "a week 14 bye" name no week a claim reads.
 */
const NAMED_WEEK = /\b(?:(?:in|during|for)\s+(?:week|wk)\s*(\d{1,2})\b|(?:week|wk)\s*(\d{1,2})['’]s\b|this week\b)/gi;
/** Where one clause ends and the next begins. */
const CLAUSE_BREAK = /[,;:()—–]|\s-\s|\b(?:and|but|while|though|although|whereas)\b/gi;
/**
 * The week a claim at `start`..`end` reads: of the weeks named in the
 * claim's own clause, the nearest one, else the ranking week.
 */
function namedWeek(s, start, end, rankingWeek) {
    let from = 0;
    let to = s.length;
    for (const m of s.matchAll(CLAUSE_BREAK)) {
        if (m.index + m[0].length <= start)
            from = m.index + m[0].length;
        else if (m.index >= end) {
            to = m.index;
            break;
        }
    }
    const clause = s.slice(from, to);
    let best = rankingWeek;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const m of clause.matchAll(NAMED_WEEK)) {
        const mStart = from + m.index;
        const mEnd = mStart + m[0].length;
        const d = mEnd <= start ? start - mEnd : mStart >= end ? mStart - end : 0;
        if (d < bestDist) {
            bestDist = d;
            best = (m[1] ?? m[2]) ? Number(m[1] ?? m[2]) : rankingWeek;
        }
    }
    return best;
}
export const RESULT_VERBS = /\b(beat|beats|edged|edges|crushed|crushes|smoked|smokes|took down|takes down|squeaked past|squeaks past|handled|handles|blew out|blows out|outlasted|outlasts|lost to|loses to|fell to|falls to|dropped one to|drops one to)\s+/gi;
export const LOSS_VERB = /^(lost|loses|fell|falls|dropped|drops)/;
export const ORDINAL_CUES = [
    [/all[- ]play/, () => "allplay_rank"],
    [/points against|\bpa\b/, () => "pa_rank"],
    [/\bform\b|\blately\b|last (three|3)/, () => "form_rank"],
    [/this week|the week|week[- ]high|week \d/, (w) => `w${w}.rank`],
    [/points|scoring|\bpf\b|scored/, () => "pf_rank"],
    [/standings/, () => "standing"],
    [/\bseed\b/, () => "seed"],
    [/\branked\b|\branking|\bspot\b|\bpower\b/, () => "place"],
];
/** A recent window: "averaging 120 over the last three" is form, not `ppg`. */
const FORM_CUE = /\blast three\b|\blast 3\b|\blately\b/;
export const NUMBER_CUES = [
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
    [FORM_CUE, () => "form3"],
    [/\baverag|\bper week\b|\bper game\b/, () => "ppg"],
    [/\bpoints against\b|\ballowed\b/, () => "pa"],
    [
        /\bluck|\bunlucky\b|\blucky\b|\bcost (them|him|her)\b|\brobbed\b/,
        () => "luck",
    ],
];
export function ordinalKey(ctx, week) {
    const c = ctx.toLowerCase();
    for (const [cue, key] of ORDINAL_CUES)
        if (cue.test(c))
            return key(week);
    return null;
}
/**
 * The number cue closest to a number: the last one before it, else the first
 * after. An average cue gives way to a form cue in the number's clause.
 */
export function nearestCue(before, after, week) {
    let best = null;
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
        if (m && m.index + 1000 < bestDist) {
            bestDist = m.index + 1000;
            best = key(week);
        }
    }
    // within the number's own clause
    const clause = `${before.split(/[;!?]|\.\s/).at(-1)} ${after.split(/[;!?]|\.\s/)[0]}`;
    if (best === "ppg" && FORM_CUE.test(clause))
        return "form3";
    return best;
}
export function groupsOf(ctx) {
    const labels = new Set();
    for (const o of Object.values(ctx.order))
        if (o.group)
            labels.add(o.group);
    return [...labels];
}
/** The group of the team in first place, or in last. */
export function edgeGroup(ctx, edge) {
    const places = Object.values(ctx.order).sort((a, b) => a.place - b.place);
    return (edge === "top" ? places[0] : places.at(-1))?.group;
}
/** The numbers a group label carries: "Tier 2" and "Second tier" both carry 2. */
export function labelNumber(label) {
    const n = firstNum(label);
    return n ? n.num.n : null;
}
export const MOVE_VERBS = "climbs?|climbed|climbing|rises|rose|rising|jumps?|jumped|jumping|moves? up|moved up|falls?|fell|falling|drops?|dropped|dropping|slides?|slid|sliding|slips?|slipped|tumbles?|tumbled";
export const MOVE_DOWN = /^(fall|fell|drop|slid|slip|tumbl|down)/;
/** Playoff phrases and the status each one states; null is a loose phrase. */
const PLAYOFFS = [
    [
        /\b(?:clinch(?:ed|es|ing)?|locked up|locks up|secured|secures) (?:a |the )?(?:first[- ]round |round[- ]one |playoff )?bye\b/gi,
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
    // A bare "knocked out" can be a player's injury, so only the bracket's is
    // checked. A round counts only at the clause's end or before its opponent:
    // "in the final minutes" and "in the first round of the draft" aren't one.
    [
        /\bknocked out (?:of (?:the )?(?:playoffs|bracket)\b|in (?:the )?(?:(?:first|second|third|opening|1st|2nd|3rd) round|round (?:one|two|three|[123])|quarter-?finals?|quarters|semi-?finals?|semis|finals?)(?=\s*(?:$|[.,;:!?)—–-]|(?:by|to|against|at)\b)))/gi,
        "eliminated",
    ],
    [
        /\bplayoff (?:lock|bound|hopes?)\b|\bin the (?:playoff )?hunt\b|\bon the bubble\b|\bpunch(?:ed|es)? (?:their|a) (?:playoff )?ticket\b/gi,
        null,
    ],
];
/** What these words state about playoff status: undefined when they're no playoff phrase. */
export function playoffWant(words) {
    return PLAYOFFS.find(([re]) => words.search(re) >= 0)?.[1];
}
export function extract(ctx, s) {
    const out = [];
    const low = s.toLowerCase();
    const weekAt = (start, end) => namedWeek(s, start, end, ctx.evidence.week);
    const add = (start, end, shape, week = weekAt(start, end)) => out.push({ start, end, shape, week });
    // results: a verb, then a team's name
    for (const m of s.matchAll(RESULT_VERBS)) {
        const restStart = m.index + m[0].length;
        const rest = normalize(s.slice(restStart));
        let best = null;
        for (const [team, names] of Object.entries(ctx.input.nicknames)) {
            for (const n of names) {
                const nn = normalize(n);
                if (rest.startsWith(nn) &&
                    !/\w/.test(rest[nn.length] ?? "") &&
                    (!best || nn.length > best.len)) {
                    best = { team: team, len: nn.length };
                }
            }
        }
        if (best) {
            add(m.index, restStart + best.len, {
                type: "result",
                won: !LOSS_VERB.test(m[1].toLowerCase()),
                opponent: best.team,
            });
        }
    }
    // scores (133.22-78.22) and records (7-1, 7-1-1)
    for (const m of s.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+))?(?![\w.]*\d)/g)) {
        const a = parseNum(m[1]);
        const b = parseNum(m[2]);
        const split = m[0].search(/[-–]/);
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
    for (const m of s.matchAll(new RegExp(`\\b(?:\\d+|${NUMW}|${ORDW})(?:[- ]games?)?(?: straight| consecutive| in a row)+(?! weeks?\\b)(?:\\s+(?:wins?|losses|loss|games|w's|l's|heater|skid|win(?:ning)? streak|losing streak)\\b)?|\\b(?:\\d+|${NUMW})[- ]game (?:heater|skid|win(?:ning)? streak|losing streak)\\b|\\b(?:\\d+|${NUMW}) (?:wins|losses) in a row\\b`, "gi"))) {
        add(m.index, m.index + m[0].length, {
            type: "stat",
            keys: ["streak"],
        });
    }
    // movement
    for (const m of s.matchAll(new RegExp(`\\b(${MOVE_VERBS}|up|down)\\s+(\\d+|${NUMW})(\\s+(?:spots?|places?))?`, "gi"))) {
        const verb = m[1].toLowerCase();
        const n = parseNum(m[2]);
        const bare = verb === "up" || verb === "down";
        if (!m[3] && !bare)
            continue;
        if (bare) {
            const after = low.slice(m.index + m[0].length);
            const before = low.slice(0, m.index);
            if (/^\s*(points|pts|wins|losses|on the (year|season))/.test(after))
                continue;
            if (/\b(put|puts|putting|racked|racks)\s*$/.test(before))
                continue;
            if (n.n > ctx.teamCount)
                continue;
        }
        add(m.index, m.index + m[0].length, {
            type: "move",
            by: MOVE_DOWN.test(verb) ? -n.n : n.n,
        });
    }
    for (const m of s.matchAll(/\b(?:debuts?|debuted|debuting)\b|\bnew (?:to|in) the rankings\b|\bnew entry\b|\(new\)|(?<=\b(?:is|are|['’]re|['’]s)\s+)new\b(?!\s+(?:high|low|record|career|season))/gi)) {
        add(m.index, m.index + m[0].length, { type: "move", by: "new" });
    }
    // groups: a heading's text, or a tier with a number
    for (const label of groupsOf(ctx)) {
        for (const m of normalize(s).matchAll(wholeWords(label))) {
            add(m.index, m.index + m[0].length, { type: "group", label });
        }
    }
    for (const m of s.matchAll(new RegExp(`\\b(\\d+(?:st|nd|rd|th)|${ORDW})[- ]tier\\b|\\btier (\\d+|${NUMW})\\b`, "gi"))) {
        add(m.index, m.index + m[0].length, {
            type: "group",
            tier: parseNum((m[1] ?? m[2])).n,
        });
    }
    for (const m of s.matchAll(/\b(top|bottom)[- ]tier\b/gi)) {
        add(m.index, m.index + m[0].length, {
            type: "group",
            edge: m[1].toLowerCase(),
        });
    }
    // playoff words
    for (const [re, want] of PLAYOFFS) {
        for (const m of s.matchAll(re)) {
            add(m.index, m.index + m[0].length, { type: "playoffs", want });
        }
    }
    // place: #N, No. N, top N, bottom N
    for (const m of s.matchAll(new RegExp(`(?:#|\\bNo\\.\\s?)(\\d+)\\b|\\b(top|bottom) (\\d+|${NUMW})\\b`, "gi"))) {
        const after = low.slice(m.index + m[0].length, m.index + m[0].length + 30);
        const week = weekAt(m.index, m.index + m[0].length);
        const key = m[2] ? (ordinalKey(after, week) ?? "place") : "place";
        if (m[1]) {
            const n = Number(m[1]);
            add(m.index, m.index + m[0].length, {
                type: "place",
                key,
                test: (p) => p === n,
            });
        }
        else {
            const n = parseNum(m[3]).n;
            const top = m[2].toLowerCase() === "top";
            const count = ctx.teamCount;
            add(m.index, m.index + m[0].length, {
                type: "place",
                key,
                test: top ? (p) => p <= n : (p) => p > count - n,
            });
        }
    }
    // ordinals: a stat cue picks the stat, a ranking cue picks place
    for (const m of s.matchAll(new RegExp(`\\b(\\d+(?:st|nd|rd|th)|${ORDW})\\b`, "gi"))) {
        const word = m[1];
        const after = low.slice(m.index + word.length, m.index + word.length + 30);
        const before = low.slice(Math.max(0, m.index - 30), m.index);
        if (/^[- ](game|straight|consecutive|tier)/.test(after))
            continue;
        const num = parseNum(word);
        const key = ordinalKey(before + after, weekAt(m.index, m.index + word.length));
        const standingWords = /\bin\s*$/.test(before) || /^ place\b/.test(after);
        if (key) {
            add(m.index, m.index + word.length, {
                type: "stat",
                keys: [key],
                num,
                ordinal: true,
            });
        }
        else if (standingWords) {
            add(m.index, m.index + word.length, {
                type: "stat",
                keys: ["standing", "place"],
                num,
                ordinal: true,
            });
        }
        else if (/\d/.test(word)) {
            add(m.index, m.index + word.length, {
                type: "stat",
                keys: [],
                num,
                ordinal: true,
            });
        }
    }
    // bare numbers, and "nearly two wins"
    for (const m of s.matchAll(new RegExp(`(?<![\\w.#])(\\d[\\d,]*(?:\\.\\d+)?)(?![\\w.]*\\d)(?!\\s*(?:st|nd|rd|th)\\b)|\\b(${NUMW}) (wins|losses|points)\\b`, "gi"))) {
        const before = low.slice(Math.max(0, m.index - 30), m.index);
        if (/\b(week|wk|w)\s*$/.test(before))
            continue;
        const token = (m[1] ?? m[2]);
        if (m[1] && /^(19|20)\d\d$/.test(token))
            continue;
        const num = parseNum(token);
        const tailStart = m.index + m[0].length;
        const week = weekAt(m.index, tailStart);
        let key = /\bby\s*$/.test(before)
            ? `w${week}.margin`
            : nearestCue(before, low.slice(tailStart, tailStart + 25), week);
        const hedge = hedgeBefore(before);
        // "nearly two wins" with no other cue is wins above or below expectation
        if (m[2] && !key && hedge)
            key = "luck";
        const hedgeLen = hedge
            ? before.match(HEDGE)[0].length
            : 0;
        add(m.index - hedgeLen, m.index + m[0].length, { type: "stat", keys: key ? [key] : [], num, hedge }, week);
    }
    // a team's own name is never a claim, and the earlier, longer claim wins an overlap
    const names = nameSpans(ctx, s);
    out.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const kept = [];
    for (const c of out) {
        const inName = c.shape.type !== "result" && names.some((n) => overlaps(c, n));
        if (inName)
            continue;
        if (!kept.some((k) => overlaps(c, k)))
            kept.push(c);
    }
    return kept;
}
//# sourceMappingURL=extract.js.map