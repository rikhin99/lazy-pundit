import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { saveCredentials, setSpendCap } from "./config.ts";
import type { Deps } from "./deps.ts";
import {
  readFrontMatter,
  refuseUneditableFrontMatter,
  setFrontMatterValue,
  type VersionKey,
  WorkspaceFileError,
} from "./front-matter.ts";
import {
  checkEspnLeague,
  checkLeague,
  handleProblem,
  type LeagueCheck,
  type LoreAnswers,
  leagueText,
  loreFileText,
  loreNamesProblem,
  type ManagerHandle,
  methodStatus,
  nicknamesProblem,
  personaStatus,
  personaText,
  proposedHandles,
  proposedNicknames,
  RERUN_STEPS,
  SetupRefusal,
  type StakesAnswers,
  settingsText,
  spendCapProblem,
  type TeamNicknames,
} from "./init.ts";
import { familyLeague, leagueFilePath, readLeagueFile } from "./league-file.ts";
import {
  isStepLine,
  type LeagueType,
  type LoreLine,
  loadLore,
  loreLines,
  parseLore,
  sectionName,
} from "./lore.ts";
import { type PresetName, personaPath } from "./persona.ts";
import { PLATFORM_NAMES } from "./plain-text.ts";
import type { PowerScoreMethod } from "./power-score.ts";
import { punditSettingsPath } from "./pundit-settings.ts";
import { lastPublishedMeta } from "./ranking-file.ts";
import { leagueFileChangeWarnings, type Stakes } from "./stakes.ts";
import {
  type LeagueStep,
  rankingsDir,
  readWorkspace,
  type SetupStatus,
  type Workspace,
} from "./workspace.ts";
import { writeWorkspaceFile } from "./workspace-files.ts";

export type RerunStep = (typeof RERUN_STEPS)[number];

/**
 * One setup step's answers, re-run on its own. An answer left out means the
 * step was skipped this time, which writes its placeholder; a skipped key
 * keeps the one stored.
 */
export type StepRerun =
  | { step: "handles"; league: LeagueCheck; handles?: ManagerHandle[] }
  | { step: "lore"; league: LeagueCheck; lore?: LoreAnswers }
  | { step: "stakes"; stakes?: StakesAnswers }
  | { step: "method"; method?: PowerScoreMethod }
  | { step: "espn"; cookie?: string }
  | { step: "key"; key?: string }
  | { step: "cap"; spendCap: number }
  | { step: "persona"; persona?: PresetName };

/** A file a re-run would overwrite, with the diff of what it would change. */
export interface HandEdit {
  file: string;
  /** Line by line: `-` the file's line, `+` the step's, ` ` around them. */
  diff: string;
  /** What overwriting means for the published weeks, such as a changed-outcome warning. */
  warnings: string[];
}

/** Whether `step` names a step `setup <step>` re-runs. */
export function isRerunStep(step: string): step is RerunStep {
  return (RERUN_STEPS as readonly string[]).includes(step);
}

/** Why `setup <step>` can't re-run `step`, or undefined if it can. */
export function rerunStop(step: string): string | undefined {
  if (isRerunStep(step)) return undefined;
  if (step === "pundit name" || step === "league data") {
    return `The ${step} makes the workspace, so only lazy-pundit init sets it: run init for a new workspace.`;
  }
  return `No setup step is called ${step}. lazy-pundit setup re-runs one of: ${RERUN_STEPS.join(", ")}.`;
}

/** Whether `setup <step>` edits `workspace.md`: espn, key and cap write only the operator's files. */
export function editsWorkspace(step: RerunStep): boolean {
  return step !== "espn" && step !== "key" && step !== "cap";
}

/**
 * The ESPN league `setup espn` checks a cookie against: the workspace's league
 * in its own season. A league on another platform needs no cookie, so it's
 * refused before anything is asked.
 */
export async function espnWorkspaceLeague(
  dir: string,
): Promise<{ leagueId: string; season: string }> {
  const { season } = await readWorkspace(dir);
  if (season.platform !== "espn") {
    throw new SetupRefusal(
      `This workspace's league is on ${PLATFORM_NAMES[season.platform]}, which needs no ESPN cookie: run lazy-pundit setup espn in an ESPN league's workspace.`,
    );
  }
  return { leagueId: season.leagueId, season: season.year };
}

