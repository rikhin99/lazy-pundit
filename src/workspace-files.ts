import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { readFrontMatter } from "./front-matter.ts";

/**
 * Writes a workspace Markdown file. Refuses text whose front matter lacks this
 * build's format version, so every file the tool writes can be read back.
 * With `exclusive`, an existing file is left alone and EEXIST is thrown.
 */
export async function writeWorkspaceFile(
  path: string,
  text: string,
  opts: { exclusive?: boolean } = {},
): Promise<void> {
  readFrontMatter(basename(path), text);
  await writeFile(path, text, opts.exclusive ? { flag: "wx" } : {});
}

/**
 * Writes a league-facing output (the plain text, style pages). These are
 * pasted or screenshotted as they are, so they carry no format version.
 */
export async function writeOutput(path: string, text: string): Promise<void> {
  await writeFile(path, text);
}
