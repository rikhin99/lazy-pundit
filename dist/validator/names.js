// ---------- names ----------
export function normalize(s) {
    return s.toLowerCase().replace(/[’‘]/g, "'");
}
export function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Matches a name as whole words, in normalized text. */
export function wholeWords(name) {
    return new RegExp(`(?<!\\w)${escapeRe(normalize(name))}(?!\\w)`, "g");
}
export function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
}
/** Whether the text names the team by one of its nicknames, as whole words. */
export function namesTeam(ctx, team, text) {
    const low = normalize(text);
    return (ctx.input.nicknames[team] ?? []).some((n) => wholeWords(n).test(low));
}
/** Where any team's nickname appears in a sentence. */
export function nameSpans(ctx, s) {
    const low = normalize(s);
    const spans = [];
    for (const names of Object.values(ctx.input.nicknames)) {
        for (const n of names) {
            for (const m of low.matchAll(wholeWords(n))) {
                spans.push({ start: m.index, end: m.index + m[0].length });
            }
        }
    }
    return spans;
}
//# sourceMappingURL=names.js.map