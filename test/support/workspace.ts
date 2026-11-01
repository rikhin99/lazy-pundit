import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Clipboard,
  type Clock,
  type Deps,
  fileTransport,
} from "../../src/index.ts";

export const FIXTURES = join(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
  "sleeper",
  "fear-the-turtle-2025",
);

/** Ranking week → committed snapshot ID. */
export const WEEKS: Record<string, string> = JSON.parse(
  readFileSync(join(FIXTURES, "weeks.json"), "utf8"),
);

export const FEAR_THE_TURTLE_ID = "900000000000000001";

/** A clipboard that remembers everything written to it. */
export function recordingClipboard(): Clipboard & { copied: string[] } {
  const copied: string[] = [];
  return {
    copied,
    async write(text) {
      copied.push(text);
      return true;
    },
  };
}

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

/**
 * A hand-written league workspace for Fear The Turtle 2025 with one pundit,
 * plus deps that replay the committed snapshot for `week`.
 */
export async function fearTheTurtle(week: number) {
  const dir = await mkdtemp(join(tmpdir(), "lazy-pundit-ws-"));
  await writeFile(
    join(dir, "workspace.md"),
    `---
format: 1
pundit: rikhin
seasons:
  2025:
    platform: sleeper
    league_id: "${FEAR_THE_TURTLE_ID}"
---

# Fear The Turtle
`,
  );
  const snapshot = WEEKS[String(week)];
  if (!snapshot) throw new Error(`no committed snapshot for week ${week}`);
  const clipboard = recordingClipboard();
  const deps: Deps = {
    transport: fileTransport(FIXTURES, snapshot),
    clock: fixedClock("2025-10-28T15:00:00.000Z"),
    clipboard,
  };
  return { dir, deps, clipboard };
}

/** Where a pundit's ranking files for a season live. */
export function rankingsDir(dir: string, season = "2025", pundit = "rikhin") {
  return join(dir, "pundits", pundit, season);
}
