import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.js";
import { teamsOfAccounts, } from "./league.js";
import { stakesSectionNames, UNRECORDED } from "./stakes.js";
import { normalize, wholeWords } from "./validator.js";
/** `lore.md`'s front matter. Its shape is versioned by `FORMAT`. */
export const loreSchema = z.strictObject({ lore: z.number() });
const LEAGUE_TYPES = ["work", "family", "friends", "other"];
/**
 * Reads the workspace's `lore.md`, refusing an unknown tag or a malformed
 * reserved line. With no file, the lore is empty. Markdown comments aren't
 * lore: their tags mean nothing and their text is no entry.
 */
export async function loadLore(ws) {
    let text;
    try {
        text = await readFile(join(ws.dir, "lore.md"), "utf8");
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
        return { sections: [], localLines: [], warnings: [] };
    }
    const { data, body, bodyLine } = readFrontMatter("lore.md", text, "lore");
    const parsed = loreSchema.safeParse(data);
    if (!parsed.success) {
        throw new WorkspaceFileError(`lore.md: ${z.prettifyError(parsed.error)}`);
    }
    const lines = withoutComments(body)
        .split(/\r?\n/)
        .map((raw, i) => ({ text: raw.trim(), at: bodyLine + i }));
    refuseUnknownTags(lines);
    const lore = {
        sections: [],
        // Commented or not: a marker beside an entry must never fail open.
        localLines: body.split(/\r?\n/).flatMap((line, i) => {
            return line.includes("{local}") ? [bodyLine + i] : [];
        }),
        warnings: [],
    };
    const personal = personalDataWarning(lines);
    if (personal)
        lore.warnings.push(personal);
    let section;
    for (const { text: line, at } of lines) {
        const heading = HEADING.exec(line)?.[1];
        if (heading !== undefined) {
            section = newSection(heading, at, lore.sections);
            lore.sections.push(section);
            continue;
        }
        if (/^(?:[-*_]{3,}|#\s.*)$/.test(line))
            continue; // A rule or a title.
        const item = line.replace(/^[-*]\s+/, "");
        const nicknames = /^nicknames:(.*)$/i.exec(item)?.[1];
        if (nicknames !== undefined) {
            addNicknames(section, nicknames, at);
        }
        else if (section?.name === "league" && /^type:/i.test(item)) {
            lore.type = leagueType(item.slice("type:".length).trim(), lore, at);
        }
        else if (section && item) {
            section.entries.push(item);
        }
        else if (item) {
            lore.warnings.push(`lore.md line ${at} is above the first ## heading, so it isn't sent. Move it under a heading.`);
        }
    }
    return lore;
}
const MONTH = "\\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b\\.?";
const ORDINAL = "(?:st|nd|rd|th)?";
const BIRTH_WORD = "(?:\\b(?:born|dob|d\\.o\\.b|birthday|birth date|date of birth)\\b|\\bb\\.\\s*\\d)";
const BIRTH_DATE = `(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|\\d{1,2}[.-]\\d{1,2}[.-]\\d{2,4}|${MONTH}\\s+\\d{1,2}${ORDINAL}\\b|${MONTH}\\s+\\d{4}\\b|\\b\\d{1,2}${ORDINAL}\\s+(?:of\\s+)?${MONTH})`;
const STREET_WORDS = "Street|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Crescent";
/**
 * What the personal-data warning looks for, each shape on its own. They warn
 * rather than stop, so a date beside "born" counts wherever it sits on the
 * line, while the shapes of scores and records stay out.
 */
const PERSONAL_DATA = [
    {
        kind: "phone number",
        shape: /(?<![\d.-])(?:\+\d{1,3}[\s.-]?(?:\d{1,4}[\s.-]?){2,4}\d{2,4}|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|0\d{3,4}[\s-]\d{5,6}|\d{3}[-.]\d{4})(?![\d-]|\.\d)/,
    },
    { kind: "email", shape: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
    {
        kind: "street address",
        // "St." before a capital is a player's name, as in Amon-Ra St. Brown.
        shape: new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:\\p{Lu}[\\p{L}.'-]*\\s+){1,3}(?:(?:${STREET_WORDS})\\b|St\\b(?!\\.\\s+\\p{Lu}))|\\b\\d{1,6}\\s+(?:\\p{Ll}+\\s+){1,3}(?:street|avenue|boulevard)\\b`, "u"),
    },
    {
        kind: "long digit run",
        shape: /\d{8,}|\b\d{3}-\d{2}-\d{4}\b|\b\d{4}(?:[-\s]\d{4}){3}\b/,
    },
    {
        kind: "date of birth",
        shape: new RegExp(`^(?=.*${BIRTH_WORD})(?=.*${BIRTH_DATE})`, "i"),
    },
];
/**
 * The personal-data warning for these lines, if any looks like it holds some.
 * A heading that is a section's own tag holds an ID, not personal data.
 */
function personalDataWarning(lines) {
    const found = lines.flatMap(({ text, at }) => {
        if (SECTION_TAG.test(HEADING.exec(text)?.[1] ?? ""))
            return [];
        return PERSONAL_DATA.filter(({ shape }) => shape.test(text)).map(({ kind }) => `line ${at} (${kind})`);
    });
    if (found.length === 0)
        return undefined;
    return `lore.md may hold personal data: ${found.join(", ")}. Lore is sent to the LLM provider and copied into each LLM transcript, so remove what shouldn't go there; \`lazy-pundit transcripts delete\` removes the copies.`;
}
function refuseUnknownTags(lines) {
    const unknown = [];
    for (const { text, at } of lines) {
        const isSection = SECTION_TAG.test(HEADING.exec(text)?.[1] ?? "");
        for (const [tag] of text.matchAll(/\{[^{}]*\}/g)) {
            if (tag !== "{local}" && !isSection) {
                unknown.push(`line ${at}: ${tag}`);
            }
        }
    }
    if (unknown.length > 0) {
        throw new WorkspaceFileError(`lore.md has tags this version doesn't know, so remove each one (a {manager=<handle>} or {team=<platform>:<id>} is a whole heading): ${unknown.join(", ")}`);
    }
}
/** A `## ` heading line, capturing its text; a `###` is no heading. */
export const HEADING = /^##(?!#)\s*(.*)$/;
const SECTION_TAG = /^\{(?:manager=([^{}\s=]+)|team=([a-z]+:[^{}\s:=]+))\}$/;
/** A comment's text removed, its line breaks kept so line numbers hold. */
export function withoutComments(body) {
    return body.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ""));
}
function newSection(heading, line, sections) {
    const tag = SECTION_TAG.exec(heading);
    const name = tag
        ? tag[1]
            ? `manager:${tag[1]}`
            : `team:${tag[2]}`
        : headingName(heading);
    if (!name) {
        throw new WorkspaceFileError(`lore.md line ${line}: this heading has no words a {lore=…} tag could cite`);
    }
    const earlier = sections.find((s) => s.name === name);
    if (earlier) {
        throw new WorkspaceFileError(`lore.md has two sections named ${name}, on lines ${earlier.line} and ${line}`);
    }
    return { name, line, nicknames: [], entries: [] };
}
/** A heading as a tag can cite it, since a tag holds no spaces. */
export function headingName(heading) {
    return heading
        .replace(/\{[^{}]*\}/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "");
}
function addNicknames(section, line, at) {
    if (!section || !/^(manager|team):/.test(section.name)) {
        throw new WorkspaceFileError(`lore.md line ${at}: nicknames belong in a manager or team section`);
    }
    if (section.nicknames.length > 0) {
        throw new WorkspaceFileError(`lore.md line ${at}: ${section.name} already has its one nicknames: line`);
    }
    section.nicknames = line
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
}
function leagueType(value, lore, at) {
    if (lore.type) {
        throw new WorkspaceFileError(`lore.md line ${at}: the league already has its one type: line`);
    }
    const type = LEAGUE_TYPES.find((t) => t === value);
    if (!type) {
        throw new WorkspaceFileError(`lore.md line ${at}: the league's type is work, family, friends or other, not "${value}"`);
    }
    return type;
}
/** A manager section's handle; any other section has none. */
function handleOf(s) {
    return /^manager:(.*)$/.exec(s.name)?.[1];
}
/** Every name lore gives a manager: each handle and its nicknames. */
export function managerNames(lore) {
    return lore.sections.flatMap((s) => {
        const handle = handleOf(s);
        return handle === undefined ? [] : [handle, ...s.nicknames];
    });
}
/**
 * What a draft may send of the lore, and why anything written was held back.
 * A manager with no team in this league isn't sent: a departed manager's lore
 * is simply kept, and a handle with no link can't be told from one, nor placed
 * on a team, so it's held back with a warning. A section with nothing in it
 * says nothing.
 */
export function sentLore(lore, league, handles) {
    const sections = [];
    const warnings = [];
    for (const s of lore.sections) {
        if (s.nicknames.length === 0 && s.entries.length === 0)
            continue;
        const teams = teamsOf(s, league, handles);
        const handle = handleOf(s);
        if (handle !== undefined && teams.length === 0) {
            if ((handles[handle] ?? []).length === 0) {
                warnings.push(`lore.md line ${s.line}: ${s.name} isn't sent, because workspace.md's handles link ${handle} to no account. Link it, or the LLM won't see this section.`);
            }
            continue;
        }
        const { name, nicknames, entries } = s;
        sections.push({ name, teams, nicknames, entries });
    }
    return {
        lore: { ...(lore.type && { type: lore.type }), sections },
        warnings,
    };
}
/** Stops a draft on any `{local}`: no entry marked so may reach the LLM. */
export function refuseLocal(lore) {
    refuseLocalLines("lore.md", lore.localLines);
}
/** Stops on any `{local}` at these lines of `file`, which isn't supported yet. */
export function refuseLocalLines(file, lines) {
    if (lines.length > 0) {
        throw new WorkspaceFileError(`${file} line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}: local-only isn't supported yet; remove the entry or the marker`);
    }
}
/**
 * The teams in this league a section's nicknames count for: a team section's
 * own team, or the teams a manager section's handle runs through its linked
 * accounts. A departed manager, or a handle with no link, has none.
 */
function teamsOf(s, league, handles) {
    const manager = handleOf(s);
    if (manager !== undefined) {
        return teamsOfAccounts(league, handles[manager] ?? []);
    }
    const team = /^team:(.*)$/.exec(s.name)?.[1];
    return league.teams.filter((t) => t.id === team).map((t) => t.id);
}
/**
 * Every team's names for the validator: its name, its managers' display names
 * and lore's nicknames, plus the lore sections a tag may cite. A nickname that
 * would read as two holders' is a load error naming both, unless they come to
 * one team, as a manager and their own team do. Given `onLeagueClash`, one
 * that reads as another team's name is told to it and left out instead, since
 * that league can't be edited and the name counts only for its own team.
 */
export function validatorNames(lore, league, handles, stakes = UNRECORDED, onLeagueClash) {
    const nicknames = Object.fromEntries(league.teams.map((t) => [
        t.id,
        [t.name, ...t.managers.map((m) => m.displayName)],
    ]));
    const taken = league.teams.flatMap((t) => (nicknames[t.id] ?? []).map((name) => ({ name, team: t })));
    const written = [];
    for (const s of lore.sections) {
        const teams = teamsOf(s, league, handles);
        for (const n of s.nicknames) {
            const held = written.find((w) => w.holder !== s.name &&
                !comeToOneTeam(w.teams, teams) &&
                readAsOne(w.name, n));
            if (held)
                throwClash({ nickname: n, section: held.holder, team: s.name });
            const other = taken.find(({ name, team }) => !teams.includes(team.id) && readAsOne(name, n));
            if (other) {
                const clash = {
                    nickname: n,
                    section: s.name,
                    team: `${other.team.name} (${other.team.id})`,
                };
                if (!onLeagueClash)
                    throwClash(clash);
                onLeagueClash(clash);
                continue;
            }
            written.push({ name: n, holder: s.name, teams });
            for (const team of teams)
                nicknames[team]?.push(n);
        }
    }
    return {
        nicknames,
        sections: {
            lore: lore.sections.map((s) => s.name),
            ...stakesSectionNames(stakes),
        },
        ...(stakes.kind === "none" ? { noStakes: true } : {}),
    };
}
/** Whether two holders mean the same team; holders with no team don't. */
function comeToOneTeam(a, b) {
    return a.length > 0 && a.length === b.length && a.every((t) => b.includes(t));
}
/**
 * Whether a sentence using one name also reads as the other: they're the same,
 * or one holds the other as whole words, as "Bench Mob" holds "Mob".
 */
function readAsOne(a, b) {
    const [x, y] = [normalize(a), normalize(b)];
    return wholeWords(x).test(y) || wholeWords(y).test(x);
}
/** The start of every clash's message: the nickname and both holders. */
export function clashText(c) {
    return `lore.md: the nickname "${c.nickname}" points at both ${c.section} and ${c.team}`;
}
/** What a command with fresh data says of a clash that `draft` would stop on. */
export function freshClashWarning(c) {
    return `${clashText(c)} in the fresh data. Keep it on one: \`draft\`, and \`refresh\` onto changed data, stop on it`;
}
function throwClash(c) {
    throw new WorkspaceFileError(`${clashText(c)}; keep it on one`);
}
//# sourceMappingURL=lore.js.map