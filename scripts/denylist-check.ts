/**
 * Refuses text holding a real name from the never-committed
 * `fixtures/denylist.txt` (the `DENYLIST` variable overrides the path), so a
 * name never reaches a commit, an issue or a comment on the public repo,
 * where an edited-out name stays readable in the edit history.
 *
 *   node scripts/denylist-check.ts [file...]   # reads stdin when no file is named
 *
 * Exits 1 naming each term found, and 0 when none is, or when there's no
 * denylist (CI, a fresh clone). A term matches as a whole word, case
 * sensitive, with a hyphen joining words, so "Quix-week" doesn't match "Quix".
 * The maintainer's own handle is on every issue anyway, so it never counts.
 *
 * Callers: `.husky/pre-commit` (the staged diff's added lines),
 * `.husky/commit-msg` and `.claude/hooks/denylist-gh.sh` (issue, PR and
 * comment text sent with `gh`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER = "rikhin99";
const path =
  process.env.DENYLIST ??
  join(import.meta.dirname, "..", "fixtures", "denylist.txt");

if (!existsSync(path)) process.exit(0);

const terms = readFileSync(path, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && line !== OWNER);
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = terms.map((term) => ({
  term,
  re: new RegExp(`(?<![\\w-])${literal(term)}(?![\\w-])`),
}));

const files = process.argv.slice(2);
const sources =
  files.length > 0
    ? files.map((name) => ({ name, text: readFileSync(name, "utf8") }))
    : [{ name: "the text", text: readFileSync(0, "utf8") }];

let found = false;
for (const { name, text } of sources) {
  for (const { term, re } of patterns) {
    if (re.test(text)) {
      console.error(`${name} holds "${term}", from fixtures/denylist.txt.`);
      found = true;
    }
  }
}
if (found) {
  console.error(
    'Write a placeholder instead (Tester A, Team A, <league ID>): docs/agents/issue-tracker.md, "Personal data stays off GitHub".',
  );
}
process.exit(found ? 1 : 0);
