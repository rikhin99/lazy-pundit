import { mkdir, readdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { stringify } from "yaml";
import { checkAnthropicKey } from "./anthropic.ts";
import {
  defaultConfig,
  listWorkspace,
  loadCredentials,
  readConfig,
  saveCredentials,
} from "./config.ts";
import type { Deps } from "./deps.ts";
import { FORMAT, WorkspaceFileError } from "./front-matter.ts";
import type { LeagueSettings } from "./league.ts";
import { leagueFilePath } from "./league-file.ts";
import { MAX_TOKENS } from "./llm-call.ts";
import { personaPath } from "./persona.ts";
import type { PowerScoreMethod } from "./power-score.ts";
import { ceilingCost, priceOf, usd } from "./prices.ts";
import { DEFAULT_SETTINGS, punditSettingsPath } from "./pundit-settings.ts";
import { fetchSleeper } from "./sleeper/fetcher.ts";
import {
  type LeagueChoice,
  sleeperLeagueKind,
  sleeperUserLeagues,
} from "./sleeper/setup.ts";
import { FetchError } from "./snapshot.ts";
import {
  type LeagueStep,
  punditDir,
  readWorkspace,
  type SetupStatus,
  seasonDir,
  type Workspace,
} from "./workspace.ts";
import { writeGitignore, writeWorkspaceFile } from "./workspace-files.ts";

export type { LeagueChoice };

/** A league the league data step has fetched live and accepted. */
export interface LeagueCheck extends LeagueChoice {
  /** What this version doesn't model about the league, which is still accepted. */
  warnings: string[];
  /** Each team's managers, team by team: one managing two teams is listed twice. */
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
export class SetupRefusal extends Error {
  override name = "SetupRefusal";
}

export type PlatformChoice = "sleeper" | "espn" | "yahoo";

/** Why setup stops at this platform, or undefined if it can go on. */
export function platformStop(platform: PlatformChoice): string | undefined {
  if (platform === "yahoo") return "Yahoo support comes in a later release.";
  if (platform === "espn") return "ESPN support comes in a later release.";
  return undefined;
}

/** What this version doesn't model about a league it still accepts. */
function leagueWarnings(settings: LeagueSettings): string[] {
  const warnings: string[] = [];
  const noStatus = (what: string) =>
    `This league uses ${what}, which this version doesn't model, so the league gets no playoff status: no team is called clinched or eliminated.`;
  if (settings.median) warnings.push(noStatus("median scoring"));
  if (settings.divisions > 0) warnings.push(noStatus("divisions"));
  if (settings.keepers !== null) {
    warnings.push(
      `This league has ${settings.keepers} rules, which this version doesn't model: rankings treat it as a redraft league.`,
    );
  }
  return warnings;
}

/**
 * The league data step's live fetch: proves the league can be read, and says
 * what the tool can't model about it. Nothing is written.
 */
export async function checkLeague(
  deps: Deps,
  leagueId: string,
): Promise<LeagueCheck> {
  const kind = await sleeperLeagueKind(deps.transport, leagueId);
  if (kind === undefined) {
    throw new SetupRefusal(
      `Sleeper has no league with the ID ${leagueId}. Check it against the league's URL, or pick from your leagues by username.`,
    );
  }
  if (kind.sport !== undefined && kind.sport !== "nfl") {
    throw new SetupRefusal(
      `This league's sport is ${kind.sport}, and Lazy Pundit ranks football leagues only.`,
    );
  }
  if (!kind.pointValues) {
    throw new SetupRefusal(
      "This league has no point values, as a categories or roto league wouldn't, and Lazy Pundit ranks only leagues scored by points.",
    );
  }
  const { league } = await fetchSleeper({
    transport: deps.transport,
    clock: deps.clock,
    // Never written: this fetch's `write` isn't called.
    snapshotsDir: join(deps.cacheDir, "unused"),
    cacheDir: deps.cacheDir,
    leagueId,
  }).catch((err: unknown) => {
    if (err instanceof FetchError) throw err;
    throw new SetupRefusal(
      `Can't read Sleeper league ${leagueId}: ${(err as Error).message}`,
      { cause: err },
    );
  });
  return {
    leagueId: league.leagueId,
    name: league.name,
    season: league.season,
    teams: league.teams.length,
    warnings: leagueWarnings(league.settings),
    managers: league.teams
      .flatMap((t) => t.managers)
      .map((m) => ({
        account: `${league.platform}:${m.accountId}`,
        displayName: m.displayName,
      })),
  };
}

/**
 * The handles step's list: a handle for each manager, from their display name
 * and holding their account, so accepting it links what's in hand and guesses
 * nothing (ADR 0001).
 */
export function proposedHandles(league: LeagueCheck): ManagerHandle[] {
  const taken = new Set<string>();
  const proposed: ManagerHandle[] = [];
  for (const manager of new Map(
    league.managers.map((m) => [m.account, m]),
  ).values()) {
    const base = slugOf(manager.displayName) || "manager";
    let handle = base;
    for (let n = 2; taken.has(handle); n++) handle = `${base}-${n}`;
    taken.add(handle);
    proposed.push({ ...manager, handle });
  }
  return proposed;
}

/**
 * What's wrong with a handle, which a lore heading has to be able to name, or
 * undefined. `others` are the handles the rest of the list holds.
 */
export function handleProblem(
  handle: string,
  others: string[],
): string | undefined {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) {
    return "A handle is lowercase letters, digits and dashes, so a lore heading can name it.";
  }
  if (others.includes(handle)) {
    return `Another manager already has the handle ${handle}.`;
  }
  return undefined;
}

/** Lowercase letters, digits and dashes, from any name. */
function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The name `config.yaml` gives the operator, the pundit name step's default. */
export async function defaultPunditName(
  deps: Pick<Deps, "configDir">,
): Promise<string | undefined> {
  return (await readConfig(deps))?.name;
}

/** The NFL season a date falls in: January and February finish last year's. */
function seasonAt(date: Date): string {
  const year = date.getFullYear();
  return String(date.getMonth() < 2 ? year - 1 : year);
}

/** The league data step's pick list: a Sleeper account's leagues this season. */
export async function sleeperLeagues(
  deps: Pick<Deps, "transport" | "clock">,
  accountName: string,
): Promise<LeagueChoice[]> {
  const leagues = await sleeperUserLeagues(
    deps.transport,
    accountName,
    seasonAt(deps.clock.now()),
  );
  if (leagues === undefined) {
    throw new SetupRefusal(`Sleeper has no account named ${accountName}.`);
  }
  return leagues;
}

/** What's wrong with a pundit name, which has to give a slug, or undefined. */
export function punditNameProblem(name: string): string | undefined {
  return slugOf(name) === ""
    ? "A pundit name needs at least a letter or digit."
    : undefined;
}

/** Refuses a league one of these folders already holds a workspace for. */
async function refuseLeagueInWorkspace(
  dirs: string[],
  leagueId: string,
  pundit: string,
): Promise<void> {
  for (const dir of dirs) {
    // A listed workspace that can't be read is `doctor`'s to report.
    const ws = await readWorkspace(dir).catch((err: unknown) => {
      if (err instanceof WorkspaceFileError) return undefined;
      throw err;
    });
    if (ws?.season.leagueId !== leagueId) continue;
    throw new SetupRefusal(
      ws.pundit === pundit
        ? `This league is already set up in ${dir}.`
        : `This league's workspace in ${dir} belongs to ${ws.pundit}, and multi-pundit is a later stage.`,
    );
  }
}

/** The league's slug, numbered if another league's workspace has it. */
function freeSlug(listed: Record<string, string>, leagueName: string): string {
  const base = slugOf(leagueName) || "league";
  let slug = base;
  for (let n = 2; slug in listed; n++) slug = `${base}-${n}`;
  return slug;
}

function folderRefusal(dir: string, cause: NodeJS.ErrnoException) {
  return new SetupRefusal(
    `Can't use ${dir} for this league's workspace (${cause.code}). Choose another folder.`,
    { cause },
  );
}

/** Refuses a folder with anything in it. A missing one is fine. */
async function refuseFolderInUse(dir: string): Promise<void> {
  const entries = await readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw folderRefusal(dir, err);
  });
  if (entries.length > 0) {
    throw new SetupRefusal(
      `${dir} isn't empty. Choose a new folder for this league's workspace.`,
    );
  }
}

