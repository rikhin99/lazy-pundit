import {
  Document,
  isCollection,
  isMap,
  isNode,
  isScalar,
  parse,
  parseDocument,
} from "yaml";

/** The format version every workspace file this build writes carries. */
export const FORMAT = 1;

export class WorkspaceFileError extends Error {
  override name = "WorkspaceFileError";
}

/**
 * The front-matter key a workspace file carries its version under: `format`,
 * or the file's own name for it (`league.md`'s `league`, `lore.md`'s `lore`).
 */
export type VersionKey = "format" | "league" | "lore";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Sets one top-level key in a file's front matter, leaving every other byte of
 * the text as it is. A new key becomes the last line of the front matter.
 */
export function setFrontMatterKey(
  file: string,
  text: string,
  key: string,
  value: number,
): string {
  return setKeyLine(file, text, key, `${key}: ${value}`);
}

function setKeyLine(
  file: string,
  text: string,
  key: string,
  line: string,
): string {
  const yaml = frontMatterYaml(file, text);
  const start = text.indexOf("\n") + 1;
  const end = start + yaml.length;
  const span = keySpan(yaml, key);
  if (span) {
    return `${text.slice(0, start + span.from)}${line}${text.slice(start + span.to)}`;
  }
  const eol = text.startsWith("\r\n", end) ? "\r\n" : "\n";
  return `${text.slice(0, end)}${eol}${line}${text.slice(end)}`;
}

/** A value `setFrontMatterValue` can write: text, a list of text, a map of plain values, or a list of such maps. */
export type FrontMatterValue =
  | string
  | string[]
  | Record<string, unknown>
  | Record<string, unknown>[];

/**
 * Sets one top-level key's value in a file's front matter, leaving every other
 * byte of the text as it is, the old value's trailing comment included. A new
 * key becomes the last line of the front matter. A string that YAML would
 * misread is quoted, and a list or map is written on one line (`[a, b, c]`).
 */
export function setFrontMatterValue(
  file: string,
  text: string,
  key: string,
  value: FrontMatterValue,
): string {
  const rendered = renderValue(value);
  const span = valueSpan(frontMatterYaml(file, text), key);
  if (!span) return setKeyLine(file, text, key, `${key}: ${rendered}`);
  const start = text.indexOf("\n") + 1;
  return `${text.slice(0, start + span.from)}${rendered}${text.slice(start + span.to)}`;
}

function frontMatterYaml(file: string, text: string): string {
  const yaml = FRONT_MATTER.exec(text)?.[1];
  if (yaml === undefined) {
    throw new WorkspaceFileError(`${file} has no front matter`);
  }
  return yaml;
}

/**
 * Refuses front matter that `setFrontMatterKey` and `setFrontMatterValue`
 * can't edit: anything but a block map with every key at the start of its
 * line. Only the pundit's own editing writes another shape, such as indented keys or a
 * `{...}` flow map.
 */
export function refuseUneditableFrontMatter(file: string, text: string): void {
  const yaml = frontMatterYaml(file, text);
  const { contents } = parseDocument(yaml);
  const editable =
    isMap(contents) &&
    !contents.flow &&
    contents.items.every(
      (item) =>
        isNode(item.key) &&
        item.key.range !== undefined &&
        (item.key.range[0] === 0 || yaml[item.key.range[0] - 1] === "\n"),
    );
  if (!editable) {
    throw new WorkspaceFileError(
      `${file}: put each front-matter key at the start of its line, with no indent and no braces around the keys`,
    );
  }
}

/**
 * A top-level key's value as written on its own `key: value` line, comment
 * left out, read from the front matter's text without parsing it: so it reads
 * front matter that isn't valid YAML or has another version. A line in a
 * comment, an indented one or one in the body isn't the key's.
 */
export function rawFrontMatterValue(
  text: string,
  key: string,
): string | undefined {
  const yaml = FRONT_MATTER.exec(text)?.[1] ?? "";
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.startsWith(`${key}:`)) continue;
    return line
      .slice(key.length + 1)
      .replace(/(^|\s)#.*$/, "")
      .trim();
  }
  return undefined;
}

/** A top-level key's entry in `yaml`, when `yaml` is a map holding it. */
function topLevelPair(yaml: string, key: string) {
  const { contents } = parseDocument(yaml);
  if (!isMap(contents)) return undefined;
  return contents.items.find(
    (item) => isScalar(item.key) && item.key.value === key,
  );
}

function renderValue(value: FrontMatterValue): string {
  const doc = new Document(value);
  if (isCollection(doc.contents)) doc.contents.flow = true;
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
}

/** Where a top-level key's non-empty value stands in `yaml`, without any comment. */
function valueSpan(
  yaml: string,
  key: string,
): { from: number; to: number } | undefined {
  const pair = topLevelPair(yaml, key);
  if (!isNode(pair?.value) || !pair.value.range) return undefined;
  const [from, end] = pair.value.range;
  const to = yaml.slice(0, end).trimEnd().length;
  return to > from ? { from, to } : undefined;
}

