// ---------- numbers ----------
export const WORDS = {
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
export const ORDS = {
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
export const NUMW = Object.keys(WORDS).join("|");
export const ORDW = Object.keys(ORDS).join("|");
export function parseNum(token) {
    const tok = token.toLowerCase().replace(/,/g, "");
    if (tok in WORDS)
        return { n: WORDS[tok], dp: 0 };
    if (tok in ORDS)
        return { n: ORDS[tok], dp: 0 };
    const m = tok.match(/^(\d+)(?:\.(\d+))?(?:st|nd|rd|th)?$/);
    if (!m)
        return null;
    return {
        n: Number.parseFloat(tok.replace(/(st|nd|rd|th)$/, "")),
        dp: m[2]?.length ?? 0,
    };
}
export const NUM_TOKEN = new RegExp(`(?<![\\w.])(\\d[\\d,]*(?:\\.\\d+)?(?:st|nd|rd|th)?|${NUMW}|${ORDW})\\b`, "i");
export function firstNum(text) {
    const m = text.match(NUM_TOKEN);
    if (!m)
        return null;
    const num = parseNum(m[1]);
    return num ? { num, index: m.index } : null;
}
export const HEDGE = /(?:more than|over|north of|under|less than|fewer than|nearly|almost|about|around|roughly|close to|~)\s*$/;
/** A hedge right before a number: "over 950", "nearly two". */
export function hedgeBefore(text) {
    const m = text.toLowerCase().match(HEDGE);
    if (!m)
        return null;
    if (/more than|over|north of/.test(m[0]))
        return "over";
    if (/under|less than|fewer than/.test(m[0]))
        return "under";
    return "approx";
}
/** Does a written number agree with a fact, allowing for rounding and hedges? */
export function numMatch(claim, hedge, fact) {
    if (hedge === "over")
        return fact > claim.n;
    if (hedge === "under")
        return fact < claim.n;
    if (hedge === "approx") {
        return Math.abs(fact - claim.n) <= Math.max(0.05 * Math.abs(claim.n), 0.5);
    }
    const f = 10 ** claim.dp;
    return Math.round(fact * f) / f === claim.n;
}
//# sourceMappingURL=numbers.js.map