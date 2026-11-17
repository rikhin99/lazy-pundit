import { nameSpans, overlaps } from "./names.js";
// ---------- swearing ----------
export const SWEARS = /\b(?:(?:mother)?fuck(?:s|ed|er|ers|ing|in|face|wit)?|(?:bull)?shit(?:s|ty|ted|ting|head|show|bag)?|bitch(?:es|y|ing)?|bastards?|assholes?|ass|arse|(?:god)?damn(?:ed|it)?|cunts?|dick(?:s|head|heads)?|cock(?:s|sucker|suckers)?|piss(?:ed|es|ing)?|wtf|stfu)\b/gi;
/**
 * Words that mention money, a prize or a punishment, for a league that plays
 * for bragging rights only. Narrow on purpose: "fine", "bet" and
 * "punishing" are everyday words, so only their stakes forms are listed.
 */
export const STAKES_WORDS = /(?:\$\d[\d,.]*|\b(?:dollars?|bucks|money|prizes?|pots?|jackpots?|payouts?|paid out|buy-?ins?|wagers?|wagered|fines|fined|punishments?|punished|forfeits?)\b)/gi;
export function swears(ctx, plain) {
    return matches(ctx, plain, SWEARS);
}
/** Each mention of money, a prize or a punishment, outside team names. */
export function stakesMentions(ctx, plain) {
    return matches(ctx, plain, STAKES_WORDS);
}
function matches(ctx, plain, words) {
    const names = nameSpans(ctx, plain);
    const out = [];
    for (const m of plain.matchAll(words)) {
        const start = m.index;
        const end = start + m[0].length;
        if (names.some((n) => overlaps({ start, end }, n)))
            continue;
        out.push({ word: m[0], start, end });
    }
    return out;
}
//# sourceMappingURL=swears.js.map