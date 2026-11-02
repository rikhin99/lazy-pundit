import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { draft } from "../src/index.ts";
import { fearTheTurtle, rankingsDir } from "./support/workspace.ts";

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

/**
 * Runs the CLI in `cwd`, writes `input` and closes stdin, as a script or a
 * pundit at the prompt would. The clipboard is off so nothing is copied.
 */
function cli(cwd: string, args: string[], input = "") {
  return new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, LAZY_PUNDIT_CLIPBOARD: "off" },
    });
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(input);
  });
}

/** Week 8 drafted, with a wrong margin added to Gus Bus: one hard problem. */
async function withWrongClaim() {
  const { dir, deps } = await fearTheTurtle(8);
  const { path } = await draft(dir, deps);
  const GUS = "## Gus Bus {team=sleeper:1}\n";
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replace(GUS, `${GUS}They won by 50 this week.\n`));
  return { dir, txt: join(rankingsDir(dir), "week-08.txt") };
}

test("publish with a hard problem and no answer goes back to editing and fails", async () => {
  const { dir, txt } = await withWrongClaim();

  const { code, stdout } = await cli(dir, ["publish"]);

  expect(code).toBe(1);
  expect(stdout).toContain("w8.margin is 55");
  expect(stdout).toContain("Back to editing; nothing was published.");
  expect(existsSync(txt)).toBe(false);
});

test("answering p at the prompt publishes anyway", async () => {
  const { dir, txt } = await withWrongClaim();

  const { code, stdout } = await cli(dir, ["publish"], "p\n");

  expect(code).toBe(0);
  expect(stdout).toContain("Published week 8:");
  expect(stdout).toContain("No clipboard found; paste from the .txt file.");
  expect(await readFile(txt, "utf8")).toContain("They won by 50 this week.");
});

test("publish --yes doesn't ask", async () => {
  const { dir, txt } = await withWrongClaim();

  const { code, stdout } = await cli(dir, ["publish", "--yes"]);

  expect(code).toBe(0);
  expect(stdout).not.toContain("Publish anyway");
  expect(existsSync(txt)).toBe(true);
});
