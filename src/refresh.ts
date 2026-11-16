import { isDeepStrictEqual } from "node:util";
import {
  type CheckedDraft,
  checkDraft,
  claimsGoingStale,
  leagueItem,
  type Problem,
  withLeagueItem,
} from "./check.ts";
import { type Credentials, loadCredentials } from "./config.ts";
import { type DataChange, diff } from "./data-diff.ts";
import { dataHash } from "./data-hash.ts";
import type { Deps } from "./deps.ts";
import { fetchEspn } from "./espn/fetcher.ts";
import { type FrontMatterValue, setFrontMatterValue } from "./front-matter.ts";
import type { League } from "./league.ts";
import { freshClashWarning, validatorNames } from "./lore.ts";
import { normalizeSnapshot } from "./normalize.ts";
import { startingOrder } from "./power-score.ts";
import { loadPunditSettings, methodForWeek } from "./pundit-settings.ts";
import { applyRetention } from "./retention.ts";
import { type FetchedSleeper, fetchSleeper } from "./sleeper/fetcher.ts";
import {
  FetchError,
  type FetchFix,
  listSnapshots,
  readSnapshot,
  type Snapshot,
  SnapshotDamagedError,
} from "./snapshot.ts";
import { triggerWinnerChanges, winnersText } from "./stakes.ts";
import { readWorkspace, snapshotsDir, type Workspace } from "./workspace.ts";
import { writeWorkspaceFile } from "./workspace-files.ts";

export interface RefreshResult {
  week: number;
  /** The draft refreshed. */
  path: string;
  /** The data changes found. */
  changes: DataChange[];
  /** Whether the pundit settings asked for another method or weights than the draft recorded. */
  methodChanged: boolean;
  /** The draft's data as of before this refresh. */
  dataAsOf: string;
  /** The snapshot the draft stands on now. */
  snapshot: string;
  /** The claims this refresh made stale. */
  newlyStale: Problem[];
  /** The whole problems list, hard first, moved teams against the new starting order. */
  problems: Problem[];
  /**
   * What reading the credentials for an ESPN fetch and the lore has to say,
   * personal data included.
   */
  warnings: string[];
  /** The newest scored week, when it's later than the draft's: time for its own draft. */
  scoredWeek?: number;
  /** The fetch failed, so this refresh continued from the last complete snapshot. */
  fromLastComplete: boolean;
}

/**
 * Refetches and, if the data changed, moves the latest draft onto a new
 * snapshot with a recomputed starting order. A changed method in the pundit
 * settings recomputes the order too, with no new snapshot if the data stands.
 * It never touches the pundit's order, blurbs, week or persona, and doesn't
 * auto-tag. With neither change it only updates `checked_at`. A failed fetch
 * continues from the last complete snapshot, leaving `checked_at`, with the
 * failed-fetch item; with no snapshot to continue from it throws, as a bad
 * settings file does, with the fix for what failed, and changes nothing.
 */
