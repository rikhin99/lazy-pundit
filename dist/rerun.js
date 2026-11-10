import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { saveCredentials, setSpendCap } from "./config.js";
import { readFrontMatter, setFrontMatterValue, WorkspaceFileError, } from "./front-matter.js";
import { checkLeague, handleProblem, leagueText, loreFileText, methodStatus, nicknamesProblem, personaStatus, personaText, proposedHandles, SetupRefusal, settingsText, spendCapProblem, } from "./init.js";
import { familyLeague, leagueFilePath, readLeagueFile } from "./league-file.js";
import { loadLore } from "./lore.js";
import { personaPath } from "./persona.js";
import { punditSettingsPath } from "./pundit-settings.js";
import { lastPublishedMeta } from "./ranking-file.js";
import { leagueFileChangeWarnings } from "./stakes.js";
import { rankingsDir, readWorkspace, } from "./workspace.js";
import { writeWorkspaceFile } from "./workspace-files.js";
/** The setup steps `setup <step>` re-runs, in the order `init` asks them. */
export const RERUN_STEPS = [
    "handles",
    "lore",
    "stakes",
    "method",
    "key",
    "cap",
    "persona",
];
/** Whether `step` names a step `setup <step>` re-runs. */
export function isRerunStep(step) {
    return RERUN_STEPS.includes(step);
}
/** Why `setup <step>` can't re-run `step`, or undefined if it can. */
export function rerunStop(step) {
    if (isRerunStep(step))
        return undefined;
    if (step === "espn") {
        return "Reading ESPN leagues comes in a later release, and lazy-pundit setup espn with it.";
    }
    if (step === "pundit name" || step === "league data") {
        return `The ${step} makes the workspace, so only lazy-pundit init sets it: run init for a new workspace.`;
    }
    return `No setup step is called ${step}. lazy-pundit setup re-runs one of: ${RERUN_STEPS.join(", ")}.`;
}
/**
 * Re-runs one setup step. A file the step writes in the workspace is
 * overwritten only through `confirm`, shown the diff, unless it's missing,
 * still its placeholder or already the step's text. Once written, or with
 * nothing to change, the step's status in `workspace.md`'s `setup:` follows
 * the answers. `warnings` are what the pundit should know of what's left.
 */
export async function rerunStep(deps, dir, rerun, confirm) {
    const ws = await readWorkspace(dir);
    switch (rerun.step) {
        case "key":
            if (rerun.key === undefined)
                return { written: false, warnings: [] };
            await saveCredentials(deps, { anthropicApiKey: rerun.key });
            return { written: true, warnings: [] };
        case "cap": {
            const problem = spendCapProblem(String(rerun.spendCap));
            if (problem !== undefined) {
                throw new SetupRefusal(`A spend cap of ${rerun.spendCap} can't be written: ${problem}`);
            }
            await setSpendCap(deps, rerun.spendCap);
            return { written: true, warnings: [] };
        }
        case "handles":
            return rerunHandles(ws, rerun, confirm);
    }
    const file = await stepFile(ws, rerun);
    const before = await readIfAny(file.path);
    const outcome = await overwrite(file, confirm);
    if (outcome === "declined")
        return { written: false, warnings: [] };
    const warnings = file.warnings ?? [];
    try {
        await setStatus(ws, rerun.step, file.status);
    }
    catch (err) {
        // The file and its status change together, or neither does.
        if (outcome === "written") {
            if (before === undefined)
                await rm(file.path, { force: true });
            else {
                await writeWorkspaceFile(file.path, before, {
                    versionKey: file.versionKey,
                });
            }
        }
        throw err;
    }
    return { written: outcome === "written", warnings };
}
/**
 * What a re-run step is preselected from, as `init` has it from earlier steps:
 * the lore's league type and the family league. A file that doesn't load
 * gives no preselection; the step's own write still checks what it writes.
 */
