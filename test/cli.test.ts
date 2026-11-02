import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { draft } from "../src/index.ts";
import { fearTheTurtle, rankingsDir } from "./support/workspace.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

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

  const { code, stderr } = await cli(cwd, ["publish"]);

  expect(code).toBe(1);
  expect(stderr).toMatch(/No workspace\.md in .* or any folder above it/);
});

/** The only variables the CLI under test sees from the developer's shell. */
const INHERITED = ["PATH", "TMPDIR", "NODE_OPTIONS"];

/**
 * Runs the CLI in `cwd`, writes `input` and closes stdin, as a script or a
 * pundit at the prompt would. The clipboard is off so nothing is copied, and
 * HOME and the XDG folders are `home` (a fresh temp folder by default), so
 * the real home directory is never read. The environment starts from
 * `INHERITED` alone, so no key or setting in the developer's shell leaks in.
 */
async function cli(cwd: string, args: string[], input = "", home?: string) {
  const h = home ?? (await mkdtemp(join(tmpdir(), "lazy-pundit-home-")));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      INHERITED.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
    ),
    LAZY_PUNDIT_CLIPBOARD: "off",
    HOME: h,
    XDG_CONFIG_HOME: join(h, ".config"),
    XDG_CACHE_HOME: join(h, ".cache"),
  };
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], { cwd, env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d;
      });
      child.stderr.on("data", (d) => {
        stderr += d;
      });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    },
  );
}

/** A temp home whose config.yaml lists `workspaces` by slug. */
async function homeListing(workspaces: Record<string, string>) {
  const home = await mkdtemp(join(tmpdir(), "lazy-pundit-home-"));
  await mkdir(join(home, ".config", "lazy-pundit"), { recursive: true });
  const lines = Object.entries(workspaces).map(([s, d]) => `  ${s}: ${d}\n`);
  await writeFile(
    join(home, ".config", "lazy-pundit", "config.yaml"),
    `format: 1\nworkspaces:\n${lines.join("")}`,
  );
  return home;
}

test("check finds the workspace from a folder inside it", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);
  const inside = rankingsDir(dir);

  const { code, stdout } = await cli(inside, ["check"]);

  expect(code).toBe(0);
  expect(stdout).toContain("No problems.");
});

test("--league finds the workspace config.yaml lists, from any folder", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);
  const home = await homeListing({ "fear-the-turtle": dir });

  const { code, stdout } = await cli(
    home,
    ["--league", "fear-the-turtle", "check"],
    "",
    home,
  );

  expect(code).toBe(0);
  expect(stdout).toContain("No problems.");
});

test("doctor prints each check, a fix under each problem, and fails on a broken workspace", async () => {
  const { dir } = await fearTheTurtle(8);
  await writeFile(join(dir, "workspace.md"), "no front matter\n");
  const gone = join(tmpdir(), "lazy-pundit-gone");
  const home = await homeListing({
    "fear-the-turtle": dir,
    "hot-takery": gone,
  });

  const { code, stdout } = await cli(home, ["doctor"], "", home);

  expect(code).toBe(1);
  expect(stdout).toContain("✓ Node: v");
  expect(stdout).toContain(
    `· workspace hot-takery: ${gone} is gone, so it was dropped from config.yaml.`,
  );
  expect(stdout).toMatch(
    /✗ workspace fear-the-turtle: workspace\.md has no front matter\n {4}Fix: Fix workspace\.md in /,
  );
  expect(existsSync(gone)).toBe(false);
});

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
