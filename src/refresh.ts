import {
  type CheckedDraft,
  checkDraft,
  claimsGoingStale,
  type Problem,
} from "./check.ts";
import { type DataChange, diff } from "./data-diff.ts";
import { dataHash } from "./data-hash.ts";
import type { Deps } from "./deps.ts";
import { setFrontMatterValue } from "./front-matter.ts";
import type { League } from "./league.ts";
import { validatorNames } from "./lore.ts";
import { type FetchedSleeper, fetchSleeper } from "./sleeper/fetcher.ts";
import { startingOrder } from "./standings.ts";
import { readWorkspace, snapshotsDir, type Workspace } from "./workspace.ts";
import { writeWorkspaceFile } from "./workspace-files.ts";

export interface RefreshResult {
  week: number;
  /** The draft refreshed. */
  path: string;
  /** The data changes found; none means only `checked_at` moved. */
  changes: DataChange[];
  /** The draft's data as of before this refresh. */
  dataAsOf: string;
  /** The snapshot the draft stands on now. */
  snapshot: string;
  /** The claims this refresh made stale. */
  newlyStale: Problem[];
  /** The whole problems list, hard first, moved teams against the new starting order. */
  problems: Problem[];
}

/**
 * Refetches and, if the data changed, moves the latest draft onto a new
 * snapshot with a recomputed starting order. It never touches the pundit's
 * order, blurbs, week or persona, and doesn't auto-tag. With no data change
 * it only updates `checked_at`. A failed fetch throws and changes nothing.
 */
export async function refresh(
  workspaceDir: string,
  deps: Deps,
): Promise<RefreshResult> {
  const checked = await checkDraft(workspaceDir, { autoTag: false });
  const { meta } = checked.ranking;
  const fresh = await fetchFresh(await readWorkspace(workspaceDir), deps);
  const changes = diff(checked.league, fresh.league, meta.week);
  const now = deps.clock.now().toISOString();
  const name = `${checked.stem}.md`;
  const set = (text: string, key: string, value: string | string[]) =>
    setFrontMatterValue(name, text, key, value);

  if (changes.length === 0) {
    await writeWorkspaceFile(
      checked.path,
      set(checked.text, "checked_at", now),
    );
    return {
      week: checked.week,
      path: checked.path,
      changes,
      dataAsOf: meta.data_as_of,
      snapshot: meta.snapshot,
      newlyStale: [],
      problems: checked.problems,
    };
  }

  // Before anything's written: a nickname that clashes with the fresh names
  // would otherwise stop the check below, leaving the draft half refreshed.
  validatorNames(checked.lore, fresh.league, checked.handles);
  const { id, manifest } = await fresh.write();
  let text = checked.text;
  text = set(text, "checked_at", now);
  text = set(text, "data_as_of", manifest.fetched_at);
  text = set(text, "snapshot", id);
  text = set(text, "data_hash", dataHash(fresh.league, meta.week));
  text = set(text, "starting_order", startingOrder(fresh.league, meta.week));
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
    dataAsOf: meta.data_as_of,
    snapshot: id,
    // Measured on the new text, so its lines match the problems list.
    newlyStale: claimsGoingStale(refreshed, checked.league, fresh.league),
    problems: refreshed.problems,
  };
}

/**
 * The data-changed warning for a checked draft against freshly fetched data,
 * or none when the data through the draft's week is the same.
 */
export function dataChangedWarning(
  checked: CheckedDraft,
  fresh: League,
): string | undefined {
  const { week, data_as_of } = checked.ranking.meta;
  if (diff(checked.league, fresh, week).length === 0) return undefined;
  const stale = claimsGoingStale(checked, checked.league, fresh).length;
  const claims = stale === 1 ? "1 claim" : `${stale} claims`;
  return `data changed since ${data_as_of}: ${claims} would go stale, run \`refresh\``;
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

/** The workspace's latest season, fetched into memory: no snapshot yet. */
export function fetchFresh(ws: Workspace, deps: Deps): Promise<FetchedSleeper> {
  return fetchSleeper({
    transport: deps.transport,
    clock: deps.clock,
    snapshotsDir: snapshotsDir(ws),
    cacheDir: deps.cacheDir,
    leagueId: ws.season.leagueId,
  });
}
