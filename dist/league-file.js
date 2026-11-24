import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.js";
import { HEADING, headingName, refuseLocalLines, withoutComments, } from "./lore.js";
import { TRIGGER_KINDS, } from "./stakes.js";
import { seasonDir } from "./workspace.js";
/** Where the season's `league.md` lives. */
export function leagueFilePath(ws) {
    return join(seasonDir(ws), "league.md");
}
const DOLLARS = /^\$(\d+(?:\.\d{1,2})?)$/;
const SHARE = /^(\d+(?:\.\d+)?)%$/;
const FAAB = /^(\d+)\s*FAAB$/i;
const RULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEASON_ONLY = new Set(["last-place", "champion"]);
const week = z.number().int().min(1);
const houseRuleSchema = z
    .strictObject({
    id: z.string().regex(RULE_ID, {
        error: "an id is lower-case letters, digits and dashes, such as high-score",
    }),
    name: z.string().min(1),
    trigger: z
        .enum(TRIGGER_KINDS, {
        error: `a trigger is one of ${TRIGGER_KINDS.join(", ")}`,
    })
        .optional(),
    per: z.enum(["week", "season"]).optional(),
    outcome: z
        .union([z.string(), z.number()])
        .refine((o) => String(o).trim() !== "", {
        error: "write the outcome: dollars such as $10, FAAB such as 5 FAAB, or words",
    })
        .refine((o) => !/[{}]/.test(String(o)), {
        error: "an outcome can't hold a brace",
    }),
    spirit: z
        .enum(["serious", "joke"], { error: 'spirit is "serious" or "joke"' })
        .optional(),
    from: week.optional(),
    until: week.optional(),
})
    .superRefine((r, ctx) => {
    if (r.trigger && SEASON_ONLY.has(r.trigger) && r.per === "week") {
        ctx.addIssue({
            code: "custom",
            message: `${r.id}: a ${r.trigger} trigger is per season, not per week`,
        });
    }
    if (r.per && !r.trigger) {
        ctx.addIssue({
            code: "custom",
            message: `${r.id}: per: needs a trigger`,
        });
    }
    if (r.from !== undefined && r.until !== undefined && r.until < r.from) {
        ctx.addIssue({
            code: "custom",
            message: `${r.id}: until: week ${r.until} comes before from: week ${r.from}`,
        });
    }
});
const HANDLE = z.string().regex(/^[^\s{}=]+$/, {
    error: "a rivalry names managers by handle, such as bo",
});
const rivalryWeekSchema = z
    .strictObject({
    week,
    pairs: z.array(z.tuple([HANDLE, HANDLE])).min(1),
})
    .superRefine((r, ctx) => {
    const seen = new Set();
    for (const [a, b] of r.pairs) {
        if (a === b) {
            ctx.addIssue({
                code: "custom",
                message: `rivalry week ${r.week} pairs ${a} with itself`,
            });
        }
        for (const h of [a, b]) {
            if (seen.has(h) && a !== b) {
                ctx.addIssue({
                    code: "custom",
                    message: `rivalry week ${r.week} names ${h} in two pairs`,
                });
            }
            seen.add(h);
        }
    }
});
/** `league.md`'s front matter. Its shape is versioned by `FORMAT`. */
export const leagueFileSchema = z
    .strictObject({
    league: z.literal(1),
    season: z.union([z.string(), z.number()]).optional(),
    "family-league": z
        .enum(["on", "off"], { error: 'family-league is "on" or "off"' })
        .optional(),
    stakes: z
        .literal("none", { error: 'stakes is "none" or left out' })
        .optional(),
    "buy-in": z
        .string()
        .regex(DOLLARS, { error: "the buy-in is dollars per team, such as $50" })
        .optional(),
    payouts: z
        .array(z.string().refine((p) => DOLLARS.test(p) || SHARE.test(p), {
        error: (i) => `"${String(i.input)}" isn't a payout: give dollars, such as $100, or a share of the pot, such as 70%`,
    }))
        .optional(),
    "last-place": z.enum(["standings", "losers-bracket"]).optional(),
    "house-rules": z.array(houseRuleSchema).optional(),
    "rivalry-weeks": z.array(rivalryWeekSchema).optional(),
})
    .superRefine((f, ctx) => {
    const fields = STAKES_FIELDS.filter((k) => f[k] !== undefined);
    if (f.stakes === "none" && fields.length > 0) {
        ctx.addIssue({
            code: "custom",
            message: `stakes: none means bragging rights only, so it can't sit beside ${fields.join(", ")}`,
        });
    }
    const shares = (f.payouts ?? [])
        .map((p) => SHARE.exec(p)?.[1])
        .reduce((a, s) => a + Number(s ?? 0), 0);
    if (shares > 100) {
        ctx.addIssue({
            code: "custom",
            message: `the payouts' shares come to ${shares}%, more than the whole pot`,
        });
    }
    const seen = new Set();
    for (const r of f["house-rules"] ?? []) {
        if (seen.has(r.id)) {
            ctx.addIssue({
                code: "custom",
                message: `house rule ${r.id} is there twice: give each rule its own id`,
            });
        }
        seen.add(r.id);
    }
    const weeks = new Set();
    for (const r of f["rivalry-weeks"] ?? []) {
        if (weeks.has(r.week)) {
            ctx.addIssue({
                code: "custom",
                message: `rivalry week ${r.week} is there twice: list all its pairs under one week`,
            });
        }
        weeks.add(r.week);
    }
});
const STAKES_FIELDS = [
    "buy-in",
    "payouts",
    "last-place",
    "house-rules",
    "rivalry-weeks",
];
/**
 * Reads a `league.md`'s text, refusing unknown keys, unknown tags and
 * malformed stakes. `handles` are `workspace.md`'s, which a rivalry week's
 * handles resolve through.
 */