export async function refresh(
  workspaceDir: string,
  deps: Deps,
  opts: { full?: boolean } = {},
): Promise<RefreshResult> {
  const checked = await checkDraft(workspaceDir, { autoTag: false });
  const { meta } = checked.ranking;
  const ws = await readWorkspace(workspaceDir);
  const settings = await loadPunditSettings(ws);
  const fresh = await fetchOrContinue(ws, deps, opts);
  const withFailedFetch = (problems: Problem[]) =>
    withLeagueItem(problems, fresh.failedFetch);
  const changes = diff(
    checked.league,
    fresh.league,
    meta.week,
    meta.in_progress_week,
  );
  const newestScored = fresh.league.lastScoredWeek;
  const outcome = {
    fromLastComplete: fresh.failedFetch !== undefined,
    ...(newestScored > meta.week && { scoredWeek: newestScored }),
  };
  const method = methodForWeek(settings, fresh.league, meta.week);
  const methodChanged = !isDeepStrictEqual(meta.power_score, method);
  const now = deps.clock.now().toISOString();
  const name = `${checked.stem}.md`;
  const set = (text: string, key: string, value: FrontMatterValue) =>
    setFrontMatterValue(name, text, key, value);
  const setOrder = (text: string, league: League) =>
    set(
      set(text, "starting_order", startingOrder(league, meta.week, method)),
      "power_score",
      method,
    );

  // A draft continuing from the last complete snapshot wasn't checked against
  // fresh data, so its `checked_at` stands.
  const checkedAt = (text: string) =>
    fresh.failedFetch ? text : set(text, "checked_at", now);

  if (changes.length === 0) {
    let text = checkedAt(checked.text);
    if (methodChanged) {
      // On the draft's own league: fresh names or positions aren't a data
      // change, but a lineup's best points read them.
      text = setOrder(text, checked.league);
    }
    if (text !== checked.text) await writeWorkspaceFile(checked.path, text);
    const { problems, warnings } = methodChanged
      ? await checkDraft(workspaceDir, { autoTag: false })
      : checked;
    return {
      week: checked.week,
      path: checked.path,
      changes,
      methodChanged,
      dataAsOf: meta.data_as_of,
      snapshot: meta.snapshot,
      newlyStale: [],
      problems: withFailedFetch(problems),
      // The draft stays on its snapshot, so a clash only fresh names have
      // would otherwise go unsaid until the next draft stops on it.
      warnings: [
        ...fresh.warnings,
        ...warnings,
        ...freshClashes(checked, fresh.league),
      ],
      ...outcome,
    };
  }

  // Before anything's written: a nickname that clashes with the fresh names
  // would otherwise stop the check below, leaving the draft half refreshed.
  validatorNames(checked.lore, fresh.league, checked.handles);
  const { id, manifest } = await fresh.write();
  let text = checkedAt(checked.text);
  text = set(text, "data_as_of", manifest.fetched_at);
  text = set(text, "snapshot", id);
  text = set(text, "data_hash", dataHash(fresh.league, meta.week));
  text = setOrder(text, fresh.league);
  text = set(text, "earlier_snapshots", [
    ...(meta.earlier_snapshots ?? []),
    meta.snapshot,
  ]);
  await writeWorkspaceFile(checked.path, text);

  const refreshed = await checkDraft(workspaceDir, { autoTag: false });
  return {
    week: checked.week,
    path: checked.path,
    changes,
    methodChanged,
    dataAsOf: meta.data_as_of,
    snapshot: id,
    // Measured on the new text, so its lines match the problems list.
    newlyStale: claimsGoingStale(refreshed, checked.league, fresh.league),
    problems: withFailedFetch(refreshed.problems),
    warnings: [...fresh.warnings, ...refreshed.warnings],
    ...outcome,
  };
}

/**
 * The data-changed warning for a checked draft against freshly fetched data,
 * or none when the data through the draft's week is the same. A drastic
 * correction that changes a trigger winner adds its own line.
 */
export function dataChangedWarning(
  checked: CheckedDraft,
  fresh: League,
): string | undefined {
  const { week, data_as_of, in_progress_week } = checked.ranking.meta;
  if (diff(checked.league, fresh, week, in_progress_week).length === 0) {
    return undefined;
  }
  const stale = claimsGoingStale(checked, checked.league, fresh).length;
  const claims = stale === 1 ? "1 claim" : `${stale} claims`;
  const lines = [
    `data changed since ${data_as_of}: ${claims} would go stale, run \`refresh\``,
  ];
  const changes = triggerWinnerChanges(
    checked.stakes,
    checked.league,
    fresh,
    week,
  );
  if (changes.length > 0) {
    const names = new Map(fresh.teams.map((t) => [t.id, t.name]));
    const each = changes.map(
      (c) =>
        `${c.rule.name} in week ${c.week}, ${winnersText(c.from, names)} → ${winnersText(c.to, names)}`,
    );
    const count =
      changes.length === 1
        ? "1 trigger winner"
        : `${changes.length} trigger winners`;
    lines.push(`${count} changed: ${each.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * What a command that doesn't otherwise need fresh data has to say about it. A
 * failed fetch is only noted: it must never stop the command.
 */
export async function freshDataWarnings(
  workspaceDir: string,
  checked: CheckedDraft,
  deps: Deps,
): Promise<string[]> {
  // Said whether the fetch succeeds or fails.
  let credentialWarnings: string[] = [];
  try {
    const ws = await readWorkspace(workspaceDir);
    const { cookie, warnings } = await espnCookie(ws, deps);
    credentialWarnings = warnings;
    const { league } = await fetchFresh(ws, deps, { cookie });
    const warning = dataChangedWarning(checked, league);
    return [
      ...credentialWarnings,
      ...(warning ? [warning] : []),
      ...freshClashes(checked, league),
    ];
  } catch (err) {
    return [
      ...credentialWarnings,
      // A new correction is a data change too, so one note covers both.
      `couldn't check for data changes or corrections: ${(err as Error).message}`,
    ];
  }
}

