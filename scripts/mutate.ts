/**
 * Mutation check: changes one place in a committed source file, runs one test
 * file, prints which tests went red (or "survived"), and puts the file back,
 * Ctrl-C included. `<old>` must occur exactly once in the file. Exits 0 when
 * the mutation goes red, 1 when it survives, 2 on a usage problem.
 *
 *   npm run -s mutate -- src/sleeper/fetcher.ts '<old>' '<new>' test/fetch-sleeper.test.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Report {
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: { fullName: string; status: string }[];
  }[];
}

function stop(message: string): never {
  console.error(message);
  process.exit(2);
}

const [file, oldText, newText, testFile] = process.argv.slice(2);
if (
  file === undefined ||
  oldText === undefined ||
  newText === undefined ||
  testFile === undefined
) {
  stop("usage: npm run -s mutate -- <src-file> <old> <new> <test-file>");
}

const status = spawnSync("git", ["status", "--porcelain", "--", file], {
  encoding: "utf8",
});
if (status.status !== 0) stop(`git status failed for ${file}`);
if (status.stdout.trim() !== "") {
  stop(`${file} has uncommitted changes; commit or stash them first`);
}

const original = readFileSync(file, "utf8");
const count = original.split(oldText).length - 1;
if (count !== 1) stop(`<old> occurs ${count} times in ${file}, not once`);

const out = mkdtempSync(join(tmpdir(), "lazy-pundit-mutate-"));
// The test run gets Ctrl-C too; this keeps us alive to reach the finally.
// The handler itself only runs after spawnSync returns, so the run's own
// exit says whether it was interrupted.
process.on("SIGINT", () => {});
let interrupted = false;

// Nothing in the try may exit the process, or the finally never runs.
let report: Report | undefined;
try {
  writeFileSync(
    file,
    original.replace(oldText, () => newText),
  );
  const outputFile = join(out, "report.json");
  const run = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      testFile,
      "--reporter=json",
      `--outputFile=${outputFile}`,
    ],
    { stdio: "ignore" },
  );
  interrupted = run.signal === "SIGINT" || run.status === 130;
  try {
    report = JSON.parse(readFileSync(outputFile, "utf8"));
  } catch {
    report = undefined;
  }
} finally {
  writeFileSync(file, original);
  rmSync(out, { recursive: true, force: true });
}
if (interrupted) stop(`interrupted; ${file} is back as it was`);
if (report === undefined) {
  stop("vitest wrote no report; run the test file by hand to see why");
}

const results = report.testResults.flatMap((r) => r.assertionResults);
const failed = results.filter((a) => a.status === "failed");
const unloaded = report.testResults.filter(
  (r) => r.status === "failed" && r.assertionResults.length === 0,
);
if (unloaded.length > 0) {
  console.log("red: the test file failed to load");
  for (const r of unloaded) {
    console.log(`  ${(r.message ?? "").split("\n")[0]}`);
  }
} else if (failed.length > 0) {
  console.log(`red: ${failed.length} of ${results.length} failed`);
  for (const a of failed) console.log(`  × ${a.fullName}`);
} else {
  console.log(`survived: all ${results.length} passed`);
  process.exit(1);
}