export function readLeagueFile(text, handles = {}) {
    const { data, body, bodyLine } = readFrontMatter("league.md", text, "league");
    const parsed = leagueFileSchema.safeParse(data);
    if (!parsed.success) {
        throw new WorkspaceFileError(`league.md: ${z.prettifyError(parsed.error)}`);
    }
    const f = parsed.data;
    const ruleIds = new Set((f["house-rules"] ?? []).map((r) => r.id));
    const read = readBody(body, bodyLine, ruleIds);
    if (f.stakes === "none" &&
        (read.sections.length > 0 || read.log.length > 0)) {
        throw new WorkspaceFileError("league.md: stakes: none means bragging rights only, so the body can't hold rules or a Log: remove them, or stakes: none");
    }
    return {
        familyLeague: f["family-league"] === "on",
        stakes: stakesOf(f, read, handles),
        warnings: read.warnings,
    };
}
/** The season's `league.md`; a missing file has the family league off and the stakes unrecorded. */
export async function loadLeagueFile(ws) {
    let text;
    try {
        text = await readFile(leagueFilePath(ws), "utf8");
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
        return {
            familyLeague: false,
            stakes: { kind: "unrecorded" },
            warnings: [],
        };
    }
    return readLeagueFile(text, ws.handles);
}
const TAGS = /\{[^{}]*\}/g;
const LOG_TAGS = /^((?:\{[^{}]*\})+)\s*(.*)$/;
/**
 * The body's free-text rules by heading and its `## Log`. Comments aren't
 * read, but a `{local}` anywhere stops the load, so it never fails open.
 */
