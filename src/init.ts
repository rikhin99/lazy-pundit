import { mkdir, readdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { listWorkspace, readConfig } from "./config.ts";
import type { Deps } from "./deps.ts";
import { FORMAT, WorkspaceFileError } from "./front-matter.ts";
import type { LeagueSettings } from "./league.ts";
import { fetchSleeper } from "./sleeper/fetcher.ts";
import {
  type LeagueChoice,
  sleeperLeagueKind,
  sleeperUserLeagues,
} from "./sleeper/setup.ts";
import { FetchError } from "./snapshot.ts";
import { readWorkspace } from "./workspace.ts";
import { writeGitignore, writeWorkspaceFile } from "./workspace-files.ts";

export type { LeagueChoice };

/** A league the league data step has fetched live and accepted. */
export interface LeagueCheck extends LeagueChoice {
  /** What this version doesn't model about the league, which is still accepted. */
  warnings: string[];
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
  };
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

/**
 * Writes a checked league's workspace and lists it in `config.yaml`, last, so
 * the list never names a half-made workspace. Everything that can be refused
 * is refused first, and a failed write takes back what it had written.
 */
export async function setUpWorkspace(
  deps: Pick<Deps, "configDir" | "workspacesDir">,
  answers: { punditName: string; league: LeagueCheck; dir?: string },
): Promise<{ slug: string; dir: string }> {
  const { league } = answers;
  const name = answers.punditName.trim();
  const pundit = slugOf(name);
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
    pundit,
  );
  await refuseFolderInUse(dir);

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
---

# ${league.name}
`,
      { exclusive: true },
    );
    await writeGitignore(join(dir, ".snapshots"), "*");
    // The snapshot folder's own `*` ignores itself, so a clone wouldn't have it;
    // and `transcripts delete` removes its folder. The root's lines outlive both.
    await writeGitignore(dir, ".snapshots/", "transcripts/");
    await listWorkspace(deps, { name, slug, dir });
  } catch (err) {
    for (const entry of ["workspace.md", ".gitignore", ".snapshots"]) {
      await rm(join(dir, entry), { recursive: true, force: true });
    }
    if (firstMade !== undefined) {
      await rm(firstMade, { recursive: true, force: true });
    }
    throw err;
  }
  return { slug, dir };
}