/** The method step's choices, the default first so one key accepts it. */
export const METHOD_CHOICES: { value: PowerScoreMethod; label: string }[] = [
  { value: "ramped-blend", label: "Ramped blend (the default)" },
  { value: "standings", label: "Standings" },
  { value: "ppg", label: "Points per game" },
  { value: "all-play", label: "All-play record" },
  { value: "form", label: "Form" },
  { value: "ffwrapped", label: "The ffwrapped formula" },
  { value: "ffmwr", label: "The FFMWR rank average" },
];

const LORE_PLACEHOLDER = `---
lore: 1
---

# Lore

<!--
Everything outside a comment like this one is sent to the LLM provider with each
draft, so don't write anything personal: no addresses, phone numbers, birthdays
or health. Lore is context for the prose, and the data still comes from the league.

Sections look like this:

## League
type: friends

## {manager=their-handle}
nicknames: Bo, The Boss
- Hasn't won a title since 2019.
-->
`;

const LEAGUE_PLACEHOLDER = `---
league: 1
# Set this to on to keep every persona clean, whatever it asks for.
family-league: off
---
`;

const PERSONA_PLACEHOLDER = `---
format: ${FORMAT}
# broadcast, family, banter or roast. Anything below the front matter is your style note.
preset: broadcast
---
`;

