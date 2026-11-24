import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, setFrontMatterKey, setFrontMatterValue, WorkspaceFileError, writeFrontMatter, } from "./front-matter.js";
import { personaRecordSchema } from "./persona.js";
import { powerScoreRecordSchema } from "./power-score.js";
/** A ranking file's front matter. Its shape is versioned by `FORMAT`. */
export const metaSchema = z.object({
    season: z.number().int(),
    week: z.number().int().nonnegative(),
    /**
     * The in-progress week a draft made with `--include-in-progress` lets in:
     * its stats are evidence, and each claim citing them is provisional.
     */
    in_progress_week: z.number().int().positive().optional(),
    pundit: z.string(),
    data_as_of: z.string(),
    checked_at: z.string(),
    snapshot: z.string(),
    /** The snapshots the draft stood on before each refresh moved it, oldest first. */
    earlier_snapshots: z.array(z.string()).optional(),
    /** The data hash of the snapshot through the ranking week (`dataHash`). */
    data_hash: z.string().regex(/^[0-9a-f]{64}$/),
    starting_order: z.array(z.string()),
    /** The power-score method the starting order came from, with its weights for the week. */
    power_score: powerScoreRecordSchema,
    /** The persona the draft was written in. */
    persona: personaRecordSchema,
    /**
     * Each house rule's outcome by rule ID, when the draft began and, in a
     * frozen copy, as it stood at the last publish, so a later load can warn
     * about an outcome changed in place.
     */
    house_rule_outcomes: z.record(z.string(), z.string()).optional(),
    created_at: z.string(),
    /** A frozen copy's edition: 1 on the first publish, one more on each republish. */
    edition: z.number().int().positive().optional(),
    /** A frozen copy's first publish time, kept by each republish. */
    first_published_at: z.string().optional(),
    /** How many hard and soft blurb problems a frozen copy was published with. */
    blurb_problems: z
        .object({
        hard: z.number().int().nonnegative(),
        soft: z.number().int().nonnegative(),
    })
        .optional(),
    /**
     * A frozen copy's record of `league.md`'s Log entries for its week and
     * earlier, taken on each publish, so a later load can warn of one changed or
     * removed since. A frozen copy from before it has none, and gives no warning.
     */
    log_entries: z
        .array(z.object({
        week: z.number().int().positive(),
        rule: z.string().optional(),
        text: z.string(),
    }))
        .optional(),
});
/** A ranking file that can't be read or doesn't place every team once. */
export class RankingFileError extends WorkspaceFileError {
    name = "RankingFileError";
    problems;
    constructor(file, problems) {
        super(`${file}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
        this.problems = problems;
    }
}
/**
 * The season's last published ranking (`week-NN.published.md`) of a week
 * before `before`, or none before the first publish. One that can't be read is
 * refused, never passed over for an earlier one, with the fix: mend it, or
 * delete it and the next earlier frozen copy is read.
 */
export async function lastPublished(dir, before) {
    const files = await readdir(dir).catch(() => []);
    const last = files
        .map((name) => ({
        name,
        week: Number(/^week-(\d+)\.published\.md$/.exec(name)?.[1]),
    }))
        .filter((f) => f.week < before)
        .sort((a, b) => b.week - a.week)[0];
    if (!last)
        return undefined;
    const text = await readFile(join(dir, last.name), "utf8");
    try {
        return { week: last.week, ranking: parseRanking(last.name, text) };
    }
    catch (cause) {
        if (!(cause instanceof WorkspaceFileError))
            throw cause;
        throw new WorkspaceFileError(`${cause.message}\nFix ${last.name}, or delete it, and the frozen copy before it becomes the movement baseline.`, { cause });
    }
}
/**
 * The front matter of the season's newest frozen copy of a week up to and
 * including `through`, which `league.md`'s load warnings compare with. None
 * before the first publish, or when that frozen copy can't be read: it then
 * gives no warning rather than stopping the command.
 */
export async function lastPublishedMeta(dir, through) {
    try {
        const last = await lastPublished(dir, through + 1);
        return last && { week: last.week, meta: last.ranking.meta };
    }
    catch (error) {
        if (error instanceof WorkspaceFileError)
            return undefined;
        throw error;
    }
}
/**
 * A frozen copy of a checked draft's `text`: the same text, word for word, with
 * only the publish record's lines (`edition`, `first_published_at`,
 * `blurb_problems`, `log_entries`, and `house_rule_outcomes` when an outcome
 * changed since the draft) added or changed.
 */
export function frozenCopy(file, text, record) {
    readFrontMatter(file, text, "format"); // Refuses the wrong format version.
    const withEdition = setFrontMatterKey(file, text, "edition", record.edition);
    const withFirst = setFrontMatterValue(file, withEdition, "first_published_at", record.firstPublishedAt);
    const withProblems = setFrontMatterValue(file, withFirst, "blurb_problems", record.blurbProblems);
    const withLog = setFrontMatterValue(file, withProblems, "log_entries", record.logEntries);
    return record.houseRuleOutcomes
        ? setFrontMatterValue(file, withLog, "house_rule_outcomes", record.houseRuleOutcomes)
        : withLog;
}
/** A new draft: the intro, then the starting order, each team with its blurb. */
export function renderDraft(meta, league, order, prose) {
    const teams = new Map(league.teams.map((t) => [t.id, t]));
    const sections = order.map((id) => {
        const team = teams.get(id);
        if (!team)
            throw new Error(`No team ${id} in the league`);
        const blurb = prose.blurbs[id];
        return `## ${team.name} {team=${id}}\n${blurb ? `${blurb}\n` : ""}`;
    });
    if (prose.intro)
        sections.unshift(`## Intro {intro}\n${prose.intro}\n`);
    return `${writeFrontMatter({ ...meta }, ["starting_order", "power_score"])}\n${sections.join("\n")}`;
}
const HEADING = /^(#{1,2})\s+(.*?)\s*$/;
const TAGGED = /^(.*?)\s*\{([^{}]*)\}$/;
/** Reads a ranking file, refusing an unknown format version. */
export function parseRanking(file, text) {
    const { data, body, bodyLine } = readFrontMatter(file, text, "format");
    const meta = metaSchema.safeParse(data);
    if (!meta.success) {
        throw new WorkspaceFileError(`${file}: ${z.prettifyError(meta.error)}`);
    }
    const problems = [];
    const entries = [];
    /** Each section's lines as written, and where its first line starts. */
    const sections = new Map();
    let current;
    let offset = text.length - body.length;
    // Split on "\n" alone so a section's lines rejoin to the file text exactly.
    body.split("\n").forEach((raw, i) => {
        const line = bodyLine + i;
        const next = offset + raw.length + 1;
        const heading = HEADING.exec(raw);
        const open = (key) => {
            current = [];
            sections.set(key, { from: next, lines: current });
        };
        offset = next;
        if (!heading) {
            if (current)
                current.push(raw);
            else if (raw.trim()) {
                problems.push(`line ${line}: text outside any section`);
            }
            return;
        }
        current = undefined;
        const [, hashes, rest = ""] = heading;
        if (hashes === "#") {
            entries.push({ kind: "group", label: rest, line });
            return;
        }
        const [, label = rest, tag = ""] = TAGGED.exec(rest) ?? [];
        if (tag.trim() === "intro") {
            if (entries.length > 0 || sections.has("intro")) {
                problems.push(`line ${line}: the intro goes once, before the first team or group`);
                return;
            }
            open("intro");
            return;
        }
        const team = /^team=(\S+)$/.exec(tag.trim())?.[1];
        if (!team) {
            problems.push(`line ${line}: section "${rest}" has no {team=…} or {intro} tag`);
            return;
        }
        const entry = {
            kind: "team",
            team,
            label,
            blurb: "",
            blurbStart: 0,
            line,
        };
        entries.push(entry);
        open(entry);
    });
    if (problems.length > 0)
        throw new RankingFileError(file, problems);
    /** A section's text, trimmed, and where it starts in the file text. */
    const content = (key) => {
        const s = sections.get(key);
        const joined = (s?.lines ?? []).join("\n");
        const lead = joined.length - joined.trimStart().length;
        return { text: joined.trim(), start: (s?.from ?? 0) + lead };
    };
    const intro = content("intro");
    return {
        meta: meta.data,
        ...(intro.text ? { intro: intro.text, introStart: intro.start } : {}),
        entries: entries.map((e) => {
            if (e.kind !== "team")
                return e;
            const { text: blurb, start: blurbStart } = content(e);
            return { ...e, blurb, blurbStart };
        }),
    };
}
/**
 * Checks that the file places every team in the league exactly once. Problems
 * are reported, never fixed: the pundit owns the order.
 */
export function checkOrder(file, ranking, league) {
    const names = new Map(league.teams.map((t) => [t.id, t.name]));
    const seen = new Map();
    for (const entry of ranking.entries) {
        if (entry.kind !== "team")
            continue;
        seen.set(entry.team, [...(seen.get(entry.team) ?? []), entry]);
    }
    const problems = [];
    for (const [team, entries] of seen) {
        const first = entries[0];
        if (!names.has(team)) {
            problems.push(`line ${first.line}: unknown team ${first.label} {team=${team}}; no team in the ${league.season} league has that ID`);
        }
        else if (entries.length > 1) {
            const lines = entries.map((e) => e.line);
            problems.push(`${names.get(team)} {team=${team}} is placed more than once, at lines ${lines.slice(0, -1).join(", ")} and ${lines.at(-1)}`);
        }
    }
    for (const [team, name] of names) {
        if (!seen.has(team)) {
            problems.push(`missing team ${name} {team=${team}}; add a "## ${name} {team=${team}}" section where it belongs`);
        }
    }
    if (problems.length > 0)
        throw new RankingFileError(file, problems);
}
//# sourceMappingURL=ranking-file.js.map