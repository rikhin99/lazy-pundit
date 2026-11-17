/**
 * Claims diff: runs a corpus of blurb sentences through the validator at a
 * git ref (HEAD by default) and in the working tree, on the week-8 fixture,
 * and prints each sentence whose claims read differently. Run it after a
 * change to `src/validator.ts` or `src/validator/`, before the reviews. It
 * exits 0 whatever it finds, and 2 when the ref doesn't resolve. The ref's
 * `src/` goes to a temp folder, removed when the run ends; the working tree
 * is never written.
 *
 *   npm run -s claims:diff            # against HEAD
 *   npm run -s claims:diff -- HEAD~1  # after committing
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validate } from "../src/validator.ts";
import { type Check, claimsDiff } from "./claims-diff-report.ts";

const ref = process.argv[2] ?? "HEAD";
const repo = resolve(import.meta.dirname, "..");

const found = spawnSync(
  "git",
  ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
  { cwd: repo, encoding: "utf8" },
);
if (found.status !== 0) {
  console.error(`claims:diff: "${ref}" isn't a commit git knows`);
  process.exit(2);
}

const out = mkdtempSync(join(tmpdir(), "lazy-pundit-claims-diff-"));
let code = 0;
try {
  // `git archive` writes the ref's src/ without touching the working tree
  // or the index, as `git worktree` would.
  const extract = spawnSync(
    "sh",
    ["-c", 'git archive "$1" src | tar -x -C "$2"', "sh", ref, out],
    { cwd: repo, encoding: "utf8" },
  );
  if (extract.status !== 0) throw new Error(extract.stderr.trim());
  // The ref's src/ imports packages; resolve them from the repo's.
  symlinkSync(join(repo, "node_modules"), join(out, "node_modules"), "dir");
  const atRef = (await import(
    pathToFileURL(join(out, "src", "validator.ts")).href
  )) as { validate: Check };
  const lines = claimsDiff(atRef.validate, validate);
  // a clean run prints its one line alone
  if (lines.length > 1) console.log(`claims at ${ref} → the working tree`);
  console.log(lines.join("\n"));
} catch (e) {
  console.error(`claims:diff: ${e instanceof Error ? e.message : e}`);
  code = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(code);
