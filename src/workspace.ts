import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.ts";

const workspaceSchema = z.object({
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

/** The workspace's snapshot folder. */
export function snapshotsDir(ws: Workspace): string {
  return join(ws.dir, ".snapshots");
}

/** The folder holding the pundit's ranking files for the season. */
export function rankingsDir(ws: Workspace): string {
  return join(ws.dir, "pundits", ws.pundit, ws.season.year);
}

/** `week-08` */
export function weekStem(week: number): string {
  return `week-${String(week).padStart(2, "0")}`;
}
