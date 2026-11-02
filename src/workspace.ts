import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ConfigFileError, configPath, readConfig } from "./config.ts";
import type { Deps } from "./deps.ts";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.ts";

/** `workspace.md`'s front matter. Its shape is versioned by `FORMAT`. */
export const workspaceSchema = z.object({
  pundit: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  seasons: z
    .record(
      z.string().regex(/^\d{4}$/, "a season is its four-digit year"),
      z.object({
        platform: z.literal("sleeper"),
        league_id: z.string({
          error: "quote the league ID so it isn't read as a number",
        }),
      }),
    )
    .refine((s) => Object.keys(s).length > 0, "name at least one season"),
});

export interface Workspace {
  dir: string;
  pundit: string;
  /** The latest season the workspace names. */
  season: { year: string; platform: "sleeper"; leagueId: string };
}

/** Reads `workspace.md`. */
export async function readWorkspace(dir: string): Promise<Workspace> {
  const file = join(dir, "workspace.md");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    throw new WorkspaceFileError(`No workspace.md in ${dir}`, { cause });
  }
  const { data } = readFrontMatter("workspace.md", text);
  const parsed = workspaceSchema.safeParse(data);
  if (!parsed.success) {
    throw new WorkspaceFileError(
      `workspace.md: ${z.prettifyError(parsed.error)}`,
    );
  }
  const years = Object.keys(parsed.data.seasons).sort();
  const year = years[years.length - 1] as string;
  const season = parsed.data.seasons[year] as {
    platform: "sleeper";
    league_id: string;
  };
  return {
    dir,
    pundit: parsed.data.pundit,
    season: { year, platform: season.platform, leagueId: season.league_id },
  };
}

/**
 * The workspace a command acts on: the one `config.yaml` lists under
 * `league`, or else the folder `cwd` is in that holds a `workspace.md`,
 * searching upwards as git does.
 */
export async function findWorkspace(
  deps: Pick<Deps, "configDir">,
  opts: { cwd: string; league?: string },
): Promise<string> {
  if (opts.league !== undefined) return listedWorkspace(deps, opts.league);
  let dir = resolve(opts.cwd);
  for (;;) {
    if (await exists(join(dir, "workspace.md"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new WorkspaceFileError(
    `No workspace.md in ${opts.cwd} or any folder above it. Run the command inside a league workspace, or pass --league <slug>.`,
  );
}

async function listedWorkspace(
  deps: Pick<Deps, "configDir">,
  slug: string,
): Promise<string> {
  const config = await readConfig(deps);
  const listed = config?.workspaces ?? {};
  const dir = listed[slug];
  if (dir === undefined) {
    const known = Object.keys(listed).sort();
    throw new ConfigFileError(
      `No league "${slug}" in ${configPath(deps)}. ${
        known.length > 0
          ? `Its leagues: ${known.join(", ")}.`
          : "It lists no league workspaces yet; run the command inside the workspace instead."
      }`,
    );
  }
  return dir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The workspace's snapshot folder. */
export function snapshotsDir(ws: Workspace): string {
  return join(ws.dir, ".snapshots");
}

/** The pundit's own folder: their persona and their rankings by season. */
export function punditDir(ws: Workspace): string {
  return join(ws.dir, "pundits", ws.pundit);
}

/** The folder holding the pundit's ranking files for the season. */
export function rankingsDir(ws: Workspace): string {
  return join(punditDir(ws), ws.season.year);
}

/** The latest season's shared folder, holding its `league.md`. */
export function seasonDir(ws: Workspace): string {
  return join(ws.dir, "seasons", ws.season.year);
}

/** `week-08` */
export function weekStem(week: number): string {
  return `week-${String(week).padStart(2, "0")}`;
}
