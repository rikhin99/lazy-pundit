/** A file as `npm run replace` reads it and writes it back. */
export interface TextFile {
  path: string;
  text: string;
}

/**
 * One exact change across files: every occurrence of `oldText` in each file
 * becomes `newText`, taken as written. The lines to print count each file's
 * occurrences. A file with none is a miss: code 1, and no file to write, so a
 * miss changes nothing anywhere.
 */
export function replaceText(
  files: TextFile[],
  oldText: string,
  newText: string,
): { lines: string[]; code: number; files: TextFile[] } {
  const counts = files.map((f) => f.text.split(oldText).length - 1);
  const missed = counts.some((n) => n === 0);
  return {
    lines: files.map((f, i) =>
      counts[i] === 0
        ? `${f.path}: 0, a miss: nothing written`
        : `${f.path}: ${counts[i]}`,
    ),
    code: missed ? 1 : 0,
    files: missed
      ? []
      : files.map((f) => ({
          path: f.path,
          text: f.text.split(oldText).join(newText),
        })),
  };
}
