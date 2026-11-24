import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { readFrontMatter } from "./front-matter.js";
/**
 * Writes a workspace Markdown file. Refuses text whose front matter lacks this
 * build's version under `versionKey` (`format` unless the file names its own,
 * such as `league.md`'s `league`), so every file the tool writes can be read
 * back. With `exclusive`, an existing file is left alone and EEXIST is thrown.
 */
export async function writeWorkspaceFile(path, text, opts = {}) {
    readFrontMatter(basename(path), text, opts.versionKey ?? "format");
    await writeFile(path, text, opts.exclusive ? { flag: "wx" } : {});
}
/**
 * Writes a `.gitignore` in `dir`, which keeps local files out of a repository.
 * Git reads it as it is, so it carries no format version.
 */
export async function writeGitignore(dir, ...patterns) {
    await writeFile(join(dir, ".gitignore"), `${patterns.join("\n")}\n`);
}
/**
 * Writes a league-facing output (the plain text, style pages). These are
 * pasted or screenshotted as they are, so they carry no format version.
 */
export async function writeOutput(path, text) {
    await writeFile(path, text);
}
//# sourceMappingURL=workspace-files.js.map