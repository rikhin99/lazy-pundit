/**
 * Dev only. Captures a live ESPN season's raw payloads into a raw folder, in
 * the layout `npm run scrub:espn` reads (`league.json`, `schedule.json`,
 * `rosters.json`, `boxscores/week-NN.json`, `transactions/week-NN.json`):
 *
 *   npm run capture:espn -- <league ID> <season> fixtures/raw/espn/<folder>
 *
 * The maintainer runs it; an agent never needs the cookie. It's the operator's
 * stored ESPN cookie (`lazy-pundit setup espn`) or `LAZY_PUNDIT_ESPN_S2`, as
 * `refresh` reads it, and it's never an argument or printed. The capture runs
 * the fetcher's own full fetch through a recording transport, so the raw files
 * are what the fetcher asks for: a request it can't map to a raw file fails the
 * capture, naming its views as `npm run fixture:show` lists them. It refuses a
 * raw folder that already holds files, writes nothing until the whole fetch has
 * succeeded, and prints a count per file, with no names, IDs or cookie.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ESPN_VIEWS } from "../src/espn/api.ts";
import { checkEspnCookie } from "../src/espn/fetcher.ts";
import {
  type Deps,
  FetchError,
  fetchEspn,
  loadCredentials,
  systemDeps,
  type Transport,
  type TransportRequest,
} from "../src/index.ts";
import { ESPN_ENV_FIX, SETUP_ESPN_FIX } from "../src/refresh.ts";

/** A capture that stopped, with the one line saying why. */
export class CaptureError extends Error {
  override name = "CaptureError";
}

/**
 * The payload lists a raw file's count is of, by their field in the payload,
 * and what their entries are called in the output.
 */
const LIST_ENTRIES = {
  teams: "teams",
  schedule: "matchups",
  transactions: "transactions",
} as const;
type PayloadList = keyof typeof LIST_ENTRIES;

/**
 * Each raw file the scrub reads, by the views asking for it, and the payload
 * list it counts. A weekly one is a folder of `week-NN.json`, by scoring period.
 */
const RAW_FILES = new Map<
  string,
  { file: string; weekly?: true; list: PayloadList }
>([
  [ESPN_VIEWS.league.join("+"), { file: "league.json", list: "teams" }],
  [ESPN_VIEWS.schedule.join("+"), { file: "schedule.json", list: "schedule" }],
  [ESPN_VIEWS.rosters.join("+"), { file: "rosters.json", list: "teams" }],
  [
    ESPN_VIEWS.boxscores.join("+"),
    { file: "boxscores", weekly: true, list: "schedule" },
  ],
  [
    ESPN_VIEWS.transactions.join("+"),
    { file: "transactions", weekly: true, list: "transactions" },
  ],
]);

/**
 * A request's views and scoring period as `npm run fixture:show` lists them
 * (`mMatchupScore+mScoreboard@10`), and the raw file it lands in, if any. A
 * weekly file needs its scoring period, and the shared files none.
 */
function rawFileOf(req: Pick<TransportRequest, "url" | "params">) {
  const views = new URL(req.url).searchParams.getAll("view").join("+");
  const period = req.params?.scoringPeriodId;
  const name = period === undefined ? views : `${views}@${period}`;
  const raw = RAW_FILES.get(views);
  if (!raw || Boolean(raw.weekly) !== (period !== undefined)) return { name };
  if (!raw.weekly) return { name, file: raw.file, list: raw.list };
  const file = `${raw.file}/week-${(period ?? "").padStart(2, "0")}.json`;
  return { name, file, list: raw.list, week: Number(period) };
}

/** Runs `inner`, keeping each answered payload under its raw file. */
function recording(inner: Transport) {
  const files = new Map<
    string,
    { body: Uint8Array; list: PayloadList; week: number | undefined }
  >();
  const unmapped: string[] = [];
  const transport: Transport = {
    async request(req) {
      const raw = rawFileOf(req);
      if (!raw.file) unmapped.push(raw.name);
      const res = await inner.request(req);
      if (raw.file && res.status >= 200 && res.status < 300) {
        const { list, week } = raw;
        files.set(raw.file, { body: res.body, list, week });
      }
      return res;
    },
  };
  return { transport, files, unmapped };
}

export async function captureEspn(opts: {
  deps: Pick<Deps, "transport" | "clock" | "configDir" | "env">;
  leagueId: string;
  season: string;
  rawDir: string;
  log: (line: string) => void;
  /** The fetch the capture runs: the fetcher's own, unless a test adds to it. */
  fetch?: typeof fetchEspn;
}): Promise<void> {
  const { deps, leagueId, season, rawDir, log } = opts;
  const held = await readdir(rawDir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw new CaptureError(
      `The raw folder can't be read as a folder (${err.code}): capture into a new folder.`,
    );
  });
  if (held.length > 0) {
    throw new CaptureError(
      "The raw folder isn't empty: capture into a new folder, so no raw data is overwritten.",
    );
  }

  const { espnS2: cookie, warnings } = await loadCredentials(deps);
  for (const warning of warnings) log(warning);

  const checked = await checkEspnCookie(deps.transport, cookie?.value, {
    leagueId,
    season,
  });
  const hidden = (message: string) => hideLeague(message, leagueId);
  if (checked === "rejected") {
    if (!cookie) {
      throw new CaptureError(
        "ESPN refused the league without a cookie: it's a private league. Run lazy-pundit setup espn in its workspace, or set LAZY_PUNDIT_ESPN_S2.",
      );
    }
    throw new CaptureError(
      cookie.from === "env"
        ? `ESPN cookie rejected (from LAZY_PUNDIT_ESPN_S2). ${ESPN_ENV_FIX}`
        : `ESPN cookie rejected (saved ${cookie.savedAt}). ${SETUP_ESPN_FIX} (or set LAZY_PUNDIT_ESPN_S2)`,
    );
  }
  if (checked === "no league") {
    throw new CaptureError(
      `ESPN has no such league in ${season}: check the league ID.`,
    );
  }
  if (checked !== "ok") {
    throw new CaptureError(
      `Couldn't check the cookie: ${hidden(checked.unreachable)}. Check your connection, then run it again.`,
    );
  }

  const recorder = recording(deps.transport);
  const fetched = await (opts.fetch ?? fetchEspn)({
    transport: recorder.transport,
    clock: deps.clock,
    snapshotsDir: rawDir,
    leagueId,
    season,
    ...(cookie ? { cookie } : {}),
    full: true,
  }).then(
    () => undefined,
    (err: Error) => err,
  );
  if (recorder.unmapped.length > 0) {
    throw new CaptureError(
      `The fetcher asked for views no raw file holds: ${[...new Set(recorder.unmapped)].join(", ")}. Map them in scripts/capture-espn.ts's RAW_FILES, and read them in scrub:espn's readRaw.`,
    );
  }
  if (fetched) {
    const fix =
      fetched instanceof FetchError && fetched.fix === "update"
        ? "the fetcher needs updating for ESPN's answer before a capture"
        : "run it again";
    throw new CaptureError(
      `${hidden(fetched.message)}. Nothing was written: ${fix}.`,
    );
  }

  const files = [...recorder.files].sort(([a], [b]) => (a < b ? -1 : 1));
  const width = Math.max(...files.map(([file]) => file.length)) + 2;
  for (const [file, { body, list, week }] of files) {
    const path = join(rawDir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    const count = countOf(body, list, week);
    log(`${file.padEnd(width)}${count} ${LIST_ENTRIES[list]}`);
  }
  log(`Wrote ${files.length} files.`);
}

/**
 * How many entries a payload's list holds. A weekly file's schedule counts
 * only its own week's matchups, those whose matchup period is the file's
 * scoring period, as the fetcher reads them: ESPN sends a week's box scores
 * with the whole season's schedule.
 */
function countOf(body: Uint8Array, list: PayloadList, week?: number): number {
  try {
    const entries: unknown = JSON.parse(new TextDecoder().decode(body))?.[list];
    if (!Array.isArray(entries)) return 0;
    if (list !== "schedule" || week === undefined) return entries.length;
    return entries.filter((m) => m?.matchupPeriodId === week).length;
  } catch {
    return 0;
  }
}

/** A fetch error's message, with the league's URL and ID left out. */
function hideLeague(message: string, leagueId: string) {
  return message.replaceAll(
    new RegExp(`\\b${leagueId.replace(/\W/g, "\\$&")}\\b`, "g"),
    "<league ID>",
  );
}

if (import.meta.main) {
  const [leagueId, season, rawDir, ...rest] = process.argv.slice(2);
  if (!leagueId || !season || !rawDir || rest.length > 0) {
    console.error(
      "Usage: npm run capture:espn -- <league ID> <season> fixtures/raw/espn/<folder>",
    );
    process.exit(2);
  }
  try {
    await captureEspn({
      deps: systemDeps(),
      leagueId,
      season,
      rawDir: resolve(rawDir),
      log: (line) => console.log(line),
    });
  } catch (err) {
    if (!(err instanceof CaptureError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}
