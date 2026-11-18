import { describe, expect, test } from "vitest";
import { replaceText } from "../scripts/replace-text.ts";

describe("one exact change across files", () => {
  test("replaces every occurrence in each file and counts them", () => {
    expect(
      replaceText(
        [
          { path: "a.ts", text: "check(dir, deps); check(dir, deps);" },
          { path: "b.ts", text: "x = check(dir, deps)" },
        ],
        "check(dir, deps)",
        "check(dir)",
      ),
    ).toEqual({
      lines: ["a.ts: 2", "b.ts: 1"],
      code: 0,
      files: [
        { path: "a.ts", text: "check(dir); check(dir);" },
        { path: "b.ts", text: "x = check(dir)" },
      ],
    });
  });

  test("a file it doesn't occur in is a miss, and no file is written", () => {
    expect(
      replaceText(
        [
          { path: "a.ts", text: "check(dir, deps)" },
          { path: "b.ts", text: "check(ws.dir, ws.deps)" },
        ],
        "check(dir, deps)",
        "check(dir)",
      ),
    ).toEqual({
      lines: ["a.ts: 1", "b.ts: 0, a miss: nothing written"],
      code: 1,
      files: [],
    });
  });

  test("the new text is taken as written, `$&` included", () => {
    expect(
      replaceText([{ path: "a.ts", text: "x" }], "x", "$&y").files,
    ).toEqual([{ path: "a.ts", text: "$&y" }]);
  });
});
