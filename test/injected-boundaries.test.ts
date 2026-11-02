import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { expect, test } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

/** The only modules allowed to reach the network, system clock or clipboard. */
const PRODUCTION_BOUNDARIES = new Set([
  "transport.ts",
  "clock.ts",
  "clipboard.ts",
]);

const FORBIDDEN: [string, RegExp][] = [
  [
    "the network",
    /(?<![.\w])fetch\s*\(|\bglobalThis\.fetch\b|node:https?\b|node:net\b|\bWebSocket\b/,
  ],
  ["the system clock", /\bDate\.now\b|\bnew Date\(\s*\)|\bperformance\.now\b/],
  ["other processes", /node:child_process\b/],
];

/**
 * A source file's code without its comments, so prose such as "as of the
 * fetch (…)" can't trip a check. A `//` after a colon or inside a string,
 * as in a URL, is left alone.
 */
async function codeOf(file: string): Promise<string> {
  const text = await readFile(file, "utf8");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\w])\/\/.*$/gm, "$1");
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath, e.name));
}

test("no module reaches the network, system clock or other processes except through the injected transport, clock and clipboard", async () => {
  const offences: string[] = [];
  for (const file of await sourceFiles(SRC)) {
    const path = relative(SRC, file);
    if (PRODUCTION_BOUNDARIES.has(path)) continue;
    const text = await codeOf(file);
    for (const [what, pattern] of FORBIDDEN) {
      if (pattern.test(text)) offences.push(`${path} reaches ${what}`);
    }
  }
  expect(offences).toEqual([]);
});

test("only src/deps.ts reads environment variables, the home folder or the Node version", async () => {
  const offences: string[] = [];
  for (const file of await sourceFiles(SRC)) {
    const path = relative(SRC, file);
    if (path === "deps.ts") continue;
    const text = await codeOf(file);
    if (/\bprocess\.(env|version)\b|\bhomedir\b|node:os\b/.test(text)) {
      offences.push(`${path} reads the environment; add it to Deps`);
    }
  }
  expect(offences).toEqual([]);
});

/** The only modules allowed to write files: workspace files, snapshots, the operator's cache and config. */
const FILE_WRITERS = new Set([
  "workspace-files.ts",
  "snapshot.ts",
  "cache.ts",
  "config.ts",
]);

test("workspace files are written only through writeWorkspaceFile or writeOutput, which keep the format version", async () => {
  const offences: string[] = [];
  for (const file of await sourceFiles(SRC)) {
    const path = relative(SRC, file);
    if (FILE_WRITERS.has(path)) continue;
    const text = await codeOf(file);
    if (
      /\b(writeFile|appendFile|createWriteStream|copyFile)(Sync)?\b/.test(text)
    ) {
      offences.push(`${path} writes files directly`);
    }
  }
  expect(offences).toEqual([]);
});

test("the Sleeper API's base URL is written only in src/sleeper/api.ts", async () => {
  const root = join(import.meta.dirname, "..");
  const offences: string[] = [];
  for (const dir of ["src", "test", "scripts"]) {
    for (const file of await sourceFiles(join(root, dir))) {
      const path = relative(root, file);
      if (path === join("src", "sleeper", "api.ts")) continue;
      if (/api\.sleeper\.app/.test(await readFile(file, "utf8"))) {
        offences.push(`${path} restates the URL; import SLEEPER_API`);
      }
    }
  }
  expect(offences).toEqual([]);
});

test("whether a lineup entry started is decided only by isStarter in src/league.ts", async () => {
  const root = join(import.meta.dirname, "..");
  const offences: string[] = [];
  for (const dir of ["src", "scripts"]) {
    for (const file of await sourceFiles(join(root, dir))) {
      const path = relative(root, file);
      // A platform's normalizer reads the platform's own slot names.
      if (
        path === join("src", "league.ts") ||
        path.startsWith(join("src", "sleeper"))
      )
        continue;
      if (/["'`]BN["'`]/.test(await codeOf(file))) {
        offences.push(`${path} checks the bench slot; use isStarter`);
      }
    }
  }
  expect(offences).toEqual([]);
});

test("the validator is pure: beyond its own modules it imports only types from the league model", async () => {
  const own = join(SRC, "validator");
  const files = [join(SRC, "validator.ts"), ...(await sourceFiles(own))];
  const offences: string[] = [];
  for (const file of files) {
    const text = await codeOf(file);
    const imports = text.matchAll(
      /^(?:import|export)\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)"/gms,
    );
    for (const [, typeOnly, from = ""] of imports) {
      const target = join(dirname(file), from);
      const ownModule = from.startsWith(".") && target.startsWith(`${own}/`);
      const leagueTypes = typeOnly && target === join(SRC, "league.ts");
      if (!ownModule && !leagueTypes) {
        offences.push(`${relative(SRC, file)} imports ${from}`);
      }
    }
    if (/\bimport\s*\(/.test(text)) {
      offences.push(`${relative(SRC, file)} imports dynamically`);
    }
  }
  expect(offences).toEqual([]);
});
