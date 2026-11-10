// ---------- tags ----------
export const TAG = /\[([^\][]*)\]\{(ev|lore|stakes|log)=([^{}\s]+)\}/g;
/**
 * The text with every tag unwrapped, the tags, and a map from each plain
 * offset back to the input text.
 */
export function unwrap(text) {
    const tags = [];
    const toInput = [];
    let plain = "";
    let last = 0;
    const copy = (from, to) => {
        for (let i = from; i < to; i++)
            toInput.push(i);
        plain += text.slice(from, to);
    };
    for (const m of text.matchAll(TAG)) {
        copy(last, m.index);
        const inner = m[1];
        const plainStart = plain.length;
        copy(m.index + 1, m.index + 1 + inner.length);
        tags.push({
            start: m.index,
            end: m.index + m[0].length,
            inner,
            kind: m[2],
            value: m[3],
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
export function stripTags(text) {
    return unwrap(text).plain;
}
/** The text with each auto-tag added around its words; no word changes. */
export function applyAutoTags(text, tags) {
    let out = text;
    for (const t of [...tags].sort((a, b) => b.start - a.start)) {
        out = `${out.slice(0, t.start)}[${out.slice(t.start, t.end)}]{ev=${t.id}}${out.slice(t.end)}`;
    }
    return out;
}
//# sourceMappingURL=tags.js.map