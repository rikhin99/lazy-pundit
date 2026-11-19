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
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { draft, publish, renderStatsTable, statsTable } from "../src/index.ts";
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
    // The prompt's core, for the masked prompt that shows only a count.
    "@clack/core",
    "@clack/prompts",
    "@commander-js/extra-typings",
    "node:path",
    "node:readline/promises",
    // styleText, for that prompt's frame.
    "node:util",
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

test("setup with a step asks questions, so it refuses to run outside a terminal", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lazy-pundit-cli-"));
  const home = await mkdtemp(join(tmpdir(), "lazy-pundit-home-"));

  const key = await cli(cwd, ["setup", "key"], "", home);

  expect(key.code).toBe(1);
  expect(key.stderr).toMatch(/setup key asks questions.*terminal/);
  expect(await readdir(home)).toEqual([]);
});

test("setup espn in a Sleeper league's workspace is refused before its terminal check", async () => {
  const { dir } = await fearTheTurtle(8);

  const espn = await cli(dir, ["setup", "espn"]);

  expect(espn.code).toBe(1);
  expect(espn.stderr).toMatch(
    /^This workspace's league is on Sleeper, which needs no ESPN cookie/,
  );
  expect(espn.stderr).not.toMatch(/terminal/);
});

test("setup method on an indented workspace.md refuses it in one line before asking anything; setup key still gets to its terminal check", async () => {
  const { dir } = await fearTheTurtle(8);
  const path = join(dir, "workspace.md");
  const indented = withFrontMatter(await readFile(path, "utf8"), (lines) =>
    lines.map((line) => `  ${line}`),
  );
  await writeFile(path, indented);

  const method = await cli(dir, ["setup", "method"]);
  const key = await cli(dir, ["setup", "key"]);

  expect(method.code).toBe(1);
  expect(method.stdout).toBe("");
  expect(method.stderr).toBe(
    "workspace.md: put each front-matter key at the start of its line, with no indent and no braces around the keys\n",
  );
  expect(key.stderr).toMatch(/setup key asks questions.*terminal/);
  expect(await readFile(path, "utf8")).toBe(indented);
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
  const env = await cliEnv(home, over);
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

/** The CLI's environment, as `cli` describes it. */
async function cliEnv(
  home?: string,
  over: NodeJS.ProcessEnv = {},
): Promise<NodeJS.ProcessEnv> {
  const h = home ?? (await mkdtemp(join(tmpdir(), "lazy-pundit-home-")));
  return {
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
  const [first, second] = stdout.split("\n");
  expect(first).toBe(`lazy-pundit ${await versionInPackageJson()}`);
  expect(second).toMatch(/^✓ Node: v/);
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

test("publish run from the season folder with a style page it can't write prints one message, with paths as the CLI shows them, and fails", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);
  const season = rankingsDir(dir);
  await mkdir(join(season, "week-08.tabloid.html"));

  const { code, stderr } = await cli(season, ["publish", "--yes"]);

  expect(code).toBe(1);
  expect(stderr.trim().split("\n").at(-1)).toBe(
    "Published week 8 as edition 1, wrote its text to week-08.txt (no clipboard found; paste from the .txt file), but couldn't write the Tabloid page to week-08.tabloid.html: it's a folder. The Broadcast page wasn't written either. Move or remove that folder, then run `lazy-pundit publish` again in the league's workspace; that publishes week 8 as edition 2.",
  );
  expect(stderr).not.toMatch(/^\s+at /m);
});

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
  expect(stdout).toContain("week-08.tabloid.html");
  expect(stdout).toContain("week-08.broadcast.html");
  expect(stdout).toContain(
    "Open a style page in a browser to screenshot it for the league chat.",
  );
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

test("check on a draft with a value with a colon names the quote fix on stderr and exits 1, leaving the draft as it was", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  const { path } = await draft(dir, deps);
  const broken = withFrontMatter(await readFile(path, "utf8"), (lines) => [
    ...lines,
    "notes: half: time",
  ]);
  await writeFile(path, broken);

  const { code, stdout, stderr } = await cli(dir, ["check"]);

  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toBe(
    "week-08.md: the front matter isn't valid YAML; quote a value that has a colon followed by a space\n",
  );
  expect(await readFile(path, "utf8")).toBe(broken);
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
  expect(stderr).toMatch(/^! couldn't check for data changes or corrections: /);
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

test("draft points to the Stats table on the line after Drafted week", async () => {
  const { dir } = await fearTheTurtle(8);

  const { code, stdout } = await cli(dir, ["draft"]);

  expect(code).toBe(0);
  const lines = stdout.split("\n");
  const drafted = lines.findIndex((l) => l.startsWith("Drafted week 8:"));
  expect(lines[drafted + 1]).toBe(
    "See the stats behind the starting order: lazy-pundit table",
  );
});

/** The table's last lines: a blank line, the stats key, and the final newline. */
const KEY_TAIL = [
  "",
  "All-play: your record if you'd played every team every week, not just your opponent. It shows how good your scores are, without the luck of who you drew.",
  "Form: your average points over your last three weeks played.",
  "Luck: your wins minus the wins your all-play record would expect. Above 0, you've won more than your scores earned.",
  "",
];

test("table prints the Stats table with no fetch, plain when it isn't a terminal", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);

  const { code, stdout, stderr } = await cli(dir, ["table"], "", undefined, {
    LAZY_PUNDIT_REPLAY: join(tmpdir(), "lazy-pundit-no-replay"),
  });

  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).not.toContain("\x1b");
  expect(stdout).toBe(renderStatsTable(await statsTable(dir), { bold: false }));
  expect(stdout.split("\n").slice(0, 3)).toEqual([
    "Week 8 draft · data through week 8 · method: ramped blend",
    "",
    expect.stringMatching(
      /^ # {2}Start {2}Team +Record {2}Rank {5}PPG {2}All-play {4}Form {3}Luck {2}Streak$/,
    ),
  ]);
  const lines = stdout.split("\n");
  expect(lines.slice(-5)).toEqual(KEY_TAIL);
  expect(lines[lines.length - 6]).toMatch(/^12 /);
});

test("table --sort orders the rows, and an unknown column fails on one line", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);

  const sorted = await cli(dir, ["table", "--sort", "rank"]);
  const byLuck = await cli(dir, ["table", "--sort", "luck"]);
  const nope = await cli(dir, ["table", "--sort", "nope"]);

  expect(sorted.code).toBe(0);
  expect(sorted.stdout).toBe(
    renderStatsTable(await statsTable(dir, { sort: "rank" }), { bold: false }),
  );
  expect(byLuck.code).toBe(0);
  expect(byLuck.stdout.split("\n").slice(-5)).toEqual(KEY_TAIL);
  expect(nope.code).toBe(1);
  expect(nope.stdout).toBe("");
  expect(nope.stderr).toBe(
    'There\'s no "nope" column to sort by; use start, record, rank, ppg, all-play, form or luck.\n',
  );
});