/**
 * Where a top-level key's entry stands in `yaml`: from the key to the end of
 * the line its value ends on, so including any trailing comment.
 */
function keySpan(
  yaml: string,
  key: string,
): { from: number; to: number } | undefined {
  const pair = topLevelPair(yaml, key);
  if (!isNode(pair?.key)) return undefined;
  const lastNode = isNode(pair.value) ? pair.value : pair.key;
  if (!pair.key.range || !lastNode.range) return undefined;
  // A block value's range runs past its own newline, so step back onto its line.
  const valueEnd = yaml.slice(0, lastNode.range[1]).trimEnd().length;
  const lineEnd = /\r?\n|$/.exec(yaml.slice(valueEnd));
  return { from: pair.key.range[0], to: valueEnd + (lineEnd?.index ?? 0) };
}

const INDENT_HINT = "check each key's indent, and use spaces, not tabs";
const COLON_HINT = "quote a value that has a colon followed by a space";
const BRACKET_HINT = "close each bracket you open";
const QUOTE_HINT = "close each quote you open";
const DUPLICATE_HINT = "give each key only once";

/**
 * One way to mend front matter that doesn't parse: the hint the refusal
 * shows for it, the line it mends, and the lines after mending (a line
 * that's `undefined` is dropped).
 */
type Fix = {
  hint: string;
  line: number;
  apply: (lines: (string | undefined)[]) => (string | undefined)[];
};

const lineFix = (
  hint: string,
  line: number,
  mended: string | undefined,
): Fix => ({ hint, line, apply: (lines) => lines.with(line, mended) });

/**
 * The quote or brackets `line` leaves open, innermost last. A quote counts
 * as opening only where a scalar can start; inside one, a quote's own
 * escape (`\"`, or `''`) doesn't close it.
 */
