/** The format version every workspace file this build writes carries. */
export declare const FORMAT = 1;
export declare class WorkspaceFileError extends Error {
    name: string;
}
/**
 * The front-matter key a workspace file carries its version under: `format`,
 * or the file's own name for it (`league.md`'s `league`, `lore.md`'s `lore`).
 */
export type VersionKey = "format" | "league" | "lore";
/**
 * Sets one top-level key in a file's front matter, leaving every other byte of
 * the text as it is. A new key becomes the last line of the front matter.
 */
export declare function setFrontMatterKey(file: string, text: string, key: string, value: number): string;
/** A value `setFrontMatterValue` can write: text, a list of text, a map of plain values, or a list of such maps. */
export type FrontMatterValue = string | string[] | Record<string, unknown> | Record<string, unknown>[];
/**
 * Sets one top-level key's value in a file's front matter, leaving every other
 * byte of the text as it is, the old value's trailing comment included. A new
 * key becomes the last line of the front matter. A string that YAML would
 * misread is quoted, and a list or map is written on one line (`[a, b, c]`).
 */
export declare function setFrontMatterValue(file: string, text: string, key: string, value: FrontMatterValue): string;
/**
 * Refuses front matter that `setFrontMatterKey` and `setFrontMatterValue`
 * can't edit: anything but a block map with every key at the start of its
 * line. Only the pundit's own editing writes another shape, such as indented keys or a
 * `{...}` flow map.
 */
export declare function refuseUneditableFrontMatter(file: string, text: string): void;
/**
 * A top-level key's value as written on its own `key: value` line, comment
 * left out, read from the front matter's text without parsing it: so it reads
 * front matter that isn't valid YAML or has another version. A line in a
 * comment, an indented one or one in the body isn't the key's.
 */
export declare function rawFrontMatterValue(text: string, key: string): string | undefined;
/**
 * Splits a Markdown file into its YAML front matter and body, refusing any
 * file whose version, under `versionKey`, isn't the one this build reads.
 */
export declare function readFrontMatter(file: string, text: string, versionKey: VersionKey): {
    data: Record<string, unknown>;
    body: string;
    bodyLine: number;
};
/**
 * Renders front matter, with `format` first. Keys listed in `flow` are written
 * on one line (`[a, b, c]`).
 */
export declare function writeFrontMatter(data: Record<string, unknown>, flow?: string[]): string;