/**
 * Refuses a `workspace.md` whose front matter `setup <step>` couldn't edit
 * (indented keys or a `{...}` flow map), for a step that edits it, so the
 * pundit hears it before answering the step's questions.
 */
export async function refuseUneditableWorkspace(
  dir: string,
  step: RerunStep,
): Promise<void> {
  if (!editsWorkspace(step)) return;
  // Front matter that isn't valid YAML gets readWorkspace's refusal, with its fix.
  await readWorkspace(dir);
  refuseUneditableFrontMatter(
    "workspace.md",
    await readFile(join(dir, "workspace.md"), "utf8"),
  );
}

/**
 * Re-runs one setup step. A file the step writes in the workspace is
 * overwritten only through `confirm`, shown the diff, unless it's missing,
 * still its placeholder or already the step's text. Once written, or with
 * nothing to change, the step's status in `workspace.md`'s `setup:` follows
 * the answers. `warnings` are what the pundit should know of what's left.
 */
export async function rerunStep(
  deps: Pick<Deps, "configDir" | "env" | "clock">,
  dir: string,
  rerun: StepRerun,
  confirm: (edit: HandEdit) => Promise<boolean>,
): Promise<{ written: boolean; warnings: string[] }> {
  const ws = await readWorkspace(dir);
  await refuseUneditableWorkspace(dir, rerun.step);
  switch (rerun.step) {
    case "espn":
      await espnWorkspaceLeague(dir);
      if (rerun.cookie === undefined) return { written: false, warnings: [] };
      await saveCredentials(deps, { espnS2: rerun.cookie });
      return { written: true, warnings: [] };
    case "key":
      if (rerun.key === undefined) return { written: false, warnings: [] };
      await saveCredentials(deps, { anthropicApiKey: rerun.key });
      return { written: true, warnings: [] };
    case "cap": {
      const problem = spendCapProblem(String(rerun.spendCap));
      if (problem !== undefined) {
        throw new SetupRefusal(
          `A spend cap of ${rerun.spendCap} can't be written: ${problem}`,
        );
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
  if (outcome === "declined") return { written: false, warnings: [] };
  const warnings = file.warnings ?? [];
  try {
    await setStatus(ws, rerun.step, file.status);
  } catch (err) {
    // The file and its status change together, or neither does.
    if (outcome === "written") {
      if (before === undefined) await rm(file.path, { force: true });
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
export async function rerunPreselections(
  dir: string,
): Promise<{ type?: LeagueType; familyLeague: boolean }> {
  const ws = await readWorkspace(dir);
  const type = await loadLore(ws).then(
    (lore) => lore.type,
    () => undefined,
  );
  const family = await familyLeague(ws).catch(() => false);
  return { ...(type ? { type } : {}), familyLeague: family };
}

/**
 * The lore step's nicknames on a re-run: each team's are those `lore.md` gives
 * the section the step writes it under, as written, so accepting them changes
 * nothing. A team with no such section, or a `lore.md` missing or not loading,
 * gets `proposedNicknames`' names.
 */
export async function rerunNicknames(
  dir: string,
  league: LeagueCheck,
  handles: ManagerHandle[],
): Promise<TeamNicknames[]> {
  const proposed = proposedNicknames(league, handles);
  const lore = await loadLore(await readWorkspace(dir)).catch(() => undefined);
  return proposed.map((t) => {
    const name = sectionName(t.section);
    const section = lore?.sections.find((s) => s.name === name);
    return section ? { ...t, nicknames: section.nicknames } : t;
  });
}

/**
 * The workspace's league, fetched live as the league data step does, for the
 * handles and lore steps: the handles `workspace.md` links, and the handles
 * step's list with each linked account under its handle.
 */
export async function rerunLeague(
  deps: Deps,
  dir: string,
): Promise<{
  league: LeagueCheck;
  linked: ManagerHandle[];
  proposed: ManagerHandle[];
}> {
  const ws = await readWorkspace(dir);
  const league =
    ws.season.platform === "espn"
      ? await checkEspnLeague(deps, ws.season.leagueId, {
          season: ws.season.year,
        })
      : await checkLeague(deps, ws.season.leagueId);
  const linked = linkedHandles(ws, league);
  const proposed = proposedHandles(league).map(
    (p) => linked.find((l) => l.account === p.account) ?? p,
  );
  return { league, linked, proposed };
}

/**
 * The handles `workspace.md` links, as the handles step lists them, with the
 * display name the league gives each account.
 */
export function linkedHandles(
  ws: Workspace,
  league: LeagueCheck,
): ManagerHandle[] {
  return Object.entries(ws.handles).flatMap(([handle, accounts]) =>
    accounts.flatMap((account) => {
      const manager = league.managers.find((m) => m.account === account);
      return manager ? [{ handle, ...manager }] : [];
    }),
  );
}

interface StepFile {
  path: string;
  text: string;
  /** What the step writes when skipped, which is no hand edit. */
  placeholder: string;
  versionKey: VersionKey;
  status: SetupStatus;
  /** What writing the text means for the published weeks, shown with any confirm. */
  warnings?: string[];
}

/** The file a workspace step writes from its answers, checked before it's written. */
async function stepFile(
  ws: Workspace,
  rerun: Extract<StepRerun, { step: "lore" | "stakes" | "method" | "persona" }>,
): Promise<StepFile> {
  switch (rerun.step) {
    case "lore": {
      const path = join(ws.dir, "lore.md");
      let text = loreFileText(rerun.lore, rerun.league);
      if (rerun.lore) {
        const handles = linkedHandles(ws, rerun.league);
        const problem = nicknamesProblem(
          rerun.league,
          handles,
          rerun.lore.nicknames,
        );
        if (problem !== undefined) throw new SetupRefusal(problem);
        const current = await readIfAny(path);
        if (current !== undefined && loreLoadProblem(current) === undefined) {
          // Merged with LF lines, and written back with the file's own.
          const eol = current.includes("\r\n") ? "\r\n" : "\n";
          const merged = withEntriesOf(current.replaceAll("\r\n", "\n"), text);
          text = merged.map((line) => line.text).join(eol);
          const problem =
            loreLoadProblem(text) ??
            loreNamesProblem(rerun.league, handles, parseLore(text));
          if (problem !== undefined) {
            throw new SetupRefusal(
              `These nicknames can't be written over lore.md's entries: ${inCurrentFile(problem, merged)}`,
            );
          }
        }
      }
      return {
        path,
        text,
        placeholder: loreFileText(undefined, rerun.league),
        versionKey: "lore",
        status: rerun.lore ? "done" : "skipped",
      };
    }
    case "stakes": {
      const path = leagueFilePath(ws);
      const current = await readIfAny(path);
      // Skipped, the stakes go unrecorded but the family league stays as set.
      const family =
        rerun.stakes?.familyLeague ??
        (await familyLeague(ws).catch(() => false));
      let text: string;
      let stakes: Stakes;
      try {
        text = withBodyOf(
          current,
          leagueText(ws.season.year, rerun.stakes, family),
        );
        stakes = readLeagueFile(text, ws.handles).stakes;
      } catch (err) {
        if (!(err instanceof WorkspaceFileError)) throw err;
        throw new SetupRefusal(
          `These stakes can't be written over league.md's body: ${err.message}`,
        );
      }
      return {
        path,
        text,
        placeholder: leagueText(ws.season.year, undefined),
        versionKey: "league",
        status: rerun.stakes ? "done" : "skipped",
        // As a load of the new league.md would say, against the latest frozen copy.
        warnings: leagueFileChangeWarnings(
          stakes,
          await lastPublishedMeta(rankingsDir(ws), Number.POSITIVE_INFINITY),
        ),
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
async function rerunHandles(
  ws: Workspace,
  rerun: Extract<StepRerun, { step: "handles" }>,
  confirm: (edit: HandEdit) => Promise<boolean>,
): Promise<{ written: boolean; warnings: string[] }> {
  const handles = rerun.handles ?? [];
  for (const [i, { handle }] of handles.entries()) {
    const others = handles.slice(0, i).map((h) => h.handle);
    const problem = handleProblem(handle, others);
    if (problem !== undefined) throw new SetupRefusal(problem);
  }
  const links: Record<string, string[]> = {};
  for (const h of handles)
    links[h.handle] = [...(links[h.handle] ?? []), h.account];
  const path = join(ws.dir, "workspace.md");
  const current = await readFile(path, "utf8");
  const status: SetupStatus = handles.length === 0 ? "skipped" : "done";
  const text = setFrontMatterValue(
    "workspace.md",
    setFrontMatterValue("workspace.md", current, "handles", links),
    "setup",
    { ...ws.setup, handles: status },
  );
  const outcome = await overwrite(
    { path, text, versionKey: "format" },
    confirm,
  );
  if (outcome === "declined") return { written: false, warnings: [] };
  return {
    written: outcome === "written",
    warnings: await unlinkedLore(ws, links),
  };
}

/** What to say of each lore section naming a handle with no link now. */
async function unlinkedLore(
  ws: Workspace,
  links: Record<string, string[]>,
): Promise<string[]> {
  let sections: { name: string }[];
  try {
    sections = (await loadLore(ws)).sections;
  } catch {
    return [];
  }
  return sections.flatMap(({ name }) => {
    const handle = /^manager:(.+)$/.exec(name)?.[1];
    if (handle === undefined || handle in links) return [];
    return [
      `lore.md's ## {manager=${handle}} section names a handle with no link now, so its nicknames count for no team and it isn't sent: rename its heading to the manager's handle.`,
    ];
  });
}

/**
 * Writes the step's text unless the file already holds it. A file that holds
 * anything but the placeholder is overwritten only if `confirm` says so.
 */
async function overwrite(
  file: Pick<StepFile, "path" | "text" | "versionKey" | "warnings"> & {
    placeholder?: string;
  },
  confirm: (edit: HandEdit) => Promise<boolean>,
): Promise<"written" | "same" | "declined"> {
  const current = await readIfAny(file.path);
  if (current === file.text) return "same";
  if (
    current !== undefined &&
    current !== file.placeholder &&
    !(await confirm({
      file: file.path,
      diff: lineDiff(current, file.text),
      warnings: file.warnings ?? [],
    }))
  ) {
    return "declined";
  }
  await writeWorkspaceFile(file.path, file.text, {
    versionKey: file.versionKey,
  });
  return "written";
}

/** Sets one league-level step's status in `workspace.md`, keeping the rest. */
async function setStatus(
  ws: Workspace,
  step: LeagueStep,
  status: SetupStatus,
): Promise<void> {
  const path = join(ws.dir, "workspace.md");
  const text = setFrontMatterValue(
    "workspace.md",
    await readFile(path, "utf8"),
    "setup",
    { ...ws.setup, [step]: status },
  );
  await writeWorkspaceFile(path, text);
}

async function readIfAny(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * The step's front matter over the current file's body, so a re-run keeps the
 * stakes sections and Log. With no current file, the step's own body.
 */
function withBodyOf(current: string | undefined, fresh: string): string {
  if (current === undefined) return fresh;
  const freshBody = readFrontMatter("league.md", fresh, "league").body;
  const kept = readFrontMatter("league.md", current, "league").body;
  return fresh.slice(0, fresh.length - freshBody.length) + kept;
}

/** Why `lore.md`'s text wouldn't load, or undefined when it loads. */
function loreLoadProblem(lore: string): string | undefined {
  try {
    parseLore(lore);
    return undefined;
  } catch (err) {
    if (!(err instanceof WorkspaceFileError)) throw err;
    return err.message;
  }
}

/** A line of a merged `lore.md`, with its line in the current file when it came from there. */
interface MergedLine {
  text: string;
  fileLine?: number;
}

/** The comment the lore step writes under a team with no nicknames, on the heading's next line. */
const STEP_COMMENT = /^\s*<!--.*-->\s*$/;

/**
 * The step's `lore.md` with the current file's lore kept: each section the
 * step writes, then every other line the current file has under it, then
 * every section the step doesn't write, in the file's order. Kept lines stay
 * as written, blank lines and comments too; the step's own lines (a
 * `nicknames:` or `type:` line, its comment for a team with no nicknames)
 * aren't kept. With each line, where it came from in the current file.
 */
function withEntriesOf(current: string, fresh: string): MergedLine[] {
  const currentLines = loreLines(current);
  const freshLines = loreLines(fresh);
  const written = new Set(freshLines.sections.map((s) => s.name));
  const fromFile = (lines: LoreLine[]): MergedLine[] =>
    lines.map((line) => ({ text: line.text, fileLine: line.at }));
  const fromStep = (lines: LoreLine[]): MergedLine[] =>
    lines.map((line) => ({ text: line.text }));
  const keptUnder = (name: string) =>
    currentLines.sections
      .filter((s) => s.name === name)
      .flatMap((s) => {
        const under = s.lines.slice(1);
        if (STEP_COMMENT.test(under[0]?.text ?? "")) under.shift();
        return fromFile(under.filter((line) => !isStepLine(name, line.read)));
      });
  // A team section that says no nicknames in both, however the file says it
  // (an empty `nicknames:` line, none at all), stays as the file wrote it.
  // A file that loads names each section once.
  const freshNone = withoutNicknames(fresh);
  const currentNone = withoutNicknames(current);
  const asWritten = (name: string) =>
    freshNone.has(name) && currentNone.has(name)
      ? currentLines.sections.find((s) => s.name === name)
      : undefined;
  const sections = [
    ...freshLines.sections.map((s) => {
      const kept = asWritten(s.name);
      if (kept) return trimmed(fromFile(kept.lines));
      return trimmed([...trimmed(fromStep(s.lines)), ...keptUnder(s.name)]);
    }),
    ...currentLines.sections
      .filter((s) => !written.has(s.name))
      .map((s) => trimmed(fromFile(s.lines))),
  ];
  return [
    ...fromStep(freshLines.top),
    ...sections.flatMap((s, i) => (i === 0 ? s : [{ text: "" }, ...s])),
    { text: "" },
  ];
}

/** The names of the team sections a `lore.md` that loads gives no nicknames. */
function withoutNicknames(text: string): Set<string> {
  return new Set(
    parseLore(text)
      .sections.filter((s) => /^(manager|team):/.test(s.name))
      .filter((s) => s.nicknames.length === 0)
      .map((s) => s.name),
  );
}

/** Lines without the blank ones at their end. */
function trimmed(lines: MergedLine[]): MergedLine[] {
  const end = lines.findLastIndex((line) => line.text.trim() !== "");
  return lines.slice(0, end + 1);
}

/** A message about a merged `lore.md` with each line number moved to the current file's, where the line came from there. */
function inCurrentFile(message: string, merged: MergedLine[]): string {
  return message.replace(
    /\b(lines? |and )(\d+)/g,
    (_, word: string, n: string) =>
      `${word}${merged[Number(n) - 1]?.fileLine ?? n}`,
  );
}

/** Lines kept around each change in a diff. */
const CONTEXT = 2;

/** A line-by-line diff from `before` to `after`, with `CONTEXT` lines around each change. */
function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  // The longest common subsequence of a[i..] and b[j..], at i * width + j.
  const width = b.length + 1;
  const lcs = new Int32Array((a.length + 1) * width);
  const at = (i: number, j: number) => lcs[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const lines: { mark: " " | "-" | "+"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ mark: " ", text: a[i] ?? "" });
      i++;
      j++;
    } else if (
      j < b.length &&
      (i === a.length || at(i, j + 1) >= at(i + 1, j))
    ) {
      lines.push({ mark: "+", text: b[j++] ?? "" });
    } else {
      lines.push({ mark: "-", text: a[i++] ?? "" });
    }
  }
  const near = lines.map((_, k) =>
    lines
      .slice(Math.max(0, k - CONTEXT), k + CONTEXT + 1)
      .some((l) => l.mark !== " "),
  );
  const out: string[] = [];
  for (const [k, l] of lines.entries()) {
    if (near[k]) out.push(`${l.mark}${l.text}`);
    else if (near[k - 1]) out.push("⋮");
  }
  return out.join("\n");
}