function openings(line: string): string[] {
  const open: string[] = [];
  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? "";
    const quote = open.at(-1);
    if (quote === '"' || quote === "'") {
      if (quote === '"' && char === "\\") i++;
      else if (quote === "'" && char === "'" && line[i + 1] === "'") i++;
      else if (char === quote) open.pop();
    } else if (char === "#" && /\s/.test(line[i - 1] ?? " ")) {
      break;
    } else if (
      (char === '"' || char === "'") &&
      /^$|[\s[{,:]$/.test(line.slice(0, i).slice(-1))
    ) {
      open.push(char);
    } else if (char === "[" || char === "{") {
      open.push(char);
    } else if (char === "]" || char === "}") {
      open.pop();
    }
  }
  return open;
}

const CLOSER: Record<string, string> = {
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
};

/** The fixes front matter's lines could take, in the order of their lines. */
function fixes(lines: string[]): Fix[] {
  const found: Fix[] = [];
  const firstTab = lines.findIndex((line) => /^[ \t]*\t/.test(line));
  if (firstTab >= 0) {
    found.push({
      hint: INDENT_HINT,
      line: firstTab,
      apply: (mending) =>
        mending.map((line) =>
          line?.replace(/^[ \t]+/, (indent) => indent.replace(/\t/g, "  ")),
        ),
    });
  }
  const keys = new Set<string>();
  lines.forEach((line, i) => {
    if (/^[ \t]/.test(line)) {
      found.push(lineFix(INDENT_HINT, i, line.trimStart()));
    }
    const colon = line.indexOf(": ");
    const value = colon < 0 ? "" : line.slice(colon + 2).trim();
    if (value.includes(": ") && !/^["'[{|>&*!#]/.test(value)) {
      const key = line.slice(0, colon + 2);
      found.push(lineFix(COLON_HINT, i, `${key}${JSON.stringify(value)}`));
    }
    const open = openings(line);
    if (open.length > 0) {
      const closers = open
        .map((char) => CLOSER[char])
        .reverse()
        .join("");
      const quoted = open.at(-1) === '"' || open.at(-1) === "'";
      found.push(
        lineFix(
          quoted ? QUOTE_HINT : BRACKET_HINT,
          i,
          `${line.trimEnd()}${closers}`,
        ),
      );
    }
    // A top-level key's line; a `- ` list item's key isn't one.
    const key = /^(?!-(?:\s|$))([^\s#][^:]*):(?:\s|$)/.exec(line)?.[1];
    if (key !== undefined) {
      if (keys.has(key)) found.push(lineFix(DUPLICATE_HINT, i, undefined));
      keys.add(key);
    }
  });
  return found.sort((a, b) => a.line - b.line);
}

/** The most fixes the refusal tries together. */
const MOST_FIXES = 3;

/**
 * The hints for front matter that doesn't parse: those of a set of fixes,
 * on different lines, that make it parse together, each needed by the
 * rest, in the order of the lines they mend. None when no set is found.
 * The parser's codes don't separate the faults (an indented key and a
 * value with a colon share one) and it reports only the first, so each
 * hint goes by a fix and a reparse, never by the code.
 *
 * Every fix is tried alone first. Then every fix but the indent ones
 * together, which only touch a line with its own sign of a fault, with
 * one indent fix or none; a fix the others don't need is dropped. Last,
 * sets of up to three, grown only by a fix that leaves the parser's first
 * error later in the front matter, or different on the same line, so an
 * indented list item moved out of its list isn't tried with others: long
 * front matter stays quick.
 */
function fixHints(yaml: string): string[] {
  const lines = yaml.split("\n");
  const candidates = fixes(lines);
  const hintsOf = (chosen: Fix[]) => [
    ...new Set(
      chosen.toSorted((a, b) => a.line - b.line).map((fix) => fix.hint),
    ),
  ];
  /** The first error after `chosen`'s fixes, at its line in `lines`; none if it parses. */
  const firstError = (chosen: Fix[]) => {
    const mended = chosen.reduce<(string | undefined)[]>(
      (mending, fix) => fix.apply(mending),
      lines,
    );
    const kept = mended.flatMap((line, i) => (line === undefined ? [] : [i]));
    const [error] = parseDocument(
      mended.filter((line) => line !== undefined).join("\n"),
    ).errors;
    if (!error) return undefined;
    const line = kept[(error.linePos?.[0].line ?? 1) - 1] ?? lines.length;
    return { line, code: error.code };
  };
  type ParseError = NonNullable<ReturnType<typeof firstError>>;
  const search = (
    chosen: Fix[],
    error: ParseError,
    from: number,
    count: number,
  ): Fix[] | undefined => {
    for (let i = from; i < candidates.length; i++) {
      const fix = candidates[i];
      if (!fix || chosen.some((other) => other.line === fix.line)) continue;
      const tried = [...chosen, fix];
      const next = firstError(tried);
      if (tried.length === count) {
        if (!next) return tried;
        continue;
      }
      const progressed =
        next !== undefined &&
        (next.line > error.line ||
          (next.line === error.line && next.code !== error.code));
      const found = progressed ? search(tried, next, i + 1, count) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  const error = firstError([]);
  if (!error) return [];
  const alone = search([], error, 0, 1);
  if (alone) return hintsOf(alone);
  // Every fix but the indent ones, the first on each line.
  const others = candidates.filter(
    (fix, i) =>
      fix.hint !== INDENT_HINT &&
      !candidates.slice(0, i).some((other) => other.line === fix.line),
  );
  const indents = candidates.filter((fix) => fix.hint === INDENT_HINT);
  for (const indent of [undefined, ...indents]) {
    if (indent && others.some((other) => other.line === indent.line)) continue;
    let chosen = indent ? [...others, indent] : others;
    if (chosen.length === 0 || firstError(chosen)) continue;
    for (const fix of [...chosen]) {
      const without = chosen.filter((other) => other !== fix);
      if (!firstError(without)) chosen = without;
    }
    return hintsOf(chosen);
  }
  for (let count = 2; count <= MOST_FIXES; count++) {
    const found = search([], error, 0, count);
    if (found) return hintsOf(found);
  }
  return [];
}

/**
 * Splits a Markdown file into its YAML front matter and body, refusing any
 * file whose version, under `versionKey`, isn't the one this build reads.
 */
export function readFrontMatter(
  file: string,
  text: string,
  versionKey: VersionKey,
): { data: Record<string, unknown>; body: string; bodyLine: number } {
  const match = FRONT_MATTER.exec(text);
  if (!match) {
    throw new WorkspaceFileError(`${file} has no front matter`);
  }
  let data: unknown;
  try {
    data = parse(match[1] ?? "");
  } catch (cause) {
    // Fixed hints, not the parser's line: for one key indented on its own,
    // the parser points at the line before it.
    const hints = fixHints(match[1] ?? "");
    throw new WorkspaceFileError(
      [`${file}: the front matter isn't valid YAML`, ...hints].join("; "),
      { cause },
    );
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new WorkspaceFileError(`${file}: the front matter isn't a mapping`);
  }
  const record = data as Record<string, unknown>;
  const version = record[versionKey];
  if (version !== FORMAT) {
    throw new WorkspaceFileError(
      version === undefined
        ? `${file} has no ${versionKey} version; this version of Lazy Pundit reads ${versionKey} ${FORMAT}`
        : `${file} is ${versionKey} ${String(version)}, but this version of Lazy Pundit reads only ${versionKey} ${FORMAT}`,
    );
  }
  const bodyLine = match[0].split("\n").length;
  return { data: record, body: text.slice(match[0].length), bodyLine };
}

/**
 * Renders front matter, with `format` first. Keys listed in `flow` are written
 * on one line (`[a, b, c]`).
 */
export function writeFrontMatter(
  data: Record<string, unknown>,
  flow: string[] = [],
): string {
  const doc = new Document({ format: FORMAT, ...data });
  for (const key of flow) {
    const node = doc.get(key, true) as { flow?: boolean } | undefined;
    if (node) node.flow = true;
  }
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n`;
}
