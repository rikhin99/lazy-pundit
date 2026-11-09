import { expect, test } from "vitest";
import { isRepoCommit } from "../scripts/trace-context.ts";

const SCRATCH = "/private/tmp/claude-501/x/scratchpad";

test("a commit in the repo counts, with its message in a scratchpad file", () => {
  expect(isRepoCommit("git commit -m 'Fix'")).toBe(true);
  expect(
    isRepoCommit(`git add -A src && git commit -q -F ${SCRATCH}/commit-74.txt`),
  ).toBe(true);
  expect(isRepoCommit(`git commit --file=${SCRATCH}/msg.txt`)).toBe(true);
  expect(isRepoCommit(`git commit --file ${SCRATCH}/msg.txt`)).toBe(true);
});

test("a commit in a scratch clone or a scratchpad script doesn't", () => {
  expect(isRepoCommit(`cd ${SCRATCH}/clone && git commit -m x`)).toBe(false);
  expect(isRepoCommit("git -C src/clone commit -m x")).toBe(false);
  expect(isRepoCommit(`bash ${SCRATCH}/run.sh; git commit -m x`)).toBe(false);
  expect(isRepoCommit("git log --oneline")).toBe(false);
});
