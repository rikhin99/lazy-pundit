/**
 * Makes a fresh Fear The Turtle workspace with a draft, for running the CLI
 * by hand. The draft is built from the committed snapshot, so nothing is
 * fetched. It prints the shell lines that enter the workspace, set the
 * week's replay and the clipboard off, so the CLI fetches nothing either and
 * leaves the clipboard alone, and set `DRAFT` to the draft's path:
 *
 *   eval "$(npm run -s fixture:workspace -- [<week>])"     (default 8)
 *   node <repo>/src/cli.ts check
 *
 * `publish` waits at its prompt; pipe an answer (`echo p |`) or close stdin
 * (`</dev/null`) to drive it from a script.
 */
import { join } from "node:path";
import { draft } from "../src/index.ts";
import { FIXTURES, fearTheTurtle, WEEKS } from "../test/support/workspace.ts";

const week = Number(process.argv[2] ?? 8);
const snapshot = WEEKS[String(week)];
if (!snapshot) throw new Error(`no committed snapshot for week ${week}`);
const { dir, deps } = await fearTheTurtle(week);
const { path } = await draft(dir, deps);
const quoted = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
console.log(`cd ${quoted(dir)}`);
console.log(
  `export LAZY_PUNDIT_REPLAY=${quoted(join(FIXTURES, snapshot))} LAZY_PUNDIT_CLIPBOARD=off DRAFT=${quoted(path)}`,
);
