import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/**
 * A doc comment closed and another opened on the next line: an insertion
 * anchored on a function's first line lands between that function and its
 * doc comment, leaving the function bare and two comments on the new one.
 */
const STACKED = /\*\/[ \t]*\r?\n[ \t]*\/\*\*/g;

test("each doc comment sits on its own declaration, never stacked on another", async () => {
  const offences: string[] = [];
  for (const dir of ["src", "test", "scripts"]) {
    const entries = await readdir(join(ROOT, dir), {
      withFileTypes: true,
      recursive: true,
    });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".ts")) continue;
      const path = join(e.parentPath, e.name);
      const text = await readFile(path, "utf8");
      for (const m of text.matchAll(STACKED)) {
        const line = text.slice(0, m.index).split("\n").length;
        offences.push(`${relative(ROOT, path)}:${line}`);
      }
    }
  }
  expect(offences).toEqual([]);
});