/**
 * The files the steps after the league data leave: the pundit settings, and the
 * lore, stakes and persona placeholders a pundit can fill in by hand. A settings
 * file naming no method reads as the default.
 */
async function writeStepFiles(
  ws: Workspace,
  method: PowerScoreMethod | undefined,
): Promise<void> {
  await mkdir(punditDir(ws), { recursive: true });
  await mkdir(seasonDir(ws), { recursive: true });
  const chosen =
    method === undefined || method === DEFAULT_SETTINGS.method
      ? ""
      : `method: ${method}\n`;
  await writeWorkspaceFile(
    punditSettingsPath(ws),
    `---
format: ${FORMAT}
# method: ${METHOD_CHOICES.map((c) => c.value).join(", ")}. With none, ${DEFAULT_SETTINGS.method}.
${chosen}---
`,
  );
  await writeWorkspaceFile(join(ws.dir, "lore.md"), LORE_PLACEHOLDER, {
    versionKey: "lore",
  });
  await writeWorkspaceFile(leagueFilePath(ws), LEAGUE_PLACEHOLDER, {
    versionKey: "league",
  });
  await writeWorkspaceFile(personaPath(ws), PERSONA_PLACEHOLDER);
}

function methodStatus(method: PowerScoreMethod | undefined): SetupStatus {
  if (method === undefined) return "skipped";
  return method === DEFAULT_SETTINGS.method ? "default" : "done";
}

/** Why `setup <step>` stops: re-running one step isn't built yet (#61). */
export function rerunNotBuilt(step: string): string {
  return `Re-running one step, as lazy-pundit setup ${step} would, comes in a later release. For now, set ANTHROPIC_API_KEY for the key, or edit config.yaml or the workspace's files by hand.`;
}

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
export async function setupChecklist(
  deps: Pick<Deps, "configDir" | "env">,
  dir: string,
): Promise<ChecklistItem[]> {
  const { setup } = await readWorkspace(dir);
  const { askKey, spendCap } = await operatorSteps(deps);
  const hasKey = !askKey;
  const { spend_cap_usd } = defaultConfig();
  return [
    { step: "pundit name", status: "done" },
    { step: "league data", status: "done" },
    { step: "handles", status: setup.handles ?? "skipped" },
    { step: "lore", status: setup.lore ?? "skipped" },
    { step: "stakes", status: setup.stakes ?? "skipped" },
    { step: "method", status: setup.method ?? "skipped" },
    { step: "key", status: hasKey ? "done" : "skipped" },
    { step: "cap", status: spendCap === spend_cap_usd ? "default" : "done" },
    { step: "persona", status: setup.persona ?? "skipped" },
  ];
}

