import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { checkDraft, isBlurbProblem, } from "./check.js";
import { rawFrontMatterValue, WorkspaceFileError } from "./front-matter.js";
import { renderPlainText } from "./plain-text.js";
import { frozenCopy, lastPublished, parseRanking, } from "./ranking-file.js";
import { freshDataWarnings } from "./refresh.js";
import { houseRuleOutcomes, logRecord } from "./stakes.js";
import { writeOutput, writeWorkspaceFile } from "./workspace-files.js";
/**
 * Checks the latest draft and diffs fresh data against its snapshot, warning
 * without re-snapshotting. Then it freezes the draft as `week-NN.published.md`,
 * renders the plain text from the frozen copy into `week-NN.txt`, and copies it
 * to the clipboard. Hard problems are put to `confirm` first; soft ones are only
 * returned.
 */
export async function publish(workspaceDir, deps, opts = {}) {
    const checked = await checkDraft(workspaceDir);
    const { week, problems, dir, stem } = checked;
    const name = `${stem}.published.md`;
    const publishedPath = join(dir, name);
    const ownCopy = await lastEdition(publishedPath, name);
    const warnings = [
        ...checked.warnings,
        ...(await freshDataWarnings(workspaceDir, checked, deps)),
        ...(ownCopy?.warnings ?? []),
    ];
    opts.onWarnings?.(warnings);
    const hard = problems.filter((p) => p.severity === "hard");
    if (hard.length > 0 && !opts.yes && !(await opts.confirm?.(hard))) {
        return { published: false, stoppedBy: "hard", week, problems, warnings };
    }
    const { persona } = checked.ranking.meta;
    if (persona.family_league_relaxed && !opts.yes) {
        // This week's own frozen copy counts, so a republish isn't asked again,
        // unless it can't be read: then the persona counts as changed.
        const last = ownCopy
            ? ownCopy.meta
            : (await lastPublished(dir, week))?.ranking.meta;
        const unchanged = last !== undefined && isDeepStrictEqual(last.persona, persona);
        if (!unchanged && !(await opts.confirmRelaxed?.(persona))) {
            return {
                published: false,
                stoppedBy: "relaxed",
                week,
                problems,
                warnings,
            };
        }
    }
    const record = publishRecord(ownCopy, checked, deps.clock.now());
    await writeWorkspaceFile(publishedPath, frozenCopy(name, checked.text, record));
    // The frozen copy is the checked draft with its edition, so the draft's
    // parse and order evidence render it.
    const text = renderPlainText(checked.ranking, checked.league, checked.order, checked.baseline);
    const textPath = join(dir, `${stem}.txt`);
    await writeOutput(textPath, text);
    const copied = await deps.clipboard.write(text);
    return {
        published: true,
        week,
        publishedPath,
        textPath,
        text,
        copied,
        problems,
        warnings,
    };
}
/**
 * The week's last edition: its frozen copy at `path` (none before the week's
 * first publish) and its edition number (an old frozen copy with no edition
 * counts as 1). A frozen copy that can't be read gives no `meta`: its edition
 * comes from a top-level `edition:` line, if it has one, and a warning that
 * publishing replaces it.
 */
async function lastEdition(path, name) {
    const text = await readFile(path, "utf8").catch(() => undefined);
    if (text === undefined)
        return undefined;
    try {
        const meta = parseRanking(name, text).meta;
        return { edition: meta.edition ?? 1, meta, warnings: [] };
    }
    catch (error) {
        if (!(error instanceof WorkspaceFileError))
            throw error;
        const written = rawFrontMatterValue(text, "edition") ?? "";
        const edition = /^[1-9]\d*$/.test(written) ? Number(written) : 1;
        return {
            edition,
            warnings: [
                `${name} can't be read, so publishing replaces it with edition ${edition + 1}, and any edits made in it are lost`,
            ],
        };
    }
}
/**
 * The publish record of a new edition after `last`: edition 1 on the week's
 * first publish, else one more than the last, keeping the last edition's first
 * publish time when it froze the same draft (`createdAt`): a draft made again
 * after the week was published starts its own. The Log entries and house
 * rules' outcomes are taken fresh, as `league.md` stands now, so a later load
 * warns only of what changed after this publish.
 */
function publishRecord(last, checked, now) {
    const { meta } = checked.ranking;
    const blurb = checked.problems.filter(isBlurbProblem);
    const sameDraft = last?.meta?.created_at === meta.created_at;
    const outcomes = houseRuleOutcomes(checked.stakes);
    return {
        edition: last === undefined ? 1 : last.edition + 1,
        firstPublishedAt: (sameDraft && last?.meta?.first_published_at) || now.toISOString(),
        blurbProblems: {
            hard: blurb.filter((p) => p.severity === "hard").length,
            soft: blurb.filter((p) => p.severity === "soft").length,
        },
        logEntries: logRecord(checked.stakes, checked.week),
        // Left as the draft wrote it when unchanged, so the line stays as it is.
        ...(outcomes &&
            !isDeepStrictEqual(outcomes, meta.house_rule_outcomes) && {
            houseRuleOutcomes: outcomes,
        }),
    };
}
//# sourceMappingURL=publish.js.map