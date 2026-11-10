import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { draftData } from "./draft-data.js";
import { refuseUneditableFrontMatter, WorkspaceFileError, } from "./front-matter.js";
import { loadLeagueFile } from "./league-file.js";
import { clashText, loadLore, validatorNames, } from "./lore.js";
import { movementBaseline, moveOf, orderEvidence, } from "./movement.js";
import { isSmallSample } from "./power-score.js";
import { checkOrder, lastPublishedMeta, parseRanking, } from "./ranking-file.js";
import { normalizeSleeper } from "./sleeper/normalizer.js";
import { readSnapshot, SnapshotDamagedError, } from "./snapshot.js";
import { leagueFileChangeWarnings, stakesWarnings, } from "./stakes.js";
import { applyAutoTags, isHard, stripTags, validate, } from "./validator.js";
import { rankingsDir, readWorkspace, snapshotsDir, weekStem, } from "./workspace.js";
import { writeWorkspaceFile } from "./workspace-files.js";
/**
 * Re-checks the latest draft: every blurb and the intro against the evidence
 * pack and the order as it stands, writing auto-tags back without changing
 * a word. Problems are reported, never fixed.
 */
export async function check(workspaceDir, _deps) {
    const { week, path, problems, autoTagged, warnings } = await checkDraft(workspaceDir);
    return { week, path, problems, autoTagged, warnings };
}
/**
 * Reads, checks and auto-tags the latest draft in the workspace's season.
 * With `autoTag: false` the file is left alone, and an untagged claim that
 * could be auto-tagged is simply verified.
 */
export async function checkDraft(workspaceDir, opts = {}) {
    const ws = await readWorkspace(workspaceDir);
    const dir = rankingsDir(ws);
    const week = await latestDraftWeek(dir);
    const stem = weekStem(week);
    const name = `${stem}.md`;
    const path = join(dir, name);
    const written = await readDraft(path, name);
    const ranking = parseRanking(name, written);
    // publish and refresh edit the front matter, so refuse what they can't edit.
    refuseUneditableFrontMatter(name, written);
    const league = normalizeSleeper(await readDraftSnapshot(snapshotsDir(ws), ranking.meta.snapshot, name));
    checkOrder(name, ranking, league);
    const { stakes, warnings: leagueFileWarnings } = await loadLeagueFile(ws);
    const { evidence } = draftData(league, ranking.meta.week, stakes, ranking.meta.in_progress_week);
    const baseline = await movementBaseline(dir, week);
    const order = orderEvidence(ranking, baseline);
    const startingOrder = Object.fromEntries(ranking.meta.starting_order.map((team, i) => [
        team,
        { place: i + 1, move: moveOf(baseline, team, i + 1) },
    ]));
    const lore = await loadLore(ws);
    // The snapshot's names can't be edited, so a nickname that clashes with one
    // is left out and warned of rather than stopping the check.
    const clashes = [];
    const names = validatorNames(lore, league, ws.handles, stakes, (c) => clashes.push(c));
    const clashWarnings = clashes.map((c) => `${clashText(c)} in ${name}'s snapshot, so this check counts it for ${c.team} only. Remove it from ${c.section} to clear this; \`draft\`, and \`refresh\` onto changed data, stop on it while the platform has that name`);
    const { problems, autoTags } = reviewProse({
        text: written,
        ranking,
        league,
        evidence,
        order,
        validatorNames: names,
        before: {
            order: startingOrder,
            evidence: await earlierEvidence(ws, ranking, stakes),
        },
    });
    problems.push(...movedTeams(ranking, order, startingOrder, teamNames(league)), ...(isSmallSample(week) ? [smallSampleFlag(week)] : []), ...(week > 0 ? [correctionTiming(league)] : []));
    problems.sort(byHardThenLine);
    const tagging = opts.autoTag !== false && autoTags.length > 0;
    let text = written;
    if (tagging) {
        text = applyAutoTags(written, autoTags);
        await writeWorkspaceFile(path, text);
    }
    return {
        week,
        path,
        problems,
        autoTagged: tagging ? autoTags.length : 0,
        warnings: [
            ...lore.warnings,
            ...clashWarnings,
            ...leagueFileWarnings,
            ...stakesWarnings(stakes, league),
            ...leagueFileChangeWarnings(stakes, await lastPublishedMeta(dir, week)),
        ],
        stem,
        dir,
        text,
        ranking: tagging ? parseRanking(name, text) : ranking,
        league,
        lore,
        stakes,
        handles: ws.handles,
        order,
        ...(baseline ? { baseline } : {}),
        clashWarnings,
    };
}
/**
 * The claims in a checked draft that hold on the data of `from` and fail on the
 * data of `to`: the ones a move between the two makes stale. A nickname that
 * clashes with a name in `to` is left out, as `checkDraft` leaves one out.
 */
