import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

/**
 * GLOSSARY.md _Avoid_ terms with no second meaning in our code, which the
 * test enforces. Every _Avoid_ term sits here or in REVIEWED; the second test
 * fails on one in neither, so a new glossary entry gets sorted the day it's
 * written.
 */
const ENFORCED = [
  "game",
  "owner",
  "username",
  "alias",
  "writer",
  "ranker",
  "franchise",
  "voice",
  "tone",
  "standard persona",
  "example blurb",
  "sample persona",
  "playoff odds",
  "magic number",
  "in the hunt",
  "monthly cap",
  "hard cap",
  "rate card",
  "billing",
  "side bet",
  "bench points",
  "ledger",
  "final week",
  "regenerate",
  "prompt data",
  "llm input",
  "llm log",
  "prompt log",
  "suggested ranking",
  "default ranking",
  "starting order snapshot",
  "coaching efficiency",
  "max points",
  "fact checker",
  "force publish",
  "previous ranking",
  "last week's ranking",
  "template",
];

/**
 * _Avoid_ terms that also carry a meaning we use, so the reviewer judges each
 * use: "player" (an NFL player), "ranking" (its own entry), "export" (the
 * keyword), a platform's "league id", the HTTP "header", "revision" (its own
 * entry, avoided only for an edition) and a file's FORMAT "version".
 */
const REVIEWED = [
  "league id",
  "league name",
  "user",
  "account",
  "player",
  "user id",
  "roster",
  "cache",
  "fixture",
  "pull",
  "usage",
  "cost",
  "budget",
  "limit",
  "pricing",
  "rules",
  "settings",
  "punishment",
  "balance",
  "power score",
  "standings",
  "header",
  "summary",
  "rewrite",
  "bracket",
  "division",
  "rating",
  "ranking",
  "recommendation",
  "export",
  "save",
  "rank",
  "errors",
  "issues",
  "warnings",
  "warning",
  "override",
  "test suite",
  "usage stats",
  "post",
  "theme",
  "revision",
  "version",
];

/**
 * Each GLOSSARY.md _Avoid_ term with the entry it belongs to, lowercased and
 * without its narrowing parenthesis: "Game (for the fantasy contest)" is
 * "game". A sentence after the list explains it and is left out.
 */
async function glossaryAvoidTerms(): Promise<Map<string, string>> {
  const glossary = await readFile(join(ROOT, "GLOSSARY.md"), "utf8");
  const terms = new Map<string, string>();
  let entry = "";
  for (const line of glossary.split("\n")) {
    const heading = line.match(/^\*\*(.+?)\*\*:/);
    if (heading?.[1]) entry = heading[1].toLowerCase();
    const avoid = line.match(/^_Avoid_:\s*(.*)$/);
    if (!avoid?.[1]) continue;
    const list = avoid[1].replace(/\([^)]*\)/g, "").split(/\.\s/)[0] ?? "";
    for (const raw of list.split(",")) {
      const term = raw.trim().toLowerCase().replace(/-/g, " ");
      if (term && term.split(" ").length <= 4) terms.set(term, entry);
    }
  }
  return terms;
}

/** `term` or its plural, as whole words. */
function wordPattern(term: string): RegExp {
  return new RegExp(`\\b${term}(s|es)?\\b`);
}

/** Files whose string literals are domain prose too: what the LLM is told. */
const PROSE_FILES = ["prompt.ts"];

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
  const glossary = await glossaryAvoidTerms();
  const AVOID = ENFORCED.map((t): [RegExp, string] => [
    wordPattern(t),
    glossary.get(t) ?? "?",
  ]);
  const entries = await readdir(SRC, { withFileTypes: true, recursive: true });
  const offences: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".ts")) continue;
    const path = relative(SRC, join(e.parentPath, e.name));
    if (PLATFORM_DIRS.some((dir) => path.startsWith(`${dir}/`))) continue;
    const text = await readFile(join(e.parentPath, e.name), "utf8");
    const found = namesAndComments(text);
    if (PROSE_FILES.includes(path)) {
      found.push(text.toLowerCase().replace(/-/g, " "));
    }
    for (const [avoid, term] of AVOID) {
      const hit = found.find((w) => avoid.test(w));
      if (hit) {
        offences.push(`src/${path}: "${hit.match(avoid)?.[0]}", say ${term}`);
      }
    }
  }
  expect(offences).toEqual([]);
});

test("every glossary Avoid term is enforced or left to the reviewer", async () => {
  const glossary = [...(await glossaryAvoidTerms()).keys()];
  const sorted = [...ENFORCED, ...REVIEWED];
  expect({
    unsorted: glossary.filter((t) => !sorted.includes(t)),
    notInGlossary: sorted.filter((t) => !glossary.includes(t)),
  }).toEqual({ unsorted: [], notInGlossary: [] });
});