function readBody(body, bodyLine, ruleIds) {
    refuseLocalLines("league.md", body
        .split(/\r?\n/)
        .flatMap((line, i) => (line.includes("{local}") ? [bodyLine + i] : [])));
    const out = { sections: [], log: [], warnings: [] };
    const unknown = [];
    const lines = [];
    let section;
    withoutComments(body)
        .split(/\r?\n/)
        .forEach((raw, i) => {
        const text = raw.trim();
        const at = bodyLine + i;
        const heading = HEADING.exec(text)?.[1];
        if (heading !== undefined) {
            for (const [tag] of heading.matchAll(TAGS))
                unknown.push(`line ${at}: ${tag}`);
            const name = headingName(heading);
            if (!name) {
                throw new WorkspaceFileError(`league.md line ${at}: this heading has no words a {stakes=…} tag could cite`);
            }
            const earlier = lines.find((l) => l.name === name);
            if (earlier) {
                throw new WorkspaceFileError(`league.md has two sections named ${name}, on lines ${earlier.line} and ${at}`);
            }
            lines.push({ name, line: at });
            if (name === "log") {
                section = "log";
            }
            else {
                section = { name, entries: [] };
                out.sections.push(section);
            }
            return;
        }
        if (!text || /^(?:[-*_]{3,}|#\s.*)$/.test(text))
            return; // A rule or a title.
        const item = text.replace(/^[-*]\s+/, "");
        if (section === undefined) {
            out.warnings.push(`league.md line ${at} is above the first ## heading, so it isn't sent. Move it under a heading.`);
        }
        else if (section === "log") {
            out.log.push(logEntry(item, at, ruleIds, unknown));
        }
        else {
            for (const [tag] of item.matchAll(TAGS))
                unknown.push(`line ${at}: ${tag}`);
            section.entries.push(item);
        }
    });
    if (unknown.length > 0) {
        throw new WorkspaceFileError(`league.md has tags this version doesn't know, so remove each one (a Log entry starts with {week=N}, then {rule=<id>} and {pinned} if wanted): ${unknown.join(", ")}`);
    }
    out.sections = out.sections.filter((s) => s.entries.length > 0);
    return out;
}
/** One `## Log` bullet: `{week=N}`, then `{rule=<id>}` and `{pinned}` if wanted, then its text. */
function logEntry(item, at, ruleIds, unknown) {
    const [, tags = "", text = ""] = LOG_TAGS.exec(item) ?? [];
    const entry = { pinned: false };
    for (const [tag] of tags.matchAll(TAGS)) {
        const week = /^\{week=(\d+)\}$/.exec(tag)?.[1];
        const rule = /^\{rule=([^{}\s]+)\}$/.exec(tag)?.[1];
        if (week !== undefined && entry.week === undefined && Number(week) >= 1) {
            entry.week = Number(week);
        }
        else if (rule !== undefined && entry.rule === undefined) {
            if (!ruleIds.has(rule)) {
                throw new WorkspaceFileError(`league.md line ${at}: {rule=${rule}} names no house rule; use a house rule's id`);
            }
            entry.rule = rule;
        }
        else if (tag === "{pinned}" && !entry.pinned) {
            entry.pinned = true;
        }
        else {
            unknown.push(`line ${at}: ${tag}`);
        }
    }
    for (const [tag] of text.matchAll(TAGS))
        unknown.push(`line ${at}: ${tag}`);
    if (entry.week === undefined) {
        throw new WorkspaceFileError(`league.md line ${at}: a Log entry starts with the week it's about, as {week=N}`);
    }
    return { ...entry, week: entry.week, text: text.trim() };
}
/** Whether the season's `league.md` turns the family league on. A missing file means off. */
export async function familyLeague(ws) {
    return (await loadLeagueFile(ws)).familyLeague;
}
function stakesOf(f, body, handles) {
    if (f.stakes === "none")
        return { kind: "none" };
    if (STAKES_FIELDS.every((k) => f[k] === undefined) &&
        body.sections.length === 0 &&
        body.log.length === 0)
        return { kind: "unrecorded" };
    const rival = (handle) => ({
        handle,
        accounts: handles[handle] ?? [],
    });
    const buyIn = f["buy-in"];
    return {
        kind: "recorded",
        ...(buyIn === undefined ? {} : { buyIn: Number(DOLLARS.exec(buyIn)?.[1]) }),
        payouts: (f.payouts ?? ["100%"]).map(payoutOf),
        lastPlace: f["last-place"] ?? "standings",
        houseRules: (f["house-rules"] ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            ...(r.trigger
                ? {
                    trigger: {
                        kind: r.trigger,
                        per: r.per ?? (SEASON_ONLY.has(r.trigger) ? "season" : "week"),
                    },
                }
                : {}),
            outcome: outcomeOf(String(r.outcome).trim()),
            ...(r.spirit === undefined ? {} : { spirit: r.spirit }),
            ...(r.from === undefined ? {} : { from: r.from }),
            ...(r.until === undefined ? {} : { until: r.until }),
        })),
        rivalryWeeks: (f["rivalry-weeks"] ?? []).map((r) => ({
            week: r.week,
            pairs: r.pairs.map(([a, b]) => [rival(a), rival(b)]),
        })),
        sections: body.sections,
        log: body.log,
    };
}
function payoutOf(p) {
    const dollars = DOLLARS.exec(p)?.[1];
    return dollars !== undefined
        ? { dollars: Number(dollars) }
        : { share: Number(SHARE.exec(p)?.[1]) };
}
/** `$N` is dollars, `N FAAB` is FAAB, anything else is words. */
export function outcomeOf(text) {
    const dollars = DOLLARS.exec(text)?.[1];
    if (dollars !== undefined)
        return { kind: "dollars", amount: Number(dollars), text };
    const faab = FAAB.exec(text)?.[1];
    if (faab !== undefined)
        return { kind: "faab", amount: Number(faab), text };
    return { kind: "text", text };
}
//# sourceMappingURL=league-file.js.map