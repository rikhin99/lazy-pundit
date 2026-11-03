import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  type Clipboard,
  type Clock,
  type Deps,
  fetchSleeperSnapshot,
  fileTransport,
  type League,
  normalizeSleeper,
  publish,
  readSnapshot,
  type Transport,
} from "../../src/index.ts";
import { SLEEPER_API } from "../../src/sleeper/api.ts";
import { noLlm } from "./llm.ts";

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
    find: async () => "recording",
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
  const clipboard = recordingClipboard();
  const deps: Deps = { ...(await operator()), clipboard };
  return { dir, deps: atWeek(deps, week), clipboard };
}

/**
 * The same deps replaying the committed snapshot for `week` instead, so a
 * test can publish one week in a workspace and then draft a later one.
 */
export function atWeek(deps: Deps, week: number): Deps {
  const snapshot = WEEKS[String(week)];
  if (!snapshot) throw new Error(`no committed snapshot for week ${week}`);
  return { ...deps, transport: fileTransport(FIXTURES, snapshot) };
}

/**
 * Deps for one operator on a fresh machine: temp config, cache and workspaces
 * folders, no environment overrides, Node 24, a fixed clock, a recording
 * clipboard, a transport that answers 404 to everything and an LLM that
 * fails the test if called.
 */
export async function operator(): Promise<Deps> {
  const home = await mkdtemp(join(tmpdir(), "lazy-pundit-home-"));
  return {
    transport: {
      request: async () => ({ status: 404, body: new Uint8Array() }),
    },
    llm: noLlm,
    clock: fixedClock("2025-10-28T15:00:00.000Z"),
    clipboard: recordingClipboard(),
    cacheDir: join(home, ".cache", "lazy-pundit"),
    configDir: join(home, ".config", "lazy-pundit"),
    workspacesDir: join(home, "lazy-pundit"),
    env: { nodeVersion: "v24.0.0" },
  };
}

/** Where a pundit's ranking files for a season live. */
export function rankingsDir(dir: string, season = "2025", pundit = "rikhin") {
  return join(dir, "pundits", pundit, season);
}

// biome-ignore lint/suspicious/noExplicitAny: a raw payload being patched
export type Json = any;

/**
 * Wraps a transport so each payload whose URL has a patch is changed before
 * it's recorded: a real payload, varied the way a real fetch could see it.
 */
export function patchingTransport(
  inner: Transport,
  patches: Record<string, (payload: Json) => void>,
): Transport {
  return {
    async request(req) {
      const res = await inner.request(req);
      const patch = patches[req.url];
      if (!patch) return res;
      const payload = JSON.parse(new TextDecoder().decode(res.body));
      patch(payload);
      return {
        status: 200,
        body: new TextEncoder().encode(JSON.stringify(payload)),
      };
    },
  };
}

/** A committed week's snapshot, normalized. */
export async function committed(week: number): Promise<League> {
  return normalizeSleeper(
    await readSnapshot(FIXTURES, WEEKS[String(week)] as string),
  );
}

/**
 * Replays a committed week with some payloads patched, as a real fetch would
 * have seen them, and normalizes the result. Keys are paths under the league.
 */
export async function patched(
  week: number,
  patches: Record<string, (payload: Json) => void>,
): Promise<League> {
  const base = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;
  const transport = patchingTransport(
    fileTransport(FIXTURES, WEEKS[String(week)] as string),
    Object.fromEntries(
      Object.entries(patches).map(([p, f]) => [p ? `${base}/${p}` : base, f]),
    ),
  );
  const dir = await mkdtemp(join(tmpdir(), "lazy-pundit-"));
  const { id } = await fetchSleeperSnapshot({
    transport,
    clock: fixedClock("2025-10-28T15:00:00.000Z"),
    snapshotsDir: dir,
    cacheDir: await mkdtemp(join(tmpdir(), "lazy-pundit-cache-")),
    leagueId: FEAR_THE_TURTLE_ID,
  });
  return normalizeSleeper(await readSnapshot(dir, id));
}

/** Publishes and expects it to go through. */
export async function published(dir: string, deps: Deps) {
  const result = await publish(dir, deps);
  if (!result.published) throw new Error("held back to editing");
  return result;
}

/** The YAML front matter of a Markdown file. */
export function frontMatter(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match?.[1]) throw new Error("no front matter");
  return parseYaml(match[1]);
}
