import { isDeepStrictEqual } from "node:util";
import {
  type CheckedDraft,
  checkDraft,
  claimsGoingStale,
  leagueItem,
  type Problem,
  withLeagueItem,
} from "./check.ts";
import { type DataChange, diff } from "./data-diff.ts";
import { dataHash } from "./data-hash.ts";
import type { Deps } from "./deps.ts";
import { list } from "./evidence-pack.ts";
import { type FrontMatterValue, setFrontMatterValue } from "./front-matter.ts";
import type { League, TeamId } from "./league.ts";
import { validatorNames } from "./lore.ts";
import { startingOrder } from "./power-score.ts";
import { loadPunditSettings, methodForWeek } from "./pundit-settings.ts";
import { applyRetention } from "./retention.ts";
import { type FetchedSleeper, fetchSleeper } from "./sleeper/fetcher.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import {
  FetchError,
  type FetchFix,
  listSnapshots,
  readSnapshot,
} from "./snapshot.ts";
import { triggerWinnerChanges } from "./stakes.ts";
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
  /** What reading the lore has to say, personal data included. */
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
      warnings,
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
    warnings: refreshed.warnings,
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
    const who = (teams: TeamId[]) =>
      teams.length === 0 ? "nobody" : list(teams.map((t) => names.get(t) ?? t));
    const each = changes.map(
      (c) => `${c.rule.name} in week ${c.week}, ${who(c.from)} → ${who(c.to)}`,
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
  try {
    const ws = await readWorkspace(workspaceDir);
    const { league } = await fetchFresh(ws, deps);
    const warning = dataChangedWarning(checked, league);
    return warning ? [warning] : [];
  } catch (err) {
    return [`couldn't check for data changes: ${(err as Error).message}`];
  }
}

/**
 * The workspace's latest season, fetched into memory: no snapshot yet. A
 * routine fetch unless `full`. Writing the snapshot applies retention.
 */
export async function fetchFresh(
  ws: Workspace,
  deps: Deps,
  opts: { full?: boolean } = {},
): Promise<FetchedSleeper> {
  const fetched = await fetchSleeper({
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
}

/**
 * `fetchFresh`, except that a failed or partial fetch continues from the last
 * complete snapshot: the season's newest, whose `write` writes nothing and
 * gives it back. With no snapshot to continue from, it stops with the fetch's
 * error, its message ending with the fix for what failed.
 */
export async function fetchOrContinue(
  ws: Workspace,
  deps: Deps,
  opts: { full?: boolean } = {},
): Promise<FetchedOrContinued> {
  try {
    return await fetchFresh(ws, deps, opts);
  } catch (err) {
    if (!(err instanceof FetchError)) throw err;
    const dir = snapshotsDir(ws);
    const last = (await listSnapshots(dir))
      .filter(
        ({ manifest: m }) =>
          m.platform === ws.season.platform &&
          m.league_id === ws.season.leagueId &&
          m.season === ws.season.year,
      )
      .at(-1);
    if (!last) {
      throw new FetchError(`${err.message}. ${FETCH_FIXES[err.fix].stopping}`, {
        cause: err,
        fix: err.fix,
      });
    }
    return {
      league: normalizeSleeper(await readSnapshot(dir, last.id)),
      write: async () => last,
      failedFetch: failedFetchItem(err, last.manifest.fetched_at),
    };
  }
}

const LEAGUE_ID_FIX =
  "The platform doesn't know this league: check league_id in workspace.md, or run lazy-pundit init for a new workspace.";
const UPDATE_FIX =
  "This version can't read what the platform answered: check for a newer Lazy Pundit.";

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
  };

/** The failed-fetch item: a soft league item with the fix for what failed. */
function failedFetchItem(err: FetchError, dataAsOf: string): Problem {
  return leagueItem(
    "failed-fetch",
    `couldn't fetch: ${err.message}. Continuing from the last complete snapshot, data as of ${dataAsOf}. ${FETCH_FIXES[err.fix].continuing}`,
  );
}