/**
 * A warning for each lore nickname that reads as another team's name in fresh
 * data, which `draft` and a `refresh` onto changed data would stop on.
 */
function freshClashes(checked: CheckedDraft, fresh: League): string[] {
  const warnings: string[] = [];
  validatorNames(checked.lore, fresh, checked.handles, checked.stakes, (c) =>
    warnings.push(freshClashWarning(c)),
  );
  return warnings;
}

/**
 * The ESPN cookie a fetch of the workspace sends, with what reading the
 * credentials had to say, such as a `credentials.yaml` others can read. A
 * Sleeper workspace reads none. Given `credentials` already read, it reads
 * nothing and says nothing, since whoever read them says it.
 */
async function espnCookie(
  ws: Workspace,
  deps: Deps,
  credentials?: Credentials,
): Promise<{ cookie?: Credentials["espnS2"]; warnings: string[] }> {
  if (ws.season.platform !== "espn") return { warnings: [] };
  if (credentials) return { cookie: credentials.espnS2, warnings: [] };
  const { espnS2, warnings } = await loadCredentials(deps);
  return { cookie: espnS2, warnings };
}

/**
 * The workspace's latest season, fetched into memory with `cookie` on ESPN: no
 * snapshot yet. A routine fetch unless `full`. Writing the snapshot applies
 * retention.
 */
async function fetchFresh(
  ws: Workspace,
  deps: Deps,
  opts: { full?: boolean; cookie?: Credentials["espnS2"] } = {},
): Promise<FetchedSleeper> {
  const { cookie } = opts;
  const fetched =
    ws.season.platform === "espn"
      ? await fetchEspn({
          transport: deps.transport,
          clock: deps.clock,
          snapshotsDir: snapshotsDir(ws),
          leagueId: ws.season.leagueId,
          season: ws.season.year,
          ...(cookie ? { cookie } : {}),
          full: opts.full ?? false,
        })
      : await fetchSleeper({
          transport: deps.transport,
          clock: deps.clock,
          snapshotsDir: snapshotsDir(ws),
          cacheDir: deps.cacheDir,
          leagueId: ws.season.leagueId,
          full: opts.full ?? false,
        });
  return {
    league: fetched.league,
    async write() {
      const written = await fetched.write();
      // Pruning is housekeeping: one that fails deletes less, never fails the
      // command whose snapshot is already written, and runs again next write.
      await applyRetention(ws, deps.clock.now()).catch(() => undefined);
      return written;
    },
  };
}

/** A fetch, or the last complete snapshot when the fetch failed. */
export interface FetchedOrContinued extends FetchedSleeper {
  /** The failed-fetch item, when this continues from the last complete snapshot. */
  failedFetch?: Problem;
  /**
   * What reading the credentials for the ESPN cookie had to say, whether the
   * fetch succeeded or not; none when given `credentials`.
   */
  warnings: string[];
}

