import type { Deps } from "./deps.ts";
import type { TeamId } from "./league.ts";
import { type LeagueType, type Lore } from "./lore.ts";
import { type PresetName } from "./persona.ts";
import type { PowerScoreMethod } from "./power-score.ts";
import { type LeagueChoice } from "./sleeper/setup.ts";
import { type Platform } from "./snapshot.ts";
import { type LeagueStep, type SetupStatus } from "./workspace.ts";
export type { LeagueChoice };
/** A league the league data step has fetched live and accepted. */
export interface LeagueCheck extends LeagueChoice {
    platform: Platform;
    /** What this version doesn't model about the league, which is still accepted. */
    warnings: string[];
    /** Each team's managers, team by team: one managing two teams is listed twice. */
    managers: LeagueManager[];
    /** Each team with its name and managers, which the lore step's prefill reads. */
    teamList: LeagueTeam[];
}
/** A team as a league's data names it. */
export interface LeagueTeam {
    id: TeamId;
    name: string;
    managers: LeagueManager[];
}
/** A manager as a league's data names them. */
export interface LeagueManager {
    /** `<platform>:<account id>`, as `workspace.md`'s handles link it. */
    account: string;
    displayName: string;
}
/** A manager handle the handles step proposes or the pundit has renamed. */
export interface ManagerHandle extends LeagueManager {
    handle: string;
}
/** A setup answer the tool can't go on with, said so the pundit can act on it. */
export declare class SetupRefusal extends Error {
    name: string;
}
/** An ESPN league that can't be read without a cookie, or a new one: the pundit answers with one. */
export declare class CookieRefusal extends SetupRefusal {
    name: string;
}
export type PlatformChoice = "sleeper" | "espn" | "yahoo";
/** Why setup stops at this platform, or undefined if it can go on. */
export declare function platformStop(platform: PlatformChoice): string | undefined;
/** Where an ESPN league's ID is, said at its prompt. */
export declare const ESPN_LEAGUE_ID_PROMPT = "ESPN league ID (the number after leagueId= in the league's URL)";
/**
 * Why a typed ESPN league ID can't be one, if it can't: it's only digits, so a
 * stray character is caught at the prompt rather than sent to ESPN.
 */
export declare function espnLeagueIdProblem(typed: string): string | undefined;
/**
 * How to copy the ESPN cookie, said before its masked prompt, with a sketch of
 * the browser's cookie table.
 */
export declare const ESPN_COOKIE_HELP = "To copy your espn_s2 cookie:\n  1. In Chrome, Edge or Firefox, sign in at espn.com as a member of the league, and open the league.\n  2. Open the developer tools: F12, or Cmd+Option+I on a Mac.\n  3. Chrome or Edge: Application tab, then Cookies, then https://fantasy.espn.com\n     Firefox: Storage tab, then Cookies, then https://fantasy.espn.com\n  4. Find the row named espn_s2 and copy its whole Value:\n\n     \u250C Cookies \u203A https://fantasy.espn.com \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n     \u2502 Name        Value                                        \u2502\n     \u2502 espn_s2     AEBx9%2F\u2026%3D   \u2190 double-click, copy it all   \u2502\n     \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n\nIt's kept in credentials.yaml on this computer, never in a workspace, and sent only to ESPN.";
/**
 * The league data step's live fetch: proves the league can be read, and says
 * what the tool can't model about it. Nothing is written.
 */
export declare function checkLeague(deps: Deps, leagueId: string): Promise<LeagueCheck>;
/**
 * The league data step's live fetch for an ESPN league, this season's unless
 * `season` names one, with the typed cookie, or else the one held, or none. A
 * league that needs a cookie, or a new one, is a `CookieRefusal`; a league
 * ESPN doesn't know is a `SetupRefusal`. A rejected cookie from
 * `LAZY_PUNDIT_ESPN_S2`, which no typed cookie can replace, is a
 * `FetchError`. Nothing is written.
 */
export declare function checkEspnLeague(deps: Deps, leagueId: string, opts?: {
    cookie?: string;
    season?: string;
}): Promise<LeagueCheck>;
/**
 * The handles step's list: a handle for each manager, from their display name
 * and holding their account, so accepting it links what's in hand and guesses
 * nothing (ADR 0001).
 */
