import { describe, expect, test } from "vitest";
import { type Report, verdict } from "../scripts/mutate-verdict.ts";

const file = (
  status: string,
  assertions: [string, string][],
  message?: string,
): Report["testResults"][number] => ({
  name: "test/a.test.ts",
  status,
  ...(message === undefined ? {} : { message }),
  assertionResults: assertions.map(([fullName, s]) => ({
    fullName,
    status: s,
    failureMessages:
      s === "failed" ? ["AssertionError: expected 1\n  at x"] : [],
  })),
});

describe("a mutation run's verdict", () => {
  test("a red test catches the mutation", () => {
    expect(
      verdict({
        testResults: [
          file("failed", [
            ["keeps weeks", "failed"],
            ["asks once", "passed"],
          ]),
        ],
      }),
    ).toEqual({
      lines: [
        "red: 1 of 2 failed",
        "  × keeps weeks",
        "    AssertionError: expected 1",
      ],
      code: 0,
    });
  });

  test("every test passing means it survived", () => {
    expect(
      verdict({ testResults: [file("passed", [["keeps weeks", "passed"]])] }),
    ).toEqual({ lines: ["survived: all 1 passed"], code: 1 });
  });

  // In #63(a) a mutation with `\&\&` in it didn't parse, and read as red.
  test("a test file that didn't load tested nothing", () => {
    expect(
      verdict({
        testResults: [
          file("failed", [], 'Transform failed with 2 errors:\nerror: "\\"'),
        ],
      }),
    ).toEqual({
      lines: [
        "not tested: the test file failed to load; check the mutation parses",
        "  Transform failed with 2 errors:",
      ],
      code: 3,
    });
  });

  // In #130 a broad mutation listed 42 red tests, 5.4k, where one mattered.
  test("past five red tests, the rest are a count", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const { lines, code } = verdict({
      testResults: [
        file(
          "failed",
          names.map((n) => [n, "failed"]),
        ),
      ],
    });
    expect(code).toBe(0);
    expect(lines[0]).toBe("red: 7 of 7 failed");
    expect(lines.filter((l) => l.startsWith("  × "))).toEqual(
      ["a", "b", "c", "d", "e"].map((n) => `  × ${n}`),
    );
    expect(lines.at(-1)).toBe("  and 2 more red");
  });

  test("tests a name filter skipped aren't counted", () => {
    expect(
      verdict({
        testResults: [
          file("passed", [
            ["keeps weeks", "passed"],
            ["asks once", "skipped"],
          ]),
        ],
      }),
    ).toEqual({ lines: ["survived: all 1 passed"], code: 1 });
  });

  test("a name filter that matched no test tested nothing", () => {
    expect(
      verdict({ testResults: [file("passed", [["asks once", "skipped"]])] }),
    ).toEqual({
      lines: ["not tested: no test ran; check the test name"],
      code: 3,
    });
  });
});
