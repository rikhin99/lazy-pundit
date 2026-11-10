import type { Deps } from "./deps.ts";
import { type LeagueCheck, type LoreAnswers, type ManagerHandle, type StakesAnswers } from "./init.ts";
import { type LeagueType } from "./lore.ts";
import { type PresetName } from "./persona.ts";
import type { PowerScoreMethod } from "./power-score.ts";
import { type Workspace } from "./workspace.ts";
/** The setup steps `setup <step>` re-runs, in the order `init` asks them. */
export declare const RERUN_STEPS: readonly ["handles", "lore", "stakes", "method", "key", "cap", "persona"];
export type RerunStep = (typeof RERUN_STEPS)[number];
/**
 * One setup step's answers, re-run on its own. An answer left out means the
 * step was skipped this time, which writes its placeholder; a skipped key
 * keeps the one stored.
 */
export type StepRerun = {
    step: "handles";
    league: LeagueCheck;
    handles?: ManagerHandle[];
} | {
    step: "lore";
    league: LeagueCheck;
    lore?: LoreAnswers;
} | {
    step: "stakes";
    stakes?: StakesAnswers;
} | {
    step: "method";
    method?: PowerScoreMethod;
} | {
    step: "key";
    key?: string;
} | {
    step: "cap";
    spendCap: number;
} | {
    step: "persona";
    persona?: PresetName;
};
/** A file a re-run would overwrite, with the diff of what it would change. */
export interface HandEdit {
    file: string;
    /** Line by line: `-` the file's line, `+` the step's, ` ` around them. */
    diff: string;
    /** What overwriting means for the published weeks, such as a changed-outcome warning. */
    warnings: string[];
}
/** Whether `step` names a step `setup <step>` re-runs. */
export declare function isRerunStep(step: string): step is RerunStep;
/** Why `setup <step>` can't re-run `step`, or undefined if it can. */
export declare function rerunStop(step: string): string | undefined;
/**
 * Re-runs one setup step. A file the step writes in the workspace is
 * overwritten only through `confirm`, shown the diff, unless it's missing,
 * still its placeholder or already the step's text. Once written, or with
 * nothing to change, the step's status in `workspace.md`'s `setup:` follows
 * the answers. `warnings` are what the pundit should know of what's left.
 */
export declare function rerunStep(deps: Pick<Deps, "configDir" | "env" | "clock">, dir: string, rerun: StepRerun, confirm: (edit: HandEdit) => Promise<boolean>): Promise<{
    written: boolean;
    warnings: string[];
}>;
/**
 * What a re-run step is preselected from, as `init` has it from earlier steps:
 * the lore's league type and the family league. A file that doesn't load
 * gives no preselection; the step's own write still checks what it writes.
 */
export declare function rerunPreselections(dir: string): Promise<{
    type?: LeagueType;
    familyLeague: boolean;
}>;
/**
 * The workspace's league, fetched live as the league data step does, for the
 * handles and lore steps: the handles `workspace.md` links, and the handles
 * step's list with each linked account under its handle.
 */
export declare function rerunLeague(deps: Deps, dir: string): Promise<{
    league: LeagueCheck;
    linked: ManagerHandle[];
    proposed: ManagerHandle[];
}>;
/**
 * The handles `workspace.md` links, as the handles step lists them, with the
 * display name the league gives each account.
 */
export declare function linkedHandles(ws: Workspace, league: LeagueCheck): ManagerHandle[];