export declare function proposedHandles(league: LeagueCheck): ManagerHandle[];
/**
 * What's wrong with a handle, which a lore heading has to be able to name, or
 * undefined. `others` are the handles the rest of the list holds.
 */
export declare function handleProblem(handle: string, others: string[]): string | undefined;
/** The lore step's league types, the first preselected. */
export declare const LEAGUE_TYPE_CHOICES: {
    value: LeagueType;
    label: string;
}[];
/** Said at the lore step, before anything is asked, and kept atop `lore.md`. */
export declare const LORE_NOTICE = "Lore is sent to the LLM provider with each draft, and kept in this workspace's LLM transcripts until you run lazy-pundit transcripts delete. Don't write anything personal: no addresses, phone numbers, emails, birthdays or health.";
/** One team's nicknames at the lore step, and the lore section they go under. */
export interface TeamNicknames {
    team: TeamId;
    teamName: string;
    /**
     * The section's heading: `{manager=<handle>}` when the handles step linked
     * the team's one manager and they run no other team, else `{team=<id>}`.
     */
    section: string;
    nicknames: string[];
}
/** The lore step's answers. */
export interface LoreAnswers {
    type: LeagueType;
    nicknames: TeamNicknames[];
}
/**
 * The lore step's prefill: each team's name and its managers' display names,
 * leaving out any that would read as another team's, so accepting it never
 * makes a nickname clash, and any the personal-data warning would flag, such
 * as ESPN's default display name (ESPNFAN and ten digits). A team's name and
 * its managers' display names count as nicknames anyway.
 */
export declare function proposedNicknames(league: LeagueCheck, handles?: ManagerHandle[]): TeamNicknames[];
/** A team's typed nicknames, separated by commas. */
export declare function nicknamesOf(typed: string): string[];
/**
 * What's wrong with the lore step's nicknames, or undefined: one that holds a
 * brace or comma, or one that reads as two teams' names, as `lore.md` would
 * refuse to load.
 */
export declare function nicknamesProblem(league: LeagueCheck, handles: ManagerHandle[], nicknames: TeamNicknames[]): string | undefined;
/**
 * What's wrong with lore's nicknames against the league, or undefined: one
 * that reads as two teams' names, as a draft would refuse.
 */
export declare function loreNamesProblem(league: LeagueCheck, handles: ManagerHandle[], lore: Lore): string | undefined;
/** A house rule the stakes step offers, with the trigger the tool can work out. */
export interface CommonHouseRule {
    id: string;
    name: string;
    trigger: string;
    per: "week" | "season";
}
/** The stakes step's checklist of common house rules, each asked for its outcome. */
export declare const COMMON_HOUSE_RULES: CommonHouseRule[];
/** The stakes step's structured fields, when something besides bragging rights is at stake. */
export interface StakesFields {
    /** Dollars per team. */
    buyIn: number;
    /** By place, first place first: `$N` or `N%` of the pot. */
    payouts: string[];
    houseRules: {
        rule: CommonHouseRule;
        outcome: string;
    }[];
}
/** The stakes and family league step's answers. */
export interface StakesAnswers {
    /** `none` only on an explicit No at "Is anything at stake besides bragging rights?". */
    stakes: "none" | StakesFields;
    familyLeague: boolean;
}
/** The asking text of the stakes step's first question, default No. */
export declare const STAKES_QUESTION = "Is anything at stake besides bragging rights?";
/** The payouts when the pundit takes the default: winner takes all. */
export declare const WINNER_TAKES_ALL: string[];
/** Whether the family league starts on: only for a family league type. */
export declare function familyLeagueDefault(type: LeagueType | undefined): boolean;
/** What's wrong with a typed buy-in, or undefined. */
export declare function buyInProblem(typed: string): string | undefined;
/** The typed payouts, one per place, first place first. */
export declare function payoutsOf(typed: string): string[];
/**
 * What's wrong with typed payouts, or undefined: each place's payout is `$N`
 * or `N%` of the pot, and the shares come to 100% at most.
 */
