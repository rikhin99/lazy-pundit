import { Document, isCollection, isMap, isNode, isScalar, parse, parseDocument, } from "yaml";
/** The format version every workspace file this build writes carries. */
export const FORMAT = 1;
export class WorkspaceFileError extends Error {
    name = "WorkspaceFileError";
}
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
/**
 * Sets one top-level key in a file's front matter, leaving every other byte of
 * the text as it is. A new key becomes the last line of the front matter.
 */
export function setFrontMatterKey(file, text, key, value) {
    return setKeyLine(file, text, key, `${key}: ${value}`);
}
function setKeyLine(file, text, key, line) {
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
/**
 * Sets one top-level key's value in a file's front matter, leaving every other
 * byte of the text as it is, the old value's trailing comment included. A new
 * key becomes the last line of the front matter. A string that YAML would
 * misread is quoted, and a list or map is written on one line (`[a, b, c]`).
 */
export function setFrontMatterValue(file, text, key, value) {
    const rendered = renderValue(value);
    const span = valueSpan(frontMatterYaml(file, text), key);
    if (!span)
        return setKeyLine(file, text, key, `${key}: ${rendered}`);
    const start = text.indexOf("\n") + 1;
    return `${text.slice(0, start + span.from)}${rendered}${text.slice(start + span.to)}`;
}
function frontMatterYaml(file, text) {
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
export function refuseUneditableFrontMatter(file, text) {
    const yaml = frontMatterYaml(file, text);
    const { contents } = parseDocument(yaml);
    const editable = isMap(contents) &&
        !contents.flow &&
        contents.items.every((item) => isNode(item.key) &&
            item.key.range !== undefined &&
            (item.key.range[0] === 0 || yaml[item.key.range[0] - 1] === "\n"));
    if (!editable) {
        throw new WorkspaceFileError(`${file}: put each front-matter key at the start of its line, with no indent and no braces around the keys`);
    }
}
/**
 * A top-level key's value as written on its own `key: value` line, comment
 * left out, read from the front matter's text without parsing it: so it reads
 * front matter that isn't valid YAML or has another version. A line in a
 * comment, an indented one or one in the body isn't the key's.
 */
export function rawFrontMatterValue(text, key) {
    const yaml = FRONT_MATTER.exec(text)?.[1] ?? "";
    for (const line of yaml.split(/\r?\n/)) {
        if (!line.startsWith(`${key}:`))
            continue;
        return line
            .slice(key.length + 1)
            .replace(/(^|\s)#.*$/, "")
            .trim();
    }
    return undefined;
}
/** A top-level key's entry in `yaml`, when `yaml` is a map holding it. */
function topLevelPair(yaml, key) {
    const { contents } = parseDocument(yaml);
    if (!isMap(contents))
        return undefined;
    return contents.items.find((item) => isScalar(item.key) && item.key.value === key);
}
function renderValue(value) {
    const doc = new Document(value);
    if (isCollection(doc.contents))
        doc.contents.flow = true;
    return doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
}
/** Where a top-level key's non-empty value stands in `yaml`, without any comment. */
function valueSpan(yaml, key) {
    const pair = topLevelPair(yaml, key);
    if (!isNode(pair?.value) || !pair.value.range)
        return undefined;
    const [from, end] = pair.value.range;
    const to = yaml.slice(0, end).trimEnd().length;
    return to > from ? { from, to } : undefined;
}
/**
 * Where a top-level key's entry stands in `yaml`: from the key to the end of
 * the line its value ends on, so including any trailing comment.
 */
function keySpan(yaml, key) {
    const pair = topLevelPair(yaml, key);
    if (!isNode(pair?.key))
        return undefined;
    const lastNode = isNode(pair.value) ? pair.value : pair.key;
    if (!pair.key.range || !lastNode.range)
        return undefined;
    // A block value's range runs past its own newline, so step back onto its line.
    const valueEnd = yaml.slice(0, lastNode.range[1]).trimEnd().length;
    const lineEnd = /\r?\n|$/.exec(yaml.slice(valueEnd));
    return { from: pair.key.range[0], to: valueEnd + (lineEnd?.index ?? 0) };
}
/**
 * Whether front matter that doesn't parse would after an indent fix: one
 * indented line moved to the start of its line, or every indent's tabs
 * turned to spaces. Only then does the refusal's indent hint hold, since a
 * value with a colon or an unclosed bracket also fails, on the same codes.
 */
function indentFixes(yaml) {
    const lines = yaml.split("\n");
    const parses = (candidate) => {
        try {
            parse(candidate);
            return true;
        }
        catch {
            return false;
        }
    };
    const untabbed = yaml.replace(/^[ \t]+/gm, (indent) => indent.replace(/\t/g, "  "));
    if (untabbed !== yaml && parses(untabbed))
        return true;
    return lines.some((line, i) => /^[ \t]/.test(line) && parses(lines.with(i, line.trimStart()).join("\n")));
}
/**
 * Splits a Markdown file into its YAML front matter and body, refusing any
 * file whose version, under `versionKey`, isn't the one this build reads.
 */
export function readFrontMatter(file, text, versionKey) {
    const match = FRONT_MATTER.exec(text);
    if (!match) {
        throw new WorkspaceFileError(`${file} has no front matter`);
    }
    let data;
    try {
        data = parse(match[1] ?? "");
    }
    catch (cause) {
        // A fixed hint, not the parser's line: for one key indented on its own,
        // the parser points at the line before it.
        const hint = indentFixes(match[1] ?? "")
            ? "; check each key's indent, and use spaces, not tabs"
            : "";
        throw new WorkspaceFileError(`${file}: the front matter isn't valid YAML${hint}`, { cause });
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new WorkspaceFileError(`${file}: the front matter isn't a mapping`);
    }
    const record = data;
    const version = record[versionKey];
    if (version !== FORMAT) {
        throw new WorkspaceFileError(version === undefined
            ? `${file} has no ${versionKey} version; this version of Lazy Pundit reads ${versionKey} ${FORMAT}`
            : `${file} is ${versionKey} ${String(version)}, but this version of Lazy Pundit reads only ${versionKey} ${FORMAT}`);
    }
    const bodyLine = match[0].split("\n").length;
    return { data: record, body: text.slice(match[0].length), bodyLine };
}
/**
 * Renders front matter, with `format` first. Keys listed in `flow` are written
 * on one line (`[a, b, c]`).
 */
export function writeFrontMatter(data, flow = []) {
    const doc = new Document({ format: FORMAT, ...data });
    for (const key of flow) {
        const node = doc.get(key, true);
        if (node)
            node.flow = true;
    }
    return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n`;
}
//# sourceMappingURL=front-matter.js.map