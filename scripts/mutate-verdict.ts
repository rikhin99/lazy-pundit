/** What `npm run mutate` reads back from vitest's JSON report. */
export interface Report {
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: {
      fullName: string;
      status: string;
      failureMessages?: string[];
    }[];
  }[];
}

/**
 * A mutation run's verdict: the lines to print and the exit code. 0 when a
 * test went red, 1 when every test passed (the mutation survived), 3 when
 * the test file didn't load, so nothing was tested: a mutation that doesn't
 * parse, or breaks an import, proves nothing about the tests.
 */
export function verdict(report: Report): { lines: string[]; code: number } {
  const unloaded = report.testResults.filter(
    (r) => r.status === "failed" && r.assertionResults.length === 0,
  );
  if (unloaded.length > 0) {
    return {
      lines: [
        "not tested: the test file failed to load; check the mutation parses",
        ...unloaded.map((r) => `  ${(r.message ?? "").split("\n")[0]}`),
      ],
      code: 3,
    };
  }
  // A test a name filter skipped didn't run, so it isn't counted.
  const results = report.testResults
    .flatMap((r) => r.assertionResults)
    .filter((a) => a.status === "passed" || a.status === "failed");
  if (results.length === 0) {
    return {
      lines: ["not tested: no test ran; check the test name"],
      code: 3,
    };
  }
  const failed = results.filter((a) => a.status === "failed");
  if (failed.length === 0) {
    return { lines: [`survived: all ${results.length} passed`], code: 1 };
  }
  // The first line of each failure, so a red from the mutation itself (a
  // ReferenceError, say) reads apart from a red on the behaviour. Past
  // RED_SHOWN, the rest are a count.
  const rest = failed.length - RED_SHOWN;
  return {
    lines: [
      `red: ${failed.length} of ${results.length} failed`,
      ...failed
        .slice(0, RED_SHOWN)
        .flatMap((a) => [
          `  × ${a.fullName}`,
          `    ${(a.failureMessages?.[0] ?? "").split("\n")[0]}`,
        ]),
      ...(rest > 0 ? [`  and ${rest} more red`] : []),
    ],
    code: 0,
  };
}

/** How many red tests a verdict names before counting the rest. */
const RED_SHOWN = 5;