export function claimsGoingStale(checked, from, to) {
    const { week, in_progress_week } = checked.ranking.meta;
    const evidenceOf = (league) => draftData(league, week, checked.stakes, in_progress_week).evidence;
    const { problems } = reviewProse({
        text: checked.text,
        ranking: checked.ranking,
        league: to,
        evidence: evidenceOf(to),
        order: checked.order,
        validatorNames: validatorNames(checked.lore, to, checked.handles, checked.stakes, () => undefined),
        before: { evidence: [evidenceOf(from)] },
    });
    return problems.filter((p) => p.kind === "stale" && p.cause === "refresh");
}
/**
 * The evidence from a refreshed draft's earlier snapshots, newest first, so a
 * claim true when written reads as stale rather than wrong. A snapshot that's
 * gone or no longer normalizes never blocks a check: it's just left out, and a
 * claim that only it could vouch for reads as wrong.
 */
async function earlierEvidence(ws, ranking, stakes) {
    const packs = [];
    for (const id of (ranking.meta.earlier_snapshots ?? []).toReversed()) {
        try {
            const league = normalizeSleeper(await readSnapshot(snapshotsDir(ws), id));
            const { week, in_progress_week } = ranking.meta;
            packs.push(draftData(league, week, stakes, in_progress_week).evidence);
        }
        catch {
            // Left out, as above.
        }
    }
    return packs;
}
function teamNames(league) {
    return new Map(league.teams.map((t) => [t.id, t.name]));
}
/** Validates the intro and every blurb in a draft's `text` against `evidence`. */
function reviewProse(input) {
    const { text: written, ranking, league, evidence, order, before } = input;
    const names = teamNames(league);
    const sections = [];
    if (ranking.intro !== undefined) {
        sections.push({
            team: null,
            text: ranking.intro,
            start: ranking.introStart ?? 0,
        });
    }
    for (const e of ranking.entries) {
        if (e.kind === "team" && e.blurb) {
            sections.push({
                team: e.team,
                text: e.blurb,
                start: e.blurbStart,
            });
        }
    }
    const problems = [];
    const autoTags = [];
    // Provisional while the week the draft let in is still unscored in its data.
    const recorded = ranking.meta.in_progress_week;
    const inProgress = league.weeks.some((w) => w.week === recorded && !w.scored)
        ? recorded
        : undefined;
    const lineAt = (offset) => written.slice(0, offset).split("\n").length;
    for (const s of sections) {
        const result = validate({
            text: s.text,
            team: s.team,
            evidence,
            order,
            ...input.validatorNames,
            // The persona the draft was written in, not today's persona.md.
            swearing: ranking.meta.persona.swearing,
            before,
        });
        const at = {
            team: s.team,
            section: s.team ? (names.get(s.team) ?? s.team) : "Intro",
        };
        for (const c of result.claims) {
            if (c.status === "verified") {
                // An untagged score cites its two halves through its auto-tags.
                const cited = c.id
                    ? [c.id]
                    : result.autoTags
                        .filter((t) => c.start <= t.start && t.end <= c.end)
                        .map((t) => t.id);
                const id = cited.find((i) => i.startsWith(`w${inProgress}.`));
                if (inProgress && id) {
                    problems.push({
                        ...at,
                        severity: "soft",
                        line: lineAt(s.start + c.start),
                        text: c.text,
                        kind: "provisional",
                        reason: `week ${inProgress} is still in progress, so this can change once it's scored`,
                        id,
                    });
                }
                continue;
            }
            problems.push({
                ...at,
                severity: isHard(c.status) ? "hard" : "soft",
                line: lineAt(s.start + c.start),
                text: c.text,
                kind: c.status,
                reason: c.reason,
                ...(c.cause ? { cause: c.cause } : {}),
                ...(c.id ? { id: c.id } : {}),
            });
        }
        for (const w of result.swears) {
            problems.push({
                ...at,
                severity: "soft",
                line: lineAt(s.start + w.start),
                text: w.word,
                kind: "swear",
                reason: SWEAR_REASON,
            });
        }
        for (const w of result.stakesMentions) {
            problems.push({
                ...at,
                severity: "hard",
                line: lineAt(s.start + w.start),
                text: w.word,
                kind: "no-stakes",
                reason: NO_STAKES_REASON,
            });
        }
        problems.push(...unreadableTags(s, at, lineAt));
        for (const t of result.autoTags) {
            autoTags.push({ ...t, start: s.start + t.start, end: s.start + t.end });
        }
    }
    return { problems, autoTags };
}
/** Why a word-list hit is a problem. */
export const SWEAR_REASON = "on the word list, and swearing is off";
/** Why a mention of money, a prize or a punishment is a problem under `stakes: none`. */
export const NO_STAKES_REASON = "mentions money, a prize or a punishment, and league.md says stakes: none (bragging rights only)";
/** The small-sample flag. Worked out here, never written to the file, so nothing published can carry it. */
function smallSampleFlag(week) {
    return leagueItem("small-sample", `week ${week} is early in the season, so the starting order means little yet`);
}
/**
 * The last day each platform makes stat corrections to a scored week, as
 * spec #37's user story 59 gives them.
 */
const CORRECTIONS_THROUGH = {
    sleeper: "Thursday",
    espn: "Saturday",
};
/**
 * The correction-timing reminder. Nothing signals when corrections stop, so
 * every draft of a scored week carries it.
 */
