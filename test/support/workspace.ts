import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  type Clipboard,
  type Clock,
  checkLeague,
  type Deps,
  fetchSleeperSnapshot,
  fileTransport,
  type League,
  normalizeSleeper,
  type Problem,
  proposedHandles,
  proposedNicknames,
  publish,
  readManifest,
  readSnapshot,
  rerunStep,
  setUpWorkspace,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from "../../src/index.ts";
import { SLEEPER_API } from "../../src/sleeper/api.ts";
import { listSnapshots } from "../../src/snapshot.ts";
import { readWorkspace } from "../../src/workspace.ts";
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

/** A machine with no clipboard: nothing to copy to. */
export function noClipboard(): Clipboard {
  return { write: async () => false, find: async () => undefined };
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
 * Writes the 2025 season's `league.md` with `fields` of front matter (stakes,
 * house rules, rivalry weeks), each line ending in a newline, and `body` below.
 * The family league is off unless `fields` sets `family-league:`.
 */
export async function writeLeagueFile(
  dir: string,
  fields: string,
  body = "<!-- Free text rules go under a heading. -->\n",
): Promise<void> {
  const season = join(dir, "seasons", "2025");
  await mkdir(season, { recursive: true });
  const family = /^family-league:/m.test(fields) ? "" : "family-league: off\n";
  await writeFile(
    join(season, "league.md"),
    `---
league: 1
season: "2025"
${family}${fields}---

${body}`,
  );
}

/** Writes the Fear The Turtle pundit's `persona.md`. */
export async function writePersona(dir: string, text: string): Promise<void> {
  await mkdir(join(dir, "pundits", "rikhin"), { recursive: true });
  await writeFile(join(dir, "pundits", "rikhin", "persona.md"), text);
}

/** A Roast `persona.md` that relaxes the family league. */
export const RELAXED_ROAST =
  "---\nformat: 1\npreset: roast\nfamily-league: relaxed\n---\n";

/**
 * A weekly high-score house rule paying `outcome`, as one `house-rules:` item
 * with `extra` lines (each indented four spaces) added to it.
 */
export function highScore(outcome = "$10", extra = ""): string {
  return `  - id: high-score
    name: Weekly high score
    trigger: high-score
    per: week
    outcome: ${outcome}
${extra}`;
}

/** Each handle's account in Fear The Turtle; any other handle links to no team. */
const HANDLE_ACCOUNTS: Record<string, string> = {
  gus: "sleeper:800000000000000001",
  wendy: "sleeper:800000000000000002",
  frank: "sleeper:800000000000000004",
  pete: "sleeper:800000000000000006",
};

/** Links each handle to its account (`HANDLE_ACCOUNTS`) in `workspace.md`. */
export async function linkHandles(
  dir: string,
  handles: string[],
): Promise<void> {
  const path = join(dir, "workspace.md");
  const text = await readFile(path, "utf8");
  const lines = handles
    .map(
      (h) => `  ${h}: ["${HANDLE_ACCOUNTS[h] ?? "sleeper:no-such-account"}"]`,
    )
    .join("\n");
  await writeFile(path, text.replace("\n---\n", `\nhandles:\n${lines}\n---\n`));
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

/**
 * The same deps, whose fetch fails on the request for `url` alone: one with
 * every one of `params` too (a week's ESPN box scores share one URL, told
 * apart by `scoringPeriodId`), answered with `answer`, or rejected as offline.
 */
export function failingOn(
  deps: Deps,
  url: string,
  opts: { params?: Record<string, string>; answer?: TransportResponse } = {},
): Deps {
  const matches = (req: TransportRequest) =>
    req.url === url &&
    Object.entries(opts.params ?? {}).every(([k, v]) => req.params?.[k] === v);
  return {
    ...deps,
    transport: {
      request: (req) =>
        !matches(req)
          ? deps.transport.request(req)
          : opts.answer
            ? Promise.resolve(opts.answer)
            : Promise.reject(new Error("offline")),
    },
  };
}

/**
 * Deletes the blob of `id`'s snapshot in `dir`'s workspace that no other
 * snapshot there lists, as a hand deletion would, and gives its path.
 */
export async function deleteOwnBlob(dir: string, id: string): Promise<string> {
  const snapshots = join(dir, ".snapshots");
  const others = new Set<string>();
  for (const other of await listSnapshots(snapshots)) {
    if (other.id === id) continue;
    for (const r of other.manifest.requests) others.add(r.sha256);
  }
  const { requests } = await readManifest(snapshots, id);
  const own = requests.find((r) => !others.has(r.sha256));
  if (!own) throw new Error(`snapshot ${id} has no blob of its own`);
  const path = join(snapshots, "blobs", `${own.sha256}.json.gz`);
  await rm(path);
  return path;
}

/**
 * Writes a snapshot of week 10, fetched 2025-11-05, into `dir`'s workspace,
 * newer than any a week-8 draft makes and named by nothing, and gives its ID.
 */
export async function newerSnapshot(dir: string, deps: Deps): Promise<string> {
  const d = atWeek(deps, 10);
  const { id } = await fetchSleeperSnapshot({
    transport: d.transport,
    clock: fixedClock("2025-11-05T15:00:00.000Z"),
    snapshotsDir: join(dir, ".snapshots"),
    cacheDir: d.cacheDir,
    leagueId: FEAR_THE_TURTLE_ID,
  });
  return id;
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
    homeDir: home,
    cwd: home,
    env: { nodeVersion: "v24.0.0" },
  };
}

