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

/** The values `test/support/` exports, as `file: name` (types and default exports left out). */
async function supportHelpers(): Promise<string[]> {
  const dir = join(ROOT, "test", "support");
  const helpers: string[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".ts"))) {
    const text = await readFile(join(dir, file), "utf8");
    for (const m of text.matchAll(
      /^export (?:async )?(?:function|const|class) (\w+)/gm,
    )) {
      helpers.push(`${file}: ${m[1]}`);
    }
  }
  return helpers.sort();
}

test("the module map's Tests section names every helper test/support/ exports", async () => {
  const text = await readFile(MAP, "utf8");
  const tests = text.slice(text.indexOf("## Tests"));
  const named = (name: string) => new RegExp(`\`${name}(?![\\w])`).test(tests);

  // A new helper in test/support/ needs a mention under "## Tests" in docs/agents/module-map.md.
  expect(
    (await supportHelpers()).filter((h) => !named(h.split(": ")[1] ?? "")),
  ).toEqual([]);
});

/** The names `src/index.ts` exports, values and types. */
async function indexExports(): Promise<Set<string>> {
  const text = await readFile(join(ROOT, "src", "index.ts"), "utf8");
  const names = new Set<string>();
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of (m[1] as string).split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name);
    }
  }
  for (const m of text.matchAll(
    /export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+(\w+)/g,
  )) {
    names.add(m[1] as string);
  }
  return names;
}

// In #92 the standards review's one hard finding was a test importing
// `WorkspaceFileError` from front-matter.ts, which index.ts exports.
test("tests import from a src/ module only what index.ts doesn't export (Direct imports)", async () => {
  const exported = await indexExports();
  const dir = join(ROOT, "test");
  const direct: string[] = [];
  for (const file of await readdir(dir, { recursive: true })) {
    if (!file.endsWith(".ts")) continue;
    const text = await readFile(join(dir, file), "utf8");
    for (const m of text.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"((?:\.\.\/)+src\/[^"]+)"/g,
    )) {
      if ((m[2] as string).endsWith("/index.ts")) continue;
      for (const part of (m[1] as string).split(",")) {
        const name = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        if (name && exported.has(name)) direct.push(`${file}: ${name}`);
      }
    }
  }

  // Import these from ../src/index.ts instead.
  expect(direct).toEqual([]);
});

test("the module map names every source module, and only those", async () => {
  const [actual, named] = await Promise.all([modules(), mapped()]);

  // A new module needs a row in docs/agents/module-map.md; a removed one, its row gone.
  expect(actual.filter((f) => !named.includes(f))).toEqual([]);
  expect(named.filter((f) => !actual.includes(f))).toEqual([]);
});