export declare function payoutsProblem(typed: string): string | undefined;
/** What's wrong with a typed house rule outcome, or undefined. */
export declare function outcomeProblem(typed: string): string | undefined;
/** The answered stakes step's `league.md`, or its placeholder when skipped. */
export declare function leagueText(season: string, answers: StakesAnswers | undefined, 
/** The family league to write; a skipped re-run passes the one recorded. */
familyLeague?: boolean): string;
/** The name `config.yaml` gives the operator, the pundit name step's default. */
export declare function defaultPunditName(deps: Pick<Deps, "configDir">): Promise<string | undefined>;
/** A league in the pick list, with the folder of the workspace that holds it, if one does. */
export interface PickListLeague extends LeagueChoice {
    setUpIn?: string;
}
/**
 * The league data step's pick list: a Sleeper account's leagues this season,
 * each marked with the listed workspace that already holds it. Sleeper gives
 * each season's league its own ID, so one set up for an earlier season only
 * isn't marked.
 */
export declare function sleeperLeagues(deps: Pick<Deps, "transport" | "clock" | "configDir">, accountName: string): Promise<PickListLeague[]>;
/**
 * Refuses a league a listed workspace already holds, as the folder check
 * would, so `init` can say so before the league data step's live fetch.
 */
export declare function refuseLeagueSetUp(deps: Pick<Deps, "configDir">, answers: {
    punditName: string;
} & HeldLeague): Promise<void>;
/** What's wrong with a pundit name, which has to give a slug, or undefined. */
export declare function punditNameProblem(name: string): string | undefined;
/** A league as a workspace names it: two platforms can give one ID. */
interface HeldLeague {
    platform: Platform;
    leagueId: string;
}
/** The method step's choices, the default first so one key accepts it. */
export declare const METHOD_CHOICES: {
    value: PowerScoreMethod;
    label: string;
}[];
/**
 * `persona.md` with this preset. Its explanation goes in YAML comments, since
 * all of the body is the style note, sent with every draft.
 */
export declare function personaText(preset: PresetName): string;
/** The persona step's preselection, from the lore's league type. */
export declare function personaDefault(type: LeagueType | undefined): PresetName;
/**
 * What the family league lowers in a preset, said at the persona step, or
 * undefined when it lowers nothing: swearing to off, teasing to light.
 */
export declare function familyLeagueLowers(preset: PresetName, familyLeague: boolean): string | undefined;
/** The method step's pundit settings: a file naming no method reads as the default. */
export declare function settingsText(method: PowerScoreMethod | undefined): string;
/** The lore step's `lore.md`, or its placeholder when skipped. */
export declare function loreFileText(answers: LoreAnswers | undefined, league: LeagueCheck): string;
/** Broadcast, the persona with no `persona.md`, is the default. */
export declare function personaStatus(preset: PresetName | undefined): SetupStatus;
export declare function methodStatus(method: PowerScoreMethod | undefined): SetupStatus;
/** One line of the setup checklist. */
export interface ChecklistItem {
    step: LeagueStep | "pundit name" | "league data" | "key" | "cap";
    status: SetupStatus;
}
/**
 * The setup checklist, in the order `init` asks the steps. `workspace.md`
 * records how each league-level step went, and any step it doesn't name reads
 * as skipped. The key and cap belong to the operator, so they read as they
 * stand now, whichever league set them.
 */
export declare function setupChecklist(deps: Pick<Deps, "configDir" | "env">, dir: string): Promise<ChecklistItem[]>;
/**
 * Why the folder question's default is where it is, for the wizard to say:
 * the current folder is inside a listed workspace, so the default sits next
 * to it, or the default is in the current folder itself.
 */
export type DefaultFolderReason = {
    workspaceYoureIn: string;
} | {
    currentFolder: string;
};
/**
 * The folder a league's workspace gets when the folder question is left
 * empty, named after its slug: next to the listed workspace the current
 * folder is in, in the workspaces folder from the home folder or above it,
 * or else in the current folder. `reason` says which, except for the
 * workspaces folder.
 */
export declare function defaultWorkspaceFolder(deps: Pick<Deps, "configDir" | "workspacesDir" | "homeDir" | "cwd">, league: LeagueCheck): Promise<{
    dir: string;
    reason?: DefaultFolderReason;
}>;
/**
 * A typed folder whose last part ends in a dot, such as `my-league.`, without
 * those dots: likely a typo, which would make a sibling of the folder meant.
 * Undefined for any other path, and for a last part of only dots.
 */
export declare function withoutTrailingDots(typed: string): string | undefined;
/**
 * Where a league's workspace would go: its slug and folder, or the refusal
 * `setUpWorkspace` would give. Nothing is written, so the wizard can say so
 * right after the folder question rather than after every other step.
 */
