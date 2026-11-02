import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.ts";
import { seasonDir, type Workspace } from "./workspace.ts";

/** Where the season's `league.md` lives. */
export function leagueFilePath(ws: Workspace): string {
  return join(seasonDir(ws), "league.md");
}

/**
 * Whether the season's `league.md` turns the family league on. A missing file
 * means off. Only `family-league` is read here; the stakes (#56) add the rest
 * of the file's schema.
 */
export async function familyLeague(ws: Workspace): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(leagueFilePath(ws), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return false;
  }
  const { data } = readFrontMatter("league.md", text, "league");
  const parsed = z
    .enum(["on", "off"], { error: 'family-league is "on" or "off"' })
    .optional()
    .safeParse(data["family-league"]);
  if (!parsed.success) {
    throw new WorkspaceFileError(`league.md: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data === "on";
}
