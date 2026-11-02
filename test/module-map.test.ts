import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const MAP = join(ROOT, "docs", "agents", "module-map.md");

/** Every source module, as a path under `src/`. */
async function modules(): Promise<string[]> {
  const entries = await readdir(join(ROOT, "src"), { recursive: true });
  return entries
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.split("\\").join("/"))
    .sort();
}

/** The `src/` paths the map's module table names, in backticks. */
async function mapped(): Promise<string[]> {
  const text = await readFile(MAP, "utf8");
  const table = text.slice(
    text.indexOf("## Modules"),
    text.indexOf("## Tests"),
  );
  return [...table.matchAll(/`([\w/-]+\.ts)`/g)]
    .map((m) => m[1] as string)
    .sort();
}

test("the module map names every source module, and only those", async () => {
  const [actual, named] = await Promise.all([modules(), mapped()]);

  // A new module needs a row in docs/agents/module-map.md; a removed one, its row gone.
  expect(actual.filter((f) => !named.includes(f))).toEqual([]);
  expect(named.filter((f) => !actual.includes(f))).toEqual([]);
});
