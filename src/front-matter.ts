import { Document, parse } from "yaml";

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

/**
 * Splits a Markdown file into its YAML front matter and body, refusing any
 * file whose version, under `versionKey`, isn't the one this build reads.
 */
export function readFrontMatter(
  file: string,
  text: string,
  versionKey: VersionKey,
): { data: Record<string, unknown>; body: string; bodyLine: number } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
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