export async function rerunPreselections(dir) {
    const ws = await readWorkspace(dir);
    const type = await loadLore(ws).then((lore) => lore.type, () => undefined);
    const family = await familyLeague(ws).catch(() => false);
    return { ...(type ? { type } : {}), familyLeague: family };
}
/**
 * The workspace's league, fetched live as the league data step does, for the
 * handles and lore steps: the handles `workspace.md` links, and the handles
 * step's list with each linked account under its handle.
 */
export async function rerunLeague(deps, dir) {
    const ws = await readWorkspace(dir);
    const league = await checkLeague(deps, ws.season.leagueId);
    const linked = linkedHandles(ws, league);
    const proposed = proposedHandles(league).map((p) => linked.find((l) => l.account === p.account) ?? p);
    return { league, linked, proposed };
}
/**
 * The handles `workspace.md` links, as the handles step lists them, with the
 * display name the league gives each account.
 */
export function linkedHandles(ws, league) {
    return Object.entries(ws.handles).flatMap(([handle, accounts]) => accounts.flatMap((account) => {
        const manager = league.managers.find((m) => m.account === account);
        return manager ? [{ handle, ...manager }] : [];
    }));
}
/** The file a workspace step writes from its answers, checked before it's written. */
async function stepFile(ws, rerun) {
    switch (rerun.step) {
        case "lore": {
            if (rerun.lore) {
                const handles = linkedHandles(ws, rerun.league);
                const problem = nicknamesProblem(rerun.league, handles, rerun.lore.nicknames);
                if (problem !== undefined)
                    throw new SetupRefusal(problem);
            }
            return {
                path: join(ws.dir, "lore.md"),
                text: loreFileText(rerun.lore, rerun.league),
                placeholder: loreFileText(undefined, rerun.league),
                versionKey: "lore",
                status: rerun.lore ? "done" : "skipped",
            };
        }
        case "stakes": {
            const path = leagueFilePath(ws);
            const current = await readIfAny(path);
            // Skipped, the stakes go unrecorded but the family league stays as set.
            const family = rerun.stakes?.familyLeague ??
                (await familyLeague(ws).catch(() => false));
            let text;
            let stakes;
            try {
                text = withBodyOf(current, leagueText(ws.season.year, rerun.stakes, family));
                stakes = readLeagueFile(text, ws.handles).stakes;
            }
            catch (err) {
                if (!(err instanceof WorkspaceFileError))
                    throw err;
                throw new SetupRefusal(`These stakes can't be written over league.md's body: ${err.message}`);
            }
            return {
                path,
                text,
                placeholder: leagueText(ws.season.year, undefined),
                versionKey: "league",
                status: rerun.stakes ? "done" : "skipped",
                // As a load of the new league.md would say, against the latest frozen copy.
                warnings: leagueFileChangeWarnings(stakes, await lastPublishedMeta(rankingsDir(ws), Number.POSITIVE_INFINITY)),
            };
        }
        case "method":
            return {
                path: punditSettingsPath(ws),
                text: settingsText(rerun.method),
                placeholder: settingsText(undefined),
                versionKey: "format",
                status: methodStatus(rerun.method),
            };
        case "persona":
            return {
                path: personaPath(ws),
                text: personaText(rerun.persona ?? "broadcast"),
                placeholder: personaText("broadcast"),
                versionKey: "format",
                status: personaStatus(rerun.persona),
            };
    }
}
/**
 * The handles step re-run: `workspace.md`'s links and the step's status, in
 * one write. A lore section whose handle loses its link is said, not renamed.
 */
