import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Vitest global setup: every temp folder a test makes, workspaces, caches and
 * snapshot folders included, goes under one folder for the run, which is
 * removed when the run ends.
 */
export default async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lazy-pundit-test-run-"));
  process.env.TMPDIR = root;
  return () => rm(root, { recursive: true, force: true });
}
