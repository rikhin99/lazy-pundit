import { isDeepStrictEqual } from "node:util";
import {
  type CheckedDraft,
  checkDraft,
  claimsGoingStale,
  type Problem,
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
}

/**
 * Refetches and, if the data changed, moves the latest draft onto a new
 * snapshot with a recomputed starting order. A changed method in the pundit
 * settings recomputes the order too, with no new snapshot if the data stands.
 * It never touches the pundit's order, blurbs, week or persona, and doesn't
 * auto-tag. With neither change it only updates `checked_at`. A failed fetch
 * or a bad settings file throws and changes nothing.
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
  const fresh = await fetchFresh(ws, deps, opts);
  const changes = diff(checked.league, fresh.league, meta.week);
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

  if (changes.length === 0) {
    let text = set(checked.text, "checked_at", now);
    if (methodChanged) {
      // On the draft's own league: fresh names or positions aren't a data
      // change, but a lineup's best points read them.
      text = setOrder(text, checked.league);
    }
    await writeWorkspaceFile(checked.path, text);
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
      problems,
      warnings,
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
    problems: refreshed.problems,
    warnings: refreshed.warnings,
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
  const { week, data_as_of } = checked.ranking.meta;
  if (diff(checked.league, fresh, week).length === 0) return undefined;
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
