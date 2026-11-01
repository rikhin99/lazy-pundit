import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

/** The only modules allowed to reach the network or the system clock. */
const PRODUCTION_BOUNDARIES = new Set(["transport.ts", "clock.ts"]);

const FORBIDDEN: [string, RegExp][] = [
  ["the network", /\bfetch\s*\(|node:https?\b|node:net\b|\bWebSocket\b/],
  ["the system clock", /\bDate\.now\b|\bnew Date\(\s*\)|\bperformance\.now\b/],
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath, e.name));
}

test("no module reaches the network or the system clock except through the injected transport and clock", async () => {
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