function correctionTiming(league) {
    return leagueItem("correction-timing", `Scored. Corrections may land through ${CORRECTIONS_THROUGH[league.platform]}`);
}
/** The problems list's order: hard first, then by line, with league items ahead of any line. */
function byHardThenLine(a, b) {
    return (Number(b.severity === "hard") - Number(a.severity === "hard") ||
        (a.line ?? 0) - (b.line ?? 0));
}
/**
 * A problems list with a league item only the command knows, such as the
 * failed-fetch item, in its place in the list's order.
 */
export function withLeagueItem(problems, item) {
    return item ? [item, ...problems].sort(byHardThenLine) : problems;
}
/**
 * Whether a problem is a blurb problem: one the validator finds in a blurb or
 * the intro. Named by kind, so a new league item isn't counted by accident.
 */
export function isBlurbProblem(p) {
    return BLURB_PROBLEM_KINDS.has(p.kind);
}
const BLURB_PROBLEM_KINDS = new Set([
    "wrong",
    "stale",
    "unknown-id",
    "loose",
    "unchecked",
    "provisional",
    "swear",
    "no-stakes",
    "unreadable-tag",
]);
/** A soft league item: about the whole league, at no team or line. */
export function leagueItem(kind, reason) {
    return {
        severity: "soft",
        team: null,
        section: "League",
        line: null,
        text: "",
        kind,
        reason,
    };
}
/**
 * A new draft's problems list with each fault of prose that never passed the
 * LLM gate marked as a gate failure where the check lists it: a claim by its
 * text, a word-list hit by its word. A claim the check auto-tagged now cites
 * its evidence and is verified, so it isn't one.
 */
export function withGateFailures(checked, failed) {
    if (failed.length === 0)
        return checked.problems;
    const team = (key) => (key === "intro" ? null : key);
    return checked.problems.map((p) => failed.some((f) => team(f.key) === p.team &&
        (p.kind === "swear"
            ? f.swears.some((w) => w.word === p.text)
            : p.kind === "no-stakes"
                ? f.stakesMentions.some((w) => w.word === p.text)
                : f.claims.some((c) => c.text === p.text)))
        ? { ...p, gate: true }
        : p);
}
/**
 * A moved team item for each team the pundit placed away from its starting
 * place, on its heading's line.
 */
function movedTeams(ranking, order, startingOrder, names) {
    const moved = [];
    for (const e of ranking.entries) {
        if (e.kind !== "team")
            continue;
        const team = e.team;
        const now = order[team]?.place;
        const start = startingOrder[team]?.place;
        if (now === undefined || start === undefined || now === start)
            continue;
        moved.push({
            severity: "soft",
            team,
            section: names.get(team) ?? team,
            line: e.line,
            text: e.label,
            kind: "moved",
            reason: `starting place ${start}, now ${now}`,
        });
    }
    return moved;
}
/**
 * A `[words]{…}` the validator can't read as a tag, such as `{ev = record}`,
 * would reach the league as written.
 */
function unreadableTags(s, at, lineAt) {
    // Anything tag-shaped that stripping leaves untouched isn't a tag it reads.
    return [...s.text.matchAll(/\[[^\][]*\]\{[^{}]*\}/g)]
        .filter((m) => stripTags(m[0]) === m[0])
        .map((m) => ({
        ...at,
        severity: "hard",
        line: lineAt(s.start + m.index),
        text: m[0],
        kind: "unreadable-tag",
        reason: "a tag the tool can't read would be published as written; write it as [words]{ev=<id>}",
    }));
}
/** The highest ranking week with a draft in the folder. */
async function latestDraftWeek(dir) {
    const names = await readdir(dir).catch(() => []);
    const weeks = names
        .map((n) => /^week-(\d+)\.md$/.exec(n)?.[1])
        .filter((w) => w !== undefined)
        .map(Number);
    if (weeks.length === 0) {
        throw new WorkspaceFileError(`No draft in ${dir}; run \`lazy-pundit draft\` first`);
    }
    return Math.max(...weeks);
}
async function readDraft(path, name) {
    try {
        return await readFile(path, "utf8");
    }
    catch (cause) {
        throw new WorkspaceFileError(`No draft ${name}`, { cause });
    }
}
/**
 * The snapshot a draft stands on. Its manifest or a blob it lists being gone
 * (only a hand deletion does that; retention keeps it) or damaged (its file
 * there but unreadable) is a `WorkspaceFileError` with the fix; anything else
 * is thrown as it is.
 */
async function readDraftSnapshot(dir, id, name) {
    try {
        return await readSnapshot(dir, id);
    }
    catch (cause) {
        const where = cause.code === "ENOENT"
            ? "missing from"
            : cause instanceof SnapshotDamagedError
                ? "damaged in"
                : undefined;
        if (!where)
            throw cause;
        throw new WorkspaceFileError(`${name} stands on snapshot ${id}, which is ${where} the workspace's snapshots folder, so the draft can't be checked. Move ${name} out of its season folder and run \`lazy-pundit draft\` to start the week again`, { cause });
    }
}
//# sourceMappingURL=check.js.map