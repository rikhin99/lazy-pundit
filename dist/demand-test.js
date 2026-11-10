import { readRankingWeeks } from "./ranking-weeks.js";
import { stripTags } from "./validator.js";
import { readWorkspace } from "./workspace.js";
/**
 * The demand-test summary of the workspace at `workspaceDir`: each published
 * ranking week, read from its frozen copy and LLM prose file alone, so nothing
 * is fetched or sent. A draft is never read for it, so one mid-edit doesn't
 * stop it.
 */
export async function stats(workspaceDir) {
    const ws = await readWorkspace(workspaceDir);
    const weeks = [];
    const unreadable = [];
    for (const w of await readRankingWeeks(ws)) {
        unreadable.push(...w.unreadable.filter((u) => u.kind !== "draft"));
        if (!w.frozenCopy)
            continue;
        const { meta } = w.frozenCopy;
        weeks.push({
            season: w.season,
            week: w.week,
            ...(meta.first_published_at && {
                minutesToPublish: minutesBetween(meta.created_at, meta.first_published_at),
            }),
            ...moves(w.frozenCopy),
            ...llmUse(w.frozenCopy, w.llmProse),
            ...(meta.blurb_problems && { blurbProblems: meta.blurb_problems }),
        });
    }
    return { weeks, unreadable, text: summaryText(weeks, unreadable) };
}
const TITLE = "Lazy Pundit demand-test summary";
function summaryText(weeks, unreadable) {
    const couldNot = unreadable.map((u) => `Couldn't read ${u.file}: ${u.reason}`);
    if (weeks.length === 0) {
        return [`${TITLE}: no published ranking weeks yet`, ...couldNot].join("\n");
    }
    const known = (values) => values.filter((v) => v !== undefined);
    const used = weeks.filter((w) => w.llmUsed);
    const problems = known(weeks.map((w) => w.blurbProblems));
    const median = [
        timing(medianOf(known(weeks.map((w) => w.minutesToPublish)))),
        moved(medianOf(weeks.map((w) => w.movedTeams)) ?? 0, medianOf(weeks.map((w) => w.placesMoved)) ?? 0),
        `LLM used in ${used.length} of ${plural(weeks.length, "week")}${keptText(medianOf(known(used.map((w) => w.llmTextKept))))}`,
        blurbProblemsText(problems.length === 0
            ? undefined
            : {
                hard: medianOf(problems.map((p) => p.hard)) ?? 0,
                soft: medianOf(problems.map((p) => p.soft)) ?? 0,
            }),
    ];
    return [
        `${TITLE}: ${plural(weeks.length, "published ranking week")}`,
        ...weeks.map((w) => [
            `${w.season} week ${w.week}: ${timing(w.minutesToPublish)}`,
            moved(w.movedTeams, w.placesMoved),
            w.llmUsed ? `LLM used${keptText(w.llmTextKept)}` : "LLM unused",
            blurbProblemsText(w.blurbProblems),
        ].join(" · ")),
        `Median: ${median.join(" · ")}`,
        ...couldNot,
    ].join("\n");
}
function timing(minutes) {
    return minutes === undefined
        ? "minutes to publish not recorded"
        : `${Math.round(minutes)} min to publish`;
}
function moved(teams, places) {
    if (teams === 0)
        return "no teams moved";
    return `${plural(teams, "team")} moved, ${plural(places, "place")} in all`;
}
function keptText(share) {
    return share === undefined
        ? ""
        : `, ${Math.round(share * 100)}% of its text kept`;
}
function blurbProblemsText(p) {
    return p === undefined
        ? "blurb problems not recorded"
        : `${count(p.hard)} hard and ${count(p.soft)} soft blurb problems`;
}
/** `n` and `noun`, with an s unless `n` is 1. */
function plural(n, noun) {
    return `${count(n)} ${noun}${n === 1 ? "" : "s"}`;
}
/** A count, or a median between two counts, with at most one decimal. */
function count(n) {
    return String(Math.round(n * 10) / 10);
}
/** The middle value, or the mean of the middle two; none for no values. */
function medianOf(values) {
    if (values.length === 0)
        return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[middle]
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
/**
 * Whether the LLM wrote any of the week's draft, and if so the LLM text kept:
 * the share of its words the frozen copy still has, in order, in the same
 * section, tags left out. An LLM prose file from another draft of the week
 * (another `created_at`) isn't this one's.
 */
function llmUse(frozen, file) {
    if (!file || file.createdAt !== frozen.meta.created_at) {
        return { llmUsed: false };
    }
    const published = new Map();
    for (const e of frozen.entries) {
        if (e.kind === "team")
            published.set(e.team, e.blurb);
    }
    const sections = Object.entries(file.prose.blurbs).map(([id, llm]) => [llm ?? "", published.get(id)]);
    if (file.prose.intro)
        sections.push([file.prose.intro, frozen.intro]);
    let total = 0;
    let keptWords = 0;
    for (const [llm, now] of sections) {
        const from = words(llm);
        total += from.length;
        keptWords += keptInOrder(from, words(now ?? ""));
    }
    return { llmUsed: true, llmTextKept: total === 0 ? 1 : keptWords / total };
}
/** A section's words, lowercased, with tags and punctuation left out. */
function words(text) {
    return (stripTags(text)
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []);
}
/** How many of `from`'s words `to` keeps in the same order: their longest common subsequence. */
function keptInOrder(from, to) {
    let row = new Array(to.length + 1).fill(0);
    for (const word of from) {
        const next = [0];
        for (let j = 0; j < to.length; j++) {
            next.push(word === to[j]
                ? (row[j] ?? 0) + 1
                : Math.max(row[j + 1] ?? 0, next[j] ?? 0));
        }
        row = next;
    }
    return row[to.length] ?? 0;
}
function minutesBetween(from, to) {
    return (Date.parse(to) - Date.parse(from)) / 60_000;
}
/** The teams a ranking places away from its starting order, and by how many places in all. */
function moves(ranking) {
    const start = ranking.meta.starting_order;
    let movedTeams = 0;
    let placesMoved = 0;
    ranking.entries
        .filter((e) => e.kind === "team")
        .forEach((e, i) => {
        const from = start.indexOf(e.team);
        if (from === -1 || from === i)
            return;
        movedTeams += 1;
        placesMoved += Math.abs(from - i);
    });
    return { movedTeams, placesMoved };
}
//# sourceMappingURL=demand-test.js.map