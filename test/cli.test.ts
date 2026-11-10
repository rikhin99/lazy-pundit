import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { draft, publish } from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import {
  FEAR_THE_TURTLE_ID,
  FIXTURES,
  fearTheTurtle,
  frontMatter,
  patchingTransport,
  rankingsDir,
  statCorrection,
  WEEKS,
  withFrontMatter,
  writeSettings,
} from "./support/workspace.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

/** A clean week-8 draft's problems list: the correction-timing reminder alone. */
const REMINDER_ONLY =
  "Problems: 0 hard, 1 soft\n  · League: correction timing: Scored. Corrections may land through Thursday\n";

test("the CLI imports only the library, the arg parser and the prompt", async () => {
  const text = await readFile(CLI, "utf8");
  const imports = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  expect(imports.sort()).toEqual([
    "./index.ts",
    "@clack/prompts",
    "@commander-js/extra-typings",
    "node:path",
    "node:readline/promises",
  ]);
});

test("init with no terminal says so, fails and writes nothing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lazy-pundit-cli-"));
  const home = await mkdtemp(join(tmpdir(), "lazy-pundit-home-"));

  const { code, stderr } = await cli(cwd, ["init"], "", home);

  expect(code).toBe(1);
  expect(stderr).toMatch(/run it in a terminal/);
  expect(await readdir(home)).toEqual([]);
});

test("setup with a step asks questions, so it refuses to run outside a terminal, and setup espn comes later", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lazy-pundit-cli-"));
  const home = await mkdtemp(join(tmpdir(), "lazy-pundit-home-"));

  const key = await cli(cwd, ["setup", "key"], "", home);
  const espn = await cli(cwd, ["setup", "espn"], "", home);

  expect(key.code).toBe(1);
  expect(key.stderr).toMatch(/setup key asks questions.*terminal/);
  expect(espn.code).toBe(1);
  expect(espn.stderr).toMatch(/later release/);
  expect(await readdir(home)).toEqual([]);
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
async function cli(
  cwd: string,
  args: string[],
  input = "",
  home?: string,
  over: NodeJS.ProcessEnv = {},
) {
  const h = home ?? (await mkdtemp(join(tmpdir(), "lazy-pundit-home-")));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      INHERITED.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
    ),
    LAZY_PUNDIT_CLIPBOARD: "off",
    LAZY_PUNDIT_REPLAY: join(FIXTURES, WEEKS["8"] as string),
    HOME: h,
    XDG_CONFIG_HOME: join(h, ".config"),
    XDG_CACHE_HOME: join(h, ".cache"),
    ...over,
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
  expect(stdout).toContain(REMINDER_ONLY);
});

test("stats prints the demand-test summary to paste, with no replay to fetch from", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);
  await publish(dir, deps);

  const { code, stdout } = await cli(dir, ["stats"], "", undefined, {
    LAZY_PUNDIT_REPLAY: join(tmpdir(), "lazy-pundit-no-replay"),
  });

  expect(code).toBe(0);
  expect(stdout).toBe(
    [
      "Lazy Pundit demand-test summary: 1 published ranking week",
      "2025 week 8: 0 min to publish · no teams moved · LLM unused · 0 hard and 0 soft blurb problems",
      "Median: 0 min to publish · no teams moved · LLM used in 0 of 1 week · 0 hard and 0 soft blurb problems",
      "",
    ].join("\n"),
  );
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
  expect(stdout).toContain(REMINDER_ONLY);
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

test("check on a draft whose snapshot is missing prints the fix on one line and fails", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  const { path } = await draft(dir, deps);
  const id = frontMatter(await readFile(path, "utf8")).snapshot;
  await rm(join(dir, ".snapshots"), { recursive: true });

  const { code, stdout, stderr } = await cli(dir, ["check"]);

  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toBe(
    `week-08.md stands on snapshot ${id}, which is missing from the workspace's snapshots folder, so the draft can't be checked. Move week-08.md out of its season folder and run \`lazy-pundit draft\` to start the week again\n`,
  );
});

test("check on a draft whose snapshot is damaged prints the fix on one line and fails", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  const { path } = await draft(dir, deps);
  const id = frontMatter(await readFile(path, "utf8")).snapshot;
  await writeFile(join(dir, ".snapshots", String(id), "manifest.json"), "{");

  const { code, stdout, stderr } = await cli(dir, ["check"]);

  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toBe(
    `week-08.md stands on snapshot ${id}, which is damaged in the workspace's snapshots folder, so the draft can't be checked. Move week-08.md out of its season folder and run \`lazy-pundit draft\` to start the week again\n`,
  );
});