test("table with no draft prints check's message on one line and fails", async () => {
  const { dir } = await fearTheTurtle(8);

  const { code, stdout, stderr } = await cli(dir, ["table"]);

  expect(code).toBe(1);
  expect(stdout).toBe("");
  // The CLI names the folder by its real path, which on macOS starts /private.
  expect(stderr).toMatch(
    /^No draft in \/.*\/pundits\/rikhin\/2025; run `lazy-pundit draft` first\n$/,
  );
});

test("--help lists table", async () => {
  const { stdout } = await cli(tmpdir(), ["--help"]);

  expect(stdout).toMatch(/^ {2}table .*Stats table/m);
});

/** The version in package.json, read from its text as a tester would. */
async function versionInPackageJson() {
  const text = await readFile(join(CLI, "..", "..", "package.json"), "utf8");
  return (JSON.parse(text) as { version: string }).version;
}

test("--version and -V print package.json's version, and --help lists them", async () => {
  const version = await versionInPackageJson();

  for (const flag of ["--version", "-V"]) {
    const { code, stdout } = await cli(tmpdir(), [flag]);
    expect(code).toBe(0);
    expect(stdout).toBe(`${version}\n`);
  }
  const { stdout } = await cli(tmpdir(), ["--help"]);
  expect(stdout).toMatch(/^ {2}-V, --version /m);
});

const OPEN_LINE =
  /^Open http:\/\/127\.0\.0\.1:(\d+) in VS Code's Simple Browser or any browser$/;

/**
 * Runs `preview` in `cwd` until its first line, checks the page answers at
 * the URL it prints, then interrupts it as Ctrl-C would and gives its port
 * and how it ended.
 */
async function previewRun(cwd: string, args: string[], home?: string) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd,
    env: await cliEnv(home),
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  const closed = new Promise<number | null>((resolve) =>
    child.on("close", (code) => resolve(code)),
  );
  const firstLine = await new Promise<string>((resolve, reject) => {
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.includes("\n")) resolve(stdout);
    });
    child.on("close", () => reject(new Error(`exited: ${stdout}${stderr}`)));
  });
  const [line] = firstLine.split("\n");
  const port = Number(OPEN_LINE.exec(line as string)?.[1]);
  const answer = Number.isNaN(port)
    ? 0
    : (await fetch(`http://127.0.0.1:${port}`)).status;
  child.kill("SIGINT");
  const code = await closed;
  return { line, port, answer, code, stdout, stderr };
}

/** Whether nothing holds `port` on 127.0.0.1. */
function portFree(port: number): Promise<boolean> {
  const server = createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

test("preview prints where its page is, serves it until Ctrl-C, then frees the port", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);

  const run = await previewRun(dir, ["preview"]);

  expect(run.line).toMatch(OPEN_LINE);
  expect(run.port).toBeGreaterThanOrEqual(4790);
  expect(run.answer).toBe(200);
  expect(run.stdout).toBe(`${run.line}\n`);
  expect(run.code).toBe(0);
  expect(await portFree(run.port)).toBe(true);
});

test("preview with --league serves that workspace's page from any folder", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);
  const home = await homeListing({ "fear-the-turtle": dir });

  const run = await previewRun(
    home,
    ["--league", "fear-the-turtle", "preview"],
    home,
  );

  expect(run.line).toMatch(OPEN_LINE);
  expect(run.answer).toBe(200);
  expect(run.code).toBe(0);
  expect(await portFree(run.port)).toBe(true);
});

test("preview outside a workspace without --league stops with check's message", async () => {
  const outside = await mkdtemp(join(tmpdir(), "lazy-pundit-outside-"));

  const { code, stdout, stderr } = await cli(outside, ["preview"]);

  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toMatch(
    /^No workspace\.md in .*lazy-pundit-outside-\w+ or any folder above it\. Run the command inside a league workspace, or pass --league <slug>\.\n$/,
  );
});
