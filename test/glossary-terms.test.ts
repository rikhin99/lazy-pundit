import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

/**
 * GLOSSARY.md _Avoid_ terms with no second meaning in our code. Ambiguous
 * ones stay with the reviewer: "player" (an NFL player), "roster" (a team's
 * players), "rank", "user", "division", "fixture".
 */
const AVOID: [RegExp, string][] = [
  [/\bgames?\b/, "matchup"],
  [/\bowners?\b/, "manager"],
  [/\busernames?\b/, "manager handle"],
  [/\b(alias|aliases)\b/, "nickname"],
  [/\b(writers?|rankers?)\b/, "pundit"],
  [/\bfranchises?\b/, "team"],
  [/\bfact checkers?\b/, "validator"],
  [/\bbench points\b/, "points left on the bench"],
  [/\b(coaching efficiency|max points)\b/, "lineup efficiency"],
  [/\b(playoff odds|magic number)\b/, "playoff status"],
  [/\bside bets?\b/, "house rule"],
  [/\bledger\b/, "winnings to date"],
  [/\bfinal week\b/, "scored week"],
];

/** Platform adapters may name a platform's own fields, such as `owner_id`. */
const PLATFORM_DIRS = ["sleeper"];

/** Splits `closeGameCount` or `CLOSE_GAME` into "close game count". */
function words(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$]+/g, " ")
    .toLowerCase();
}

/**
 * A file's identifiers and comments, as lowercase words. String and regex
 * literals are left out: they hold platform text and the pundit prose the
 * validator recognizes, such as "3-game heater".
 */
function namesAndComments(text: string): string[] {
  const comments: string[] = [];
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => {
      comments.push(c);
      return " ";
    })
    .replace(/(^|[^:"'`\w])(\/\/.*)$/gm, (_, before, c) => {
      comments.push(c);
      return before;
    })
    .replace(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, " ")
    .replace(
      /([=(,:!&|?{};[]\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\[])+\/[a-z]*/g,
      "$1 ",
    );
  const identifiers = code.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return [
    ...identifiers.map(words),
    ...comments.map((c) => c.toLowerCase().replace(/-/g, " ")),
  ];
}

test("code and comments use glossary terms, not their Avoid terms", async () => {
  const entries = await readdir(SRC, { withFileTypes: true, recursive: true });
  const offences: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".ts")) continue;
    const path = relative(SRC, join(e.parentPath, e.name));
    if (PLATFORM_DIRS.some((dir) => path.startsWith(`${dir}/`))) continue;
    const found = namesAndComments(
      await readFile(join(e.parentPath, e.name), "utf8"),
    );
    for (const [avoid, term] of AVOID) {
      const hit = found.find((w) => avoid.test(w));
      if (hit) {
        offences.push(`src/${path}: "${hit.match(avoid)?.[0]}", say ${term}`);
      }
    }
  }
  expect(offences).toEqual([]);
});
