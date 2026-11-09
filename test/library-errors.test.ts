import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as library from "../src/index.ts";

const SRC = join(import.meta.dirname, "..", "src");

/** Every `export class <Name>Error` in `src/`, by name. */
async function errorClasses(): Promise<string[]> {
  const files = (await readdir(SRC, { recursive: true })).filter((f) =>
    f.endsWith(".ts"),
  );
  const names: string[] = [];
  for (const file of files) {
    const text = await readFile(join(SRC, file), "utf8");
    for (const m of text.matchAll(/^export class (\w+Error)\b/gm)) {
      names.push(m[1] as string);
    }
  }
  return names.sort();
}

test("every error class in src/ is exported from the library, so a caller can tell it apart", async () => {
  const names = await errorClasses();
  const exported = library as Record<string, unknown>;

  expect(names.length).toBeGreaterThan(0);
  expect(names.filter((n) => typeof exported[n] !== "function")).toEqual([]);
});