/**
 * Where a league's workspace would go: its slug and folder, or the refusal
 * `setUpWorkspace` would give. Nothing is written, so the wizard can say so
 * right after the folder question rather than after every other step.
 */
export async function checkWorkspace(
  deps: Pick<Deps, "configDir" | "workspacesDir">,
  answers: { punditName: string; league: LeagueCheck; dir?: string },
): Promise<{ slug: string; dir: string }> {
  const { league } = answers;
  const name = answers.punditName.trim();
  const nameProblem = punditNameProblem(name);
  if (nameProblem !== undefined) throw new SetupRefusal(nameProblem);
  if (answers.dir !== undefined && !isAbsolute(answers.dir)) {
    throw new SetupRefusal(
      `Give the workspace's full path, such as ${join(deps.workspacesDir, "my-league")}, not ${answers.dir}.`,
    );
  }
  const listed = (await readConfig(deps))?.workspaces ?? {};
  const slug = freeSlug(listed, league.name);
  const dir = answers.dir ?? join(deps.workspacesDir, slug);
  await refuseLeagueInWorkspace(
    [...Object.values(listed), dir],
    league.leagueId,
    slugOf(name),
  );
  await refuseFolderInUse(dir);
  return { slug, dir };
}

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
export async function operatorSteps(
  deps: Pick<Deps, "configDir" | "env">,
): Promise<OperatorSteps> {
  const config = await readConfig(deps);
  const askKey = !(await loadCredentials(deps)).anthropicApiKey;
  return {
    askKey,
    askCap: askKey || config === undefined,
    spendCap: (config ?? defaultConfig()).spend_cap_usd,
  };
}

/** Said at the key step, before asking. */
export const KEY_EXPLANATION =
  "An Anthropic key lets the LLM write your blurbs. It's stored on this machine, never in a workspace. Claude Pro doesn't include API credits; Max and Ultra do.";

/** Said when the key step is skipped. */
export const KEY_SKIPPED =
  "With no key, each draft is stat lines and says why. Add one later with ANTHROPIC_API_KEY or credentials.yaml.";

/** Said when the handles step is skipped. */
export const HANDLES_SKIPPED =
  "With no handles, manager sections in the lore aren't sent until their handles are linked. Team sections still are.";

/**
 * Checks a key live, which spends nothing. A `problem` means Anthropic refused
 * it, so ask again. A `warning` means it couldn't be checked, so it's kept.
 */
export async function checkKey(
  deps: Pick<Deps, "transport">,
  key: string,
): Promise<{ problem?: string; warning?: string }> {
  const answer = await checkAnthropicKey(deps.transport, key);
  if (answer === "ok") return {};
  if (answer === "rejected") {
    return { problem: "Anthropic refused that key. Check it and try again." };
  }
  return {
    warning: `The key is saved, but Lazy Pundit couldn't check it (${answer.unreachable}). lazy-pundit doctor checks it again.`,
  };
}

/** What's wrong with a typed spend cap, or undefined. */
export function spendCapProblem(typed: string): string | undefined {
  return /^\d+(\.\d+)?$/.test(typed.trim()) &&
    Number.isFinite(Number(typed.trim()))
    ? undefined
    : "Give the spend cap as a number of US dollars, such as 5.";
}

/**
 * Said for a cap so small that one call can't fit under it: a call's check
 * counts its whole `MAX_TOKENS` reply, before any of its prompt.
 */
export async function spendCapWarning(
  deps: Pick<Deps, "configDir">,
  cap: number,
): Promise<string | undefined> {
  const config = (await readConfig(deps)) ?? defaultConfig();
  const price = priceOf(config);
  if (price === undefined) return undefined;
  const least = ceilingCost(price, {
    system: "",
    prompt: "",
    maxTokens: MAX_TOKENS,
  });
  if (cap >= least) return undefined;
  return `One LLM call on ${config.model} can cost more than ${usd(least)}, so under a spend cap of ${usd(cap)} every draft falls back to stat lines.`;
}

