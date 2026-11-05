/**
 * Prints each top-level declaration in a source file with its line range
 * (doc comment included) and the doc comment's first line, so you can read
 * only the ranges you need with `sed -n`. A file with exports lists only its
 * exported declarations unless `--all` is passed; a file with none, such as a
 * test file, lists every declaration.
 *
 *   npm run outline -- [--all] src/check.ts [more files…]
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

function outline(text: string, all: boolean): string[] {
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
  const rows = entries.map((e, k) => {
    let end = (entries[k + 1]?.start ?? lines.length) - 1;
    while (end > e.line && !lines[end]?.trim()) end--;
    const doc = e.doc ? `  // ${e.doc.slice(0, 90)}` : "";
    return {
      exported: e.head.startsWith("export"),
      row: `${e.start + 1}-${end + 1}\t${e.head}${doc}`,
    };
  });
  const shown =
    all || !rows.some((r) => r.exported)
      ? rows
      : rows.filter((r) => r.exported);
  const hidden = rows.length - shown.length;
  return [
    ...shown.map((r) => r.row),
    ...(hidden > 0 ? [`(${hidden} internal declarations: pass --all)`] : []),
  ];
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const files = args.filter((a) => a !== "--all");
if (files.length === 0) {
  console.error("usage: npm run outline -- [--all] <file> [more files…]");
  process.exit(1);
}
for (const file of files) {
  const text = await readFile(file, "utf8");
  console.log(`${file} (${text.split("\n").length} lines)`);
  for (const row of outline(text, all)) console.log(`  ${row}`);
}