export declare function checkWorkspace(deps: Pick<Deps, "configDir" | "workspacesDir" | "homeDir" | "cwd">, answers: {
    punditName: string;
    league: LeagueCheck;
    dir?: string;
}): Promise<{
    slug: string;
    dir: string;
}>;
/**
 * The setup steps `setup <step>` re-runs, in the order `init` asks them. Here
 * rather than in `rerun.ts`, which imports this file, so init's note can name
 * them.
 */
export declare const RERUN_STEPS: readonly ["espn", "handles", "lore", "stakes", "method", "key", "cap", "persona"];
/**
 * Said once the folder is accepted, before the first setup step: how to change
 * an answer after setup, for the setup steps and for the steps before them.
 */
export declare function changeAnswersNote(deps: Pick<Deps, "configDir">, workspace: {
    slug: string;
    dir: string;
    platform: Platform;
}): string;
/** What the key and cap step still has to ask this operator. */
export interface OperatorSteps {
    askKey: boolean;
    askCap: boolean;
    /** The spend cap now: what to offer when it's asked. */
    spendCap: number;
}
/**
 * The operator's steps are asked only when missing. The key is missing with
 * none stored or in the environment. The cap always has a value once
 * `config.yaml` exists, so it's asked with no config, or alongside a key still
 * to come, when it first starts to matter.
 */
export declare function operatorSteps(deps: Pick<Deps, "configDir" | "env">): Promise<OperatorSteps>;
/** Said at the key step, before asking. */
export declare const KEY_EXPLANATION = "An Anthropic key lets the LLM write your blurbs. It's stored on this machine, never in a workspace. Claude Pro doesn't include API credits; Max and Ultra do.";
/** Said when the key step is skipped. */
export declare const KEY_SKIPPED = "With no key, each draft is stat lines and says why. Add one later with ANTHROPIC_API_KEY or credentials.yaml.";
/** Said when the handles step is skipped. */
export declare const HANDLES_SKIPPED = "With no handles, manager sections in the lore aren't sent until their handles are linked. Team sections still are.";
/**
 * Checks a key live, which spends nothing. A `problem` means Anthropic refused
 * it, so ask again. A `warning` means it couldn't be checked, so it's kept.
 */
export declare function checkKey(deps: Pick<Deps, "transport">, key: string): Promise<{
    problem?: string;
    warning?: string;
}>;
/** What's wrong with a typed spend cap, or undefined. */
export declare function spendCapProblem(typed: string): string | undefined;
/**
 * Said for a cap so small that one call can't fit under it: a call's check
 * counts its whole `MAX_TOKENS` reply, before any of its prompt.
 */
export declare function spendCapWarning(deps: Pick<Deps, "configDir">, cap: number): Promise<string | undefined>;
/**
 * Said at the cap step when it's re-run: this month's spend so far, the cap,
 * and what one draft can ask of it, so the new cap leaves room for a draft.
 */
export declare function spendCapNote(deps: Pick<Deps, "configDir" | "clock">): Promise<string>;
/**
 * Writes a checked league's workspace and lists it in `config.yaml`, last, so
 * the list never names a half-made workspace. Everything that can be refused
 * is refused first, and a failed write takes back what it had written. Any
 * file `writeStepFiles` adds goes in `WRITTEN`.
 */
export declare function setUpWorkspace(deps: Pick<Deps, "configDir" | "workspacesDir" | "homeDir" | "cwd" | "clock" | "env">, answers: {
    punditName: string;
    league: LeagueCheck;
    dir?: string;
    /** The handles step's list; left out when the step is skipped. */
    handles?: ManagerHandle[];
    /** The lore step's answers; left out when the step is skipped. */
    lore?: LoreAnswers;
    /** The stakes and family league step's answers; left out when it's skipped. */
    stakes?: StakesAnswers;
    /** The method step's choice; left out when the step is skipped. */
    method?: PowerScoreMethod;
    /** The persona step's preset; left out when the step is skipped. */
    persona?: PresetName;
    /** A key that has passed `checkKey`; left out when it's skipped or already held. */
    key?: string;
    /** The spend cap; left out when it's skipped or already held. */
    spendCap?: number;
    /** An ESPN cookie typed at the league data step, which read the league. */
    cookie?: string;
}): Promise<{
    slug: string;
    dir: string;
}>;
