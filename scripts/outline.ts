/**
 * Prints each top-level declaration in a source file with its line range
 * (doc comment included) and the doc comment's first line, so you can read
 * only the ranges you need with `sed -n`.
 *
 *   npm run outline -- src/check.ts [more files…]
 */
import { readFile } from "node:fs/promises";

const DECLARATION =
  /^(export\s+)?(default\s+)?(declare\s+)?(async\s+)?(function\*?|const|let|interface|type|class|enum)\s/;

interface Entry {
  start: number;
  line: number;
  head: string;
  doc: string;
}

function outline(text: string): string[] {
  const lines = text.split("\n");
  const entries: Entry[] = [];
  lines.forEach((l, i) => {
    if (!DECLARATION.test(l)) return;
    let start = i;
    let doc = "";
    if (lines[i - 1]?.trim().endsWith("*/")) {
      let j = i - 1;
      while (j > 0 && !lines[j]?.trim().startsWith("/**")) j--;
      start = j;
      doc =
        lines
          .slice(j, i)
          .map((d) =>
            d
              .replace(/^\s*(\/\*\*|\*\/|\*)\s?/, "")
              .replace(/\s*\*\/\s*$/, "")
              .trim(),
          )
          .find((d) => d) ?? "";
    }
    const head = l
      .replace(/\s*=\s*`.*$/, " = `…`")
      .replace(/\s*(\{|=)\s*$/, "");
    entries.push({ start, line: i, head: head.slice(0, 110), doc });
  });
  return entries.map((e, k) => {
    let end = (entries[k + 1]?.start ?? lines.length) - 1;
    while (end > e.line && !lines[end]?.trim()) end--;
    const doc = e.doc ? `  // ${e.doc.slice(0, 90)}` : "";
    return `${e.start + 1}-${end + 1}\t${e.head}${doc}`;
  });
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: npm run outline -- <file> [more files…]");
  process.exit(1);
}
for (const file of files) {
  const text = await readFile(file, "utf8");
  console.log(`${file} (${text.split("\n").length} lines)`);
  for (const row of outline(text)) console.log(`  ${row}`);
}