/**
 * A Fear The Turtle workspace set up at week 8 whose `lore.md` is the lore
 * step's own for the first two teams, their managers linked as handles.
 * `writeBody` writes `lore.md` as the step's top (front matter, `# Lore` and
 * its comment) and `body`, for a test that writes sections by hand.
 */
export async function twoTeamLore() {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const { dir } = await setUpWorkspace(deps, { punditName: "Rikhin", league });
  const yes = async () => true;
  const handles = proposedHandles(league);
  await rerunStep(deps, dir, { step: "handles", league, handles }, yes);
  const nicknames = proposedNicknames(league, handles).slice(0, 2);
  const lore = { type: "friends" as const, nicknames };
  await rerunStep(deps, dir, { step: "lore", league, lore }, yes);
  const lorePath = join(dir, "lore.md");
  const written = await readFile(lorePath, "utf8");
  // The top comment shows a `## League` too, so the section is the last one.
  const top = written.slice(0, written.lastIndexOf("## League"));
  const writeBody = (body: string) => writeFile(lorePath, top + body);
  const ws = await readWorkspace(dir);
  return { deps, dir, league, ws, nicknames, lorePath, top, writeBody };
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

/** Changes to a preseason replay, made after `preseason`'s own. */
export interface Preseason {
  /** Patches to the league payload, after its scored week is set to 0. */
  league?: (league: Json) => void;
  /** Patches to each roster, after its record and points are zeroed. */
  roster?: (roster: Json) => void;
}

/**
 * Fear The Turtle's week-1 replay made a preseason: no week scored, and every
 * roster's record and points zeroed, as a real league reads before week 1.
 */
export function preseason(deps: Deps, patch: Preseason = {}): Deps {
  const league = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;
  return {
    ...deps,
    transport: patchingTransport(deps.transport, {
      [league]: (payload: Json) => {
        payload.settings.last_scored_leg = 0;
        patch.league?.(payload);
      },
      [`${league}/rosters`]: (rosters: Json[]) => {
        for (const r of rosters) {
          for (const key of [
            "wins",
            "losses",
            "ties",
            "fpts",
            "fpts_decimal",
            "fpts_against",
            "fpts_against_decimal",
          ]) {
            r.settings[key] = 0;
          }
          patch.roster?.(r);
        }
      },
    }),
  };
}

/** `preseason`'s replay written as a snapshot, for the CLI's `LAZY_PUNDIT_REPLAY`: its folder. */
export async function preseasonReplay(patch?: Preseason): Promise<string> {
  const deps = preseason(atWeek(await operator(), 1), patch);
  const snapshots = await mkdtemp(join(tmpdir(), "lazy-pundit-replay-"));
  const { id } = await fetchSleeperSnapshot({
    transport: deps.transport,
    clock: deps.clock,
    snapshotsDir: snapshots,
    cacheDir: deps.cacheDir,
    leagueId: FEAR_THE_TURTLE_ID,
  });
  return join(snapshots, id);
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

/**
 * Publishes and expects it to go through; held back, it throws naming what
 * stopped it and each problem, so a failing test says why.
 */
export async function published(dir: string, deps: Deps) {
  const result = await publish(dir, deps);
  if (!result.published) {
    const lines = result.problems.map(
      (p) => `${p.severity} ${p.section}: "${p.text}" (${p.kind}) ${p.reason}`,
    );
    throw new Error(
      `held back to editing by ${result.stoppedBy} problems:\n${lines.join("\n")}`,
    );
  }
  return result;
}

/**
 * A frozen copy's text without the three publish-record lines every publish
 * adds after `edition` (`first_published_at`, `blurb_problems`,
 * `log_entries`), so a test of what else the frozen copy keeps compares with
 * the draft's text.
 */
export function withoutPublishRecord(text: string): string {
  return text.replace(
    /^(?:first_published_at|blurb_problems|log_entries): .*\r?\n/gm,
    "",
  );
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
