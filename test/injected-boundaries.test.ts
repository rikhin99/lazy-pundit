import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
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
    const text = await readFile(file, "utf8");
    for (const [what, pattern] of FORBIDDEN) {
      if (pattern.test(text)) offences.push(`${path} reaches ${what}`);
    }
  }
  expect(offences).toEqual([]);
});

/** The only modules allowed to write files: workspace files, snapshots and the person-level cache. */
const FILE_WRITERS = new Set(["workspace-files.ts", "snapshot.ts", "cache.ts"]);

test("workspace files are written only through writeWorkspaceFile or writeOutput, which keep the format version", async () => {
  const offences: string[] = [];
  for (const file of await sourceFiles(SRC)) {
    const path = relative(SRC, file);
    if (FILE_WRITERS.has(path)) continue;
    const text = await readFile(file, "utf8");
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
