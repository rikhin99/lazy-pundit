import { Document, isMap, isNode, isScalar, parse, parseDocument } from "yaml";

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
  const yaml = FRONT_MATTER.exec(text)?.[1];
  if (yaml === undefined) {
    throw new WorkspaceFileError(`${file} has no front matter`);
  }
  const start = text.indexOf("\n") + 1;
  const end = start + yaml.length;
  const line = `${key}: ${value}`;
  const span = keySpan(yaml, key);
  if (span) {
    return `${text.slice(0, start + span.from)}${line}${text.slice(start + span.to)}`;
  }
  const eol = text.startsWith("\r\n", end) ? "\r\n" : "\n";
  return `${text.slice(0, end)}${eol}${line}${text.slice(end)}`;
}

/**
 * Where a top-level key's entry stands in `yaml`: from the key to the end of
 * the line its value ends on, so including any trailing comment.
 */
function keySpan(
  yaml: string,
  key: string,
): { from: number; to: number } | undefined {
  const { contents } = parseDocument(yaml);
  if (!isMap(contents)) return undefined;
  const pair = contents.items.find(
    (item) => isScalar(item.key) && item.key.value === key,
  );
  if (!isNode(pair?.key)) return undefined;
  const lastNode = isNode(pair.value) ? pair.value : pair.key;
  if (!pair.key.range || !lastNode.range) return undefined;
  // A block value's range runs past its own newline, so step back onto its line.
  const valueEnd = yaml.slice(0, lastNode.range[1]).trimEnd().length;
  const lineEnd = /\r?\n|$/.exec(yaml.slice(valueEnd));
  return { from: pair.key.range[0], to: valueEnd + (lineEnd?.index ?? 0) };
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
    throw new WorkspaceFileError(`${file}: the front matter isn't valid YAML`, {
      cause,
    });
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