async function rerunHandles(ws, rerun, confirm) {
    const handles = rerun.handles ?? [];
    for (const [i, { handle }] of handles.entries()) {
        const others = handles.slice(0, i).map((h) => h.handle);
        const problem = handleProblem(handle, others);
        if (problem !== undefined)
            throw new SetupRefusal(problem);
    }
    const links = {};
    for (const h of handles)
        links[h.handle] = [...(links[h.handle] ?? []), h.account];
    const path = join(ws.dir, "workspace.md");
    const current = await readFile(path, "utf8");
    const status = handles.length === 0 ? "skipped" : "done";
    const text = setFrontMatterValue("workspace.md", setFrontMatterValue("workspace.md", current, "handles", links), "setup", { ...ws.setup, handles: status });
    const outcome = await overwrite({ path, text, versionKey: "format" }, confirm);
    if (outcome === "declined")
        return { written: false, warnings: [] };
    return {
        written: outcome === "written",
        warnings: await unlinkedLore(ws, links),
    };
}
/** What to say of each lore section naming a handle with no link now. */
async function unlinkedLore(ws, links) {
    let sections;
    try {
        sections = (await loadLore(ws)).sections;
    }
    catch {
        return [];
    }
    return sections.flatMap(({ name }) => {
        const handle = /^manager:(.+)$/.exec(name)?.[1];
        if (handle === undefined || handle in links)
            return [];
        return [
            `lore.md's ## {manager=${handle}} section names a handle with no link now, so its nicknames count for no team and it isn't sent: rename its heading to the manager's handle.`,
        ];
    });
}
/**
 * Writes the step's text unless the file already holds it. A file that holds
 * anything but the placeholder is overwritten only if `confirm` says so.
 */
async function overwrite(file, confirm) {
    const current = await readIfAny(file.path);
    if (current === file.text)
        return "same";
    if (current !== undefined &&
        current !== file.placeholder &&
        !(await confirm({
            file: file.path,
            diff: lineDiff(current, file.text),
            warnings: file.warnings ?? [],
        }))) {
        return "declined";
    }
    await writeWorkspaceFile(file.path, file.text, {
        versionKey: file.versionKey,
    });
    return "written";
}
/** Sets one league-level step's status in `workspace.md`, keeping the rest. */
async function setStatus(ws, step, status) {
    const path = join(ws.dir, "workspace.md");
    const text = setFrontMatterValue("workspace.md", await readFile(path, "utf8"), "setup", { ...ws.setup, [step]: status });
    await writeWorkspaceFile(path, text);
}
async function readIfAny(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch (err) {
        if (err.code === "ENOENT")
            return undefined;
        throw err;
    }
}
/**
 * The step's front matter over the current file's body, so a re-run keeps the
 * stakes sections and Log. With no current file, the step's own body.
 */
function withBodyOf(current, fresh) {
    if (current === undefined)
        return fresh;
    const freshBody = readFrontMatter("league.md", fresh, "league").body;
    const kept = readFrontMatter("league.md", current, "league").body;
    return fresh.slice(0, fresh.length - freshBody.length) + kept;
}
/** Lines kept around each change in a diff. */
const CONTEXT = 2;
/** A line-by-line diff from `before` to `after`, with `CONTEXT` lines around each change. */
function lineDiff(before, after) {
    const a = before.split("\n");
    const b = after.split("\n");
    // The longest common subsequence of a[i..] and b[j..], at i * width + j.
    const width = b.length + 1;
    const lcs = new Int32Array((a.length + 1) * width);
    const at = (i, j) => lcs[i * width + j] ?? 0;
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i * width + j] =
                a[i] === b[j]
                    ? at(i + 1, j + 1) + 1
                    : Math.max(at(i + 1, j), at(i, j + 1));
        }
    }
    const lines = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            lines.push({ mark: " ", text: a[i] ?? "" });
            i++;
            j++;
        }
        else if (j < b.length &&
            (i === a.length || at(i, j + 1) >= at(i + 1, j))) {
            lines.push({ mark: "+", text: b[j++] ?? "" });
        }
        else {
            lines.push({ mark: "-", text: a[i++] ?? "" });
        }
    }
    const near = lines.map((_, k) => lines
        .slice(Math.max(0, k - CONTEXT), k + CONTEXT + 1)
        .some((l) => l.mark !== " "));
    const out = [];
    for (const [k, l] of lines.entries()) {
        if (near[k])
            out.push(`${l.mark}${l.text}`);
        else if (near[k - 1])
            out.push("⋮");
    }
    return out.join("\n");
}
//# sourceMappingURL=rerun.js.map