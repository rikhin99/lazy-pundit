import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  type Problem,
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

/** Writes the Fear The Turtle pundit's settings file with `lines` of front matter. */
export async function writeSettings(dir: string, lines: string) {
  await mkdir(join(dir, "pundits/rikhin"), { recursive: true });
  await writeFile(
    join(dir, "pundits/rikhin/settings.md"),
    `---\nformat: 1\n${lines}\n---\n`,
  );
}

/**
 * `fearTheTurtle` whose pundit settings ask for the standings method, for tests
 * whose literals follow a team's place rather than the power score behind it.
 */
export async function onStandings(week: number) {
  const ws = await fearTheTurtle(week);
  await writeSettings(ws.dir, "method: standings");
  return ws;
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
 * A problems list without the correction-timing reminder, which every draft of
 * a scored week carries, so "nothing else to fix" reads as `[]`.
 */
export function withoutReminder(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.kind !== "correction-timing");
}

/**
 * The same transport, except that it never answers the request for `url` (or
 * any request, with none). `asked()` resolves with that request's `signal`
 * once it is made and every other request has been answered, so a fake-timer
 * test can then advance the clock without timing out a request still reading
 * the replay from disk.
 */
export function silentOn(
  transport: Transport,
  url?: string,
): { transport: Transport; asked: () => Promise<AbortSignal | undefined> } {
  let signal: AbortSignal | undefined;
  let silent = false;
  let answering = 0;
  const realTick = () => new Promise((resolve) => setImmediate(resolve));
  return {
    async asked() {
      while (!silent || answering > 0) await realTick();
      return signal;
    },
    transport: {
      async request(req) {
        if (url !== undefined && req.url !== url) {
          answering++;
          try {
            return await transport.request(req);
          } finally {
            answering--;
          }
        }
        signal = req.signal;
        silent = true;
        return new Promise(() => {});
      },
    },
  };
}

/** The same deps, whose fetch fails on the request for `url` alone. */
export function failingOn(deps: Deps, url: string): Deps {
  return {
    ...deps,
    transport: {
      request: (req) =>
        req.url === url
          ? Promise.reject(new Error("offline"))
          : deps.transport.request(req),
    },
  };
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
 * A patch for a matchups payload: a stat correction of `points` for one team's
 * first starter, by the team's `roster_id`.
 */
export function statCorrection(rosterId: number, points: number) {
  return (payload: Json) => {
    const side = payload.find((s: Json) => s.roster_id === rosterId);
    side.points += points;
    side.starters_points[0] += points;
    side.players_points[side.starters[0]] += points;
  };
}

/**
 * A change to one payload: a function that changes it in place (what it
 * returns is ignored), or `{ replaceWith }` for a whole new answer, such as
 * the `null` Sleeper answers for a league it doesn't know.
 */
export type Patch = ((payload: Json) => unknown) | { replaceWith: Json };

/**
 * Wraps a transport so each payload whose URL has a patch is changed before
 * it's recorded: a real payload, varied the way a real fetch could see it.
 */
export function patchingTransport(
  inner: Transport,
  patches: Record<string, Patch>,
): Transport {
  return {
    async request(req) {
      const res = await inner.request(req);
      const patch = patches[req.url];
      if (!patch) return res;
      let payload = JSON.parse(new TextDecoder().decode(res.body));
      if (typeof patch === "function") patch(payload);
      else payload = patch.replaceWith;
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
 * have seen them, and normalizes the result. Keys are paths under the league,
 * and a key that no fetch asked for fails the test.
 */
export async function patched(
  week: number,
  patches: Record<string, (payload: Json) => void>,
): Promise<League> {
  const base = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;
  const unused = new Set(Object.keys(patches));
  const transport = patchingTransport(
    fileTransport(FIXTURES, WEEKS[String(week)] as string),
    Object.fromEntries(
      Object.entries(patches).map(([p, f]) => [
        p ? `${base}/${p}` : base,
        (payload: Json) => {
          unused.delete(p);
          f(payload);
        },
      ]),
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
  if (unused.size > 0) {
    throw new Error(
      `patched: no fetch asked for ${[...unused].join(", ")}, so the patch changed nothing`,
    );
  }
  return normalizeSleeper(await readSnapshot(dir, id));
}

/** Publishes and expects it to go through. */
export async function published(dir: string, deps: Deps) {
  const result = await publish(dir, deps);
  if (!result.published) throw new Error("held back to editing");
  return result;
}

/**
 * A frozen copy's text without the two publish-record lines every publish
 * adds after `edition` (`first_published_at`, `blurb_problems`), so a test of
 * what else the frozen copy keeps compares with the draft's text.
 */
export function withoutPublishRecord(text: string): string {
  return text.replace(/^(?:first_published_at|blurb_problems): .*\r?\n/gm, "");
}

/**
 * A Markdown file's text with its front matter rewritten: `rewrite` gets the
 * lines between the `---` fences and returns the ones to put there instead,
 * such as every key indented, as the pundit's editing might leave them.
 */
export function withFrontMatter(
  text: string,
  rewrite: (lines: string[]) => string[],
): string {
  const { yaml, end } = fenced(text);
  const lines = rewrite(yaml.split(/\r?\n/));
  return `---\n${lines.join("\n")}\n---\n${text.slice(end)}`;
}

/** The YAML front matter of a Markdown file. */
export function frontMatter(text: string): Record<string, unknown> {
  return parseYaml(fenced(text).yaml);
}

/** The text between a Markdown file's `---` fences, and where the closing one ends. */
function fenced(text: string): { yaml: string; end: number } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match?.[1]) throw new Error("no front matter");
  return { yaml: match[1], end: match[0].length };
}