/** Everything `setUpWorkspace` writes in the workspace, which a failure takes back. */
const WRITTEN = [
  "workspace.md",
  ".gitignore",
  ".snapshots",
  "lore.md",
  "pundits",
  "seasons",
];

/**
 * Writes a checked league's workspace and lists it in `config.yaml`, last, so
 * the list never names a half-made workspace. Everything that can be refused
 * is refused first, and a failed write takes back what it had written. Any
 * file `writeStepFiles` adds goes in `WRITTEN`.
 */
export async function setUpWorkspace(
  deps: Pick<Deps, "configDir" | "workspacesDir" | "clock" | "env">,
  answers: {
    punditName: string;
    league: LeagueCheck;
    dir?: string;
    /** The handles step's list; left out when the step is skipped. */
    handles?: ManagerHandle[];
    /** The method step's choice; left out when the step is skipped. */
    method?: PowerScoreMethod;
    /** A key that has passed `checkKey`; left out when it's skipped or already held. */
    key?: string;
    /** The spend cap; left out when it's skipped or already held. */
    spendCap?: number;
  },
): Promise<{ slug: string; dir: string }> {
  const { league } = answers;
  const handles = answers.handles ?? [];
  for (const [i, { handle }] of handles.entries()) {
    const others = handles.slice(0, i).map((h) => h.handle);
    const problem = handleProblem(handle, others);
    if (problem !== undefined) throw new SetupRefusal(problem);
  }
  if (
    answers.spendCap !== undefined &&
    spendCapProblem(String(answers.spendCap)) !== undefined
  ) {
    throw new SetupRefusal(
      `A spend cap of ${answers.spendCap} can't be written: ${spendCapProblem(String(answers.spendCap))}`,
    );
  }
  const { slug, dir } = await checkWorkspace(deps, answers);
  // A credentials file that can't be read would refuse the key after the
  // listing, so it stops here, before anything is written.
  if (answers.key) await loadCredentials(deps);
  const name = answers.punditName.trim();
  const pundit = slugOf(name);
  const setup: Required<Workspace["setup"]> = {
    handles: handles.length === 0 ? "skipped" : "done",
    // The placeholders: #61 asks these.
    lore: "skipped",
    stakes: "skipped",
    method: methodStatus(answers.method),
    persona: "skipped",
  };

  const firstMade = await mkdir(dir, { recursive: true }).catch(
    (err: NodeJS.ErrnoException) => {
      throw folderRefusal(dir, err);
    },
  );
  try {
    await mkdir(join(dir, ".snapshots"));
    await writeWorkspaceFile(
      join(dir, "workspace.md"),
      `---
format: ${FORMAT}
pundit: ${pundit}
seasons:
  ${league.season}:
    platform: sleeper
    league_id: "${league.leagueId}"
${
  handles.length === 0
    ? ""
    : stringify({
        handles: Object.fromEntries(
          handles.map((h) => [h.handle, [h.account]]),
        ),
      })
}${stringify({ setup })}---

# ${league.name}
`,
      { exclusive: true },
    );
    await writeStepFiles(await readWorkspace(dir), answers.method);
    await writeGitignore(join(dir, ".snapshots"), "*");
    // The snapshot folder's own `*` ignores itself, so a clone wouldn't have it;
    // and `transcripts delete` removes its folder. The root's lines outlive both.
    await writeGitignore(dir, ".snapshots/", "transcripts/");
    await listWorkspace(deps, {
      name,
      slug,
      dir,
      ...(answers.spendCap === undefined ? {} : { spendCap: answers.spendCap }),
    });
  } catch (err) {
    for (const entry of WRITTEN) {
      await rm(join(dir, entry), { recursive: true, force: true });
    }
    if (firstMade !== undefined) {
      await rm(firstMade, { recursive: true, force: true });
    }
    throw err;
  }
  // The key is the operator's, not the workspace's, so it's saved once the
  // workspace is listed. Saved first, a listing that failed would keep the key
  // and lose the cap: the next `init` asks the cap only with a key to come.
  if (answers.key) {
    await saveCredentials(deps, { anthropicApiKey: answers.key });
  }
  return { slug, dir };
}
