import { normalize } from "./names.js";
/** `w8.top` and its `w8.top_points`; likewise `.zeros`, `.benchmiss` and `.opp.top`. */
function playerFact(stat) {
    const m = stat.match(/^(w\d+\.(?:top|zeros|benchmiss|opp\.top))(_points)?$/);
    return m ? { nameStat: m[1], points: !!m[2] } : null;
}
/** Whether a stat's value is a player's name, or a list of them. */
export function isPlayerName(stat) {
    return playerFact(stat)?.points === false;
}
const CALENDAR = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)$/;
/** Capitals that end a run: a position, or three or more such as "MVP". Initials such as "DJ" don't. */
const NOT_A_NAME = /^(QB|RB|WR|TE|[A-Z]{3,}\d*)$/;
/** One word: a capitalised word, its possessive, and punctuation that ends a run. */
const WORD = /^[("“]*([A-Z][A-Za-z'’.-]*?)(['’]s?)?([)"”,;:!?]*)$/;
/** Runs of capitalised words, as written, each ending at a possessive or punctuation. */
function capitalRuns(words) {
    const out = [];
    let cur = [];
    const end = () => {
        if (cur[0] === "The")
            cur.shift();
        if (cur.length)
            out.push(cur.join(" "));
        cur = [];
    };
    for (const token of words.trim().split(/\s+/)) {
        const m = token.match(WORD);
        if (!m || NOT_A_NAME.test(m[1])) {
            end();
            continue;
        }
        cur.push(m[1]);
        if (m[2] || m[3])
            end();
    }
    end();
    return out;
}
/** A name's words, compared without case, curly quotes or full stops. */
function tokens(name) {
    return normalize(name).replace(/\./g, "").split(/\s+/).filter(Boolean);
}
/** Whether one list of words sits, in order and unbroken, inside the other. */
function within(part, whole) {
    return whole.some((_, i) => part.every((w, j) => whole[i + j] === w));
}
/** The players a fact holds: one name, or a list such as "A, B and C". */
function splitPlayers(value) {
    return String(value).split(/, | and /);
}
function factPlayers(ctx, r) {
    const fact = playerFact(r.stat);
    if (!fact || r.team === null)
        return null;
    const value = fact.points
        ? ctx.evidence.teams[r.team]?.[fact.nameStat]
        : r.value;
    if (value === undefined)
        return null;
    return {
        id: `${teamPrefix(ctx, r)}${fact.nameStat}`,
        value: String(value),
        players: splitPlayers(value),
    };
}
/** How an evidence ID names another team's stat: `sleeper:3/` outside its section. */
export function teamPrefix(ctx, r) {
    return r.team && r.team !== ctx.input.team ? `${r.team}/` : "";
}
/** Whether a run names one of the fact's players: part of a name, in full or by surname, or holding one. */
function namesOneOf(fact, run) {
    const r = tokens(run);
    return fact.players.some((p) => {
        const name = tokens(p);
        return r.length > 0 && (within(r, name) || within(name, r));
    });
}
/** Every word of every player the evidence pack names, to tell a lone surname from a word. */
function knownWords(ctx) {
    const out = new Set();
    for (const stats of Object.values(ctx.evidence.teams)) {
        for (const [stat, value] of Object.entries(stats)) {
            if (!isPlayerName(stat))
                continue;
            for (const p of splitPlayers(value))
                for (const w of tokens(p))
                    out.add(w);
        }
    }
    return out;
}
/** Whether the words name one of the players the fact holds. */
export function namesFactPlayer(ctx, r, words) {
    const fact = factPlayers(ctx, r);
    return !!fact && capitalRuns(words).some((run) => namesOneOf(fact, run));
}
/**
 * For a player fact, the reason it's wrong when its words name a different
 * player and none the fact holds. A run of capitalised words reads as a
 * player when it's two or more words, the claim's only words, or holds a
 * word of a player the evidence pack names; a team's name (with or without
 * "The"), a day or a month never does. A lone word no player in the pack
 * holds, such as "Indy's", is left alone, so it's never a false hard problem.
 */
export function wrongPlayer(ctx, r, words) {
    const fact = factPlayers(ctx, r);
    if (!fact)
        return undefined;
    const teamNames = new Set(Object.values(ctx.input.nicknames)
        .flat()
        .map((n) => tokens(n).join(" ")));
    const known = knownWords(ctx);
    const claimWords = tokens(words).join(" ");
    const players = capitalRuns(words).filter((run) => {
        const ws = tokens(run);
        if (teamNames.has(ws.join(" ")) || teamNames.has(`the ${ws.join(" ")}`))
            return false;
        if (ws.some((w) => CALENDAR.test(w)))
            return false;
        return (ws.length >= 2 ||
            ws.join(" ") === claimWords ||
            ws.some((w) => known.has(w)));
    });
    if (players.some((run) => namesOneOf(fact, run)))
        return undefined;
    const other = players[0];
    return other && `names ${other}, but ${fact.id} is ${fact.value}`;
}
//# sourceMappingURL=players.js.map