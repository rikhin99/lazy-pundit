import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const run = promisify(execFile);

test("the CLI imports only the library, the arg parser and the prompt", async () => {
  const text = await readFile(CLI, "utf8");
  const imports = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  expect(imports.sort()).toEqual([
    "./index.ts",
    "@commander-js/extra-typings",
    "node:path",
    "node:readline/promises",
  ]);
});

test("outside a workspace, publish prints the library's message and fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lazy-pundit-cli-"));
  const error = await run(process.execPath, [CLI, "publish"], { cwd }).catch(
    (e: { code: number; stderr: string }) => e,
  );
  expect(error).toMatchObject({ code: 1 });
  expect((error as { stderr: string }).stderr).toMatch(/No workspace\.md in/);
});