/**
 * `fetchFresh`, except that a failed or partial fetch continues from the last
 * complete snapshot: the season's newest whose data all reads, whose `write`
 * writes nothing and gives it back. With no snapshot to continue from, it
 * stops with the fetch's error, its message ending with the fix for what
 * failed. It reads the ESPN cookie itself unless given the `credentials`.
 */
export async function fetchOrContinue(
  ws: Workspace,
  deps: Deps,
  opts: { full?: boolean; credentials?: Credentials } = {},
): Promise<FetchedOrContinued> {
  const { cookie, warnings } = await espnCookie(ws, deps, opts.credentials);
  try {
    const fetched = await fetchFresh(ws, deps, {
      full: opts.full ?? false,
      cookie,
    });
    return { ...fetched, warnings };
  } catch (err) {
    if (!(err instanceof FetchError)) throw err;
    const dir = snapshotsDir(ws);
    const seasonSnapshots = (await listSnapshots(dir)).filter(
      ({ manifest: m }) =>
        m.platform === ws.season.platform &&
        m.league_id === ws.season.leagueId &&
        m.season === ws.season.year,
    );
    for (const candidate of seasonSnapshots.reverse()) {
      const snapshot = await readIfComplete(dir, candidate.id);
      if (!snapshot) continue;
      return {
        league: normalizeSnapshot(snapshot),
        write: async () => candidate,
        failedFetch: failedFetchItem(err, candidate.manifest.fetched_at),
        warnings,
      };
    }
    throw new FetchError(`${err.message}. ${FETCH_FIXES[err.fix].stopping}`, {
      cause: err,
      fix: err.fix,
    });
  }
}

/**
 * The snapshot, or nothing when its manifest or a blob it lists is gone or
 * damaged: skipped silently, neither deleted nor repaired.
 */
async function readIfComplete(
  dir: string,
  id: string,
): Promise<Snapshot | undefined> {
  try {
    return await readSnapshot(dir, id);
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code === "ENOENT" ||
      err instanceof SnapshotDamagedError
    )
      return undefined;
    throw err;
  }
}

const LEAGUE_ID_FIX =
  "The platform doesn't know this league: check league_id in workspace.md, or run lazy-pundit init for a new workspace.";
const UPDATE_FIX =
  "This version can't read what the platform answered: check for a newer Lazy Pundit.";
/** A rejected stored cookie's fix, which `doctor` gives too. */
export const SETUP_ESPN_FIX =
  "Copy a fresh espn_s2 from your browser, then run: lazy-pundit setup espn";
/** A rejected `LAZY_PUNDIT_ESPN_S2`'s fix, which `doctor` gives too. */
export const ESPN_ENV_FIX =
  "Set LAZY_PUNDIT_ESPN_S2 to a fresh espn_s2 from your browser, or unset it to use the stored cookie.";

/**
 * What the pundit is told to do, for each kind of failure: `continuing` ends
 * the failed-fetch item, `stopping` the error when there's no last complete
 * snapshot, where no draft exists for `refresh` to move.
 */
const FETCH_FIXES: Record<FetchFix, { continuing: string; stopping: string }> =
  {
    refresh: {
      continuing: "Once fetching works, run: lazy-pundit refresh",
      stopping: "Once fetching works, run the command again.",
    },
    league_id: { continuing: LEAGUE_ID_FIX, stopping: LEAGUE_ID_FIX },
    update: { continuing: UPDATE_FIX, stopping: UPDATE_FIX },
    setup_espn: { continuing: SETUP_ESPN_FIX, stopping: SETUP_ESPN_FIX },
    espn_env: { continuing: ESPN_ENV_FIX, stopping: ESPN_ENV_FIX },
  };

/** The failed-fetch item: a soft league item with the fix for what failed. */
function failedFetchItem(err: FetchError, dataAsOf: string): Problem {
  return leagueItem(
    "failed-fetch",
    `couldn't fetch: ${err.message}. Continuing from the last complete snapshot, data as of ${dataAsOf}. ${FETCH_FIXES[err.fix].continuing}`,
  );
}
