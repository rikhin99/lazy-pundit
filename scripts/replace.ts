/**
 * One exact change across many files, such as a dropped argument at every
 * call site: every occurrence of `<old>` in each file becomes `<new>`, and
 * each file's count is printed. A file `<old>` doesn't occur in is a miss:
 * nothing is written anywhere, exit 1. Exit 2 on a usage problem. The Edit
 * tool stays the way for a change in one place; this is for the same change
 * repeated, where Edit needs a Read and a call per file.
 *
 *   npm run -s replace -- 'check(dir, deps)' 'check(dir)' test/a.test.ts test/b.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { replaceText } from "./replace-text.ts";

const [oldText, newText, ...paths] = process.argv.slice(2);
if (
  oldText === undefined ||
  oldText === "" ||
  newText === undefined ||
  paths.length === 0
) {
  console.error("usage: npm run -s replace -- <old> <new> <file>...");
  process.exit(2);
}

const { lines, code, files } = replaceText(
  paths.map((path) => ({ path, text: readFileSync(path, "utf8") })),
  oldText,
  newText,
);
for (const f of files) writeFileSync(f.path, f.text);
for (const line of lines) console.log(line);
process.exit(code);
