/**
 * Makes a fresh Fear The Turtle workspace with a draft, for running the CLI
 * by hand, and prints its folder. The draft is built from the committed
 * snapshot, so nothing is fetched.
 *
 *   npm run fixture:workspace -- [<week>]     (default 8)
 *
 * Then run the CLI there with the clipboard off, so it isn't overwritten:
 *
 *   cd <folder> && LAZY_PUNDIT_CLIPBOARD=off node <repo>/src/cli.ts check
 *
 * `publish` waits at its prompt; pipe an answer (`echo p |`) or close stdin
 * (`</dev/null`) to drive it from a script.
 */
import { draft } from "../src/index.ts";
import { fearTheTurtle } from "../test/support/workspace.ts";

const week = Number(process.argv[2] ?? 8);
const { dir, deps } = await fearTheTurtle(week);
await draft(dir, deps);
console.log(dir);
