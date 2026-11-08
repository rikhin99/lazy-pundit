/**
 * Cuts a release tag that `npm i -g github:rikhin99/lazy-pundit#semver:^0`
 * can install, leaving `main` and the working tree as they are.
 *
 * npm can't install a git ref globally if its package.json has a `prepare`
 * or `build` script (npm 11.6.1 and 11.21.2 alike): to prepare the clone it
 * runs `npm install` there with `-g` passed on as `npm_config_global=true`, so
 * the clone is installed globally as a link to a temp folder npm then deletes.
 * So the tag points at a release commit made on top of HEAD, with the built
 * `dist/` added and the `scripts` block left out of package.json, and npm
 * skips preparation. Nothing is pushed: it prints the commands for that.
 *
 *   npm run -s release -- 0.1.0
 *
 * Before tagging it checks: the tree is clean and on `main`, package.json's
 * version is the one given, the tag doesn't exist, and CHANGELOG.md has a
 * `## <version>` entry, whose text it writes to dist/RELEASE_NOTES.md for
 * the GitHub release.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function git(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
}

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** The text under `## <version>` in CHANGELOG.md, up to the next `## ` heading. */
function changelogEntry(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const heading = new RegExp(`^## ${version.replaceAll(".", "\\.")}(\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) fail(`CHANGELOG.md has no "## ${version}" entry`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

const version = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+$/.test(version))
  fail("usage: npm run -s release -- <x.y.z>");
const tag = `v${version}`;

if (git(["status", "--porcelain"]) !== "") fail("the working tree has changes");
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") fail(`on ${branch}, not main`);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.version !== version)
  fail(`package.json is ${pkg.version}, not ${version}`);
if (git(["tag", "--list", tag]) !== "") fail(`tag ${tag} already exists`);
const notes = changelogEntry(
  readFileSync(join(root, "CHANGELOG.md"), "utf8"),
  version,
);

rmSync(join(root, "dist"), { recursive: true, force: true });
execFileSync("npm", ["run", "-s", "build"], { cwd: root, stdio: "inherit" });

const scratch = mkdtempSync(join(tmpdir(), "lazy-pundit-release-"));
try {
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
  git(["read-tree", "HEAD"], env);
  git(["add", "--force", "dist"], env);
  const { scripts: _, ...releasePkg } = pkg;
  const releasePkgPath = join(scratch, "package.json");
  writeFileSync(releasePkgPath, `${JSON.stringify(releasePkg, null, 2)}\n`);
  const blob = git(["hash-object", "-w", releasePkgPath]);
  git(["update-index", "--cacheinfo", `100644,${blob},package.json`], env);
  const tree = git(["write-tree"], env);
  const message = `Release ${version}`;
  const commit = git(["commit-tree", tree, "-p", "HEAD", "-m", message]);
  git(["tag", "-a", tag, commit, "-m", message]);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// In the gitignored dist/, so it lasts until the next build (not a reboot).
const notesFile = join(root, "dist", "RELEASE_NOTES.md");
writeFileSync(notesFile, `${notes}\n`);
console.log(
  `Tagged ${tag} on a release commit with dist/ (main is unchanged).`,
);
console.log(
  "Then push main with the tag, so the release commit's parent is on the remote:",
);
console.log(`  git push origin main ${tag}`);
console.log(
  `  gh release create ${tag} --title ${version} --notes-file ${notesFile}`,
);