test("check on a draft with indented front matter prints the fix on one line and fails", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  const { path } = await draft(dir, deps);
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    withFrontMatter(text, (lines) => lines.map((line) => `  ${line}`)),
  );

  const { code, stdout, stderr } = await cli(dir, ["check"]);

  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toBe(
    "week-08.md: put each front-matter key at the start of its line, with no indent and no braces around the keys\n",
  );
});

test("check on a draft with one front-matter key indented prints what to check on one line and fails", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  const { path } = await draft(dir, deps);
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    withFrontMatter(text, (lines) =>
      lines.map((line) => (line.startsWith("week:") ? `  ${line}` : line)),
    ),
  );

  const { code, stdout, stderr } = await cli(dir, ["check"]);

  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toBe(
    "week-08.md: the front matter isn't valid YAML; check each key's indent, and use spaces, not tabs\n",
  );
});

test("refresh with no change says so, and updates checked_at", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  const { path } = await draft(dir, deps);
  const was = frontMatter(await readFile(path, "utf8"));

  const { code, stdout } = await cli(dir, ["refresh"]);

  expect(code).toBe(0);
  expect(stdout).toBe(`No changes since ${was.data_as_of}.\n${REMINDER_ONLY}`);
  const now = frontMatter(await readFile(path, "utf8"));
  expect(now.checked_at).not.toBe(was.checked_at);
  expect({ ...now, checked_at: was.checked_at }).toEqual(was);
});

test("refresh --full takes a full fetch, and with no change says so", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  const { path } = await draft(dir, deps);
  const was = frontMatter(await readFile(path, "utf8"));

  const { code, stdout } = await cli(dir, ["refresh", "--full"]);

  expect(code).toBe(0);
  expect(stdout).toBe(`No changes since ${was.data_as_of}.\n${REMINDER_ONLY}`);
});

test("refresh after a settings change says the starting order follows them, not that nothing changed", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);
  await writeSettings(dir, "method: ffmwr");

  const { code, stdout } = await cli(dir, ["refresh"]);

  expect(code).toBe(0);
  expect(stdout).toContain(
    "The draft recorded another power-score method or weights: its starting order now follows your settings.",
  );
  expect(stdout).not.toContain("No changes since");
});

test("refresh over changed data prints the newly stale claims and the problems list", async () => {
  // Drafted before a correction: Gus Bus's week 8 is 1.8 short of the replay's.
  const { dir, deps } = await fearTheTurtle(8);
  deps.transport = patchingTransport(deps.transport, {
    [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}/matchups/8`]: statCorrection(
      1,
      -1.8,
    ),
  });
  const { path } = await draft(dir, deps);
  const was = frontMatter(await readFile(path, "utf8"));

  const { code, stdout } = await cli(dir, ["refresh"]);

  expect(code).toBe(0);
  expect(stdout).toContain(
    `Data changed since ${was.data_as_of}: week 8 now stands on snapshot `,
  );
  expect(stdout).toContain("Newly stale:\n");
  expect(stdout).toMatch(
    /"53\.2" stale, after a refresh: true when written \(w8\.margin is 53\.2\); now w8\.margin is 55/,
  );
  expect(stdout).toMatch(/Problems: \d+ hard, \d+ soft/);
});

test("publish with a failed fetch says the check didn't happen and still publishes", async () => {
  const { dir, txt } = await withWrongClaim();

  const { code, stderr } = await cli(dir, ["publish", "--yes"], "", undefined, {
    LAZY_PUNDIT_REPLAY: join(FIXTURES, "no-such-snapshot"),
  });

  expect(code).toBe(0);
  expect(stderr).toMatch(/^! couldn't check for data changes: /);
  expect(existsSync(txt)).toBe(true);
});

test("publish --yes doesn't ask", async () => {
  const { dir, txt } = await withWrongClaim();

  const { code, stdout } = await cli(dir, ["publish", "--yes"]);

  expect(code).toBe(0);
  expect(stdout).not.toContain("Publish anyway");
  expect(existsSync(txt)).toBe(true);
});

test("draft takes --include-in-progress, and with no week in progress drafts as usual", async () => {
  const { dir } = await fearTheTurtle(8);

  const { code, stdout } = await cli(dir, ["draft", "--include-in-progress"]);

  expect(code).toBe(0);
  expect(stdout).toContain("Drafted week 8:");
});

test("draft and check each print the personal-data warning once", async () => {
  const { dir } = await fearTheTurtle(8);
  await writeFile(
    join(dir, "lore.md"),
    "---\nlore: 1\n---\n## Running jokes\n- Bo: 555-123-4567\n",
  );
  const warning = "line 5 (phone number)";

  const drafted = await cli(dir, ["draft"]);
  expect(drafted.code).toBe(0);
  expect(drafted.stderr.split(warning)).toHaveLength(2);

  const checked = await cli(dir, ["check"]);
  expect(checked.stderr.split(warning)).toHaveLength(2);
});
