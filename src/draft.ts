import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { checkDraft, type Problem } from "./check.ts";
import { dataHash } from "./data-hash.ts";
import type { Deps } from "./deps.ts";
import { draftData } from "./draft-data.ts";
import type { League, TeamId } from "./league.ts";
import { renderDraft } from "./ranking-file.ts";
import { fetchSleeperSnapshot } from "./sleeper/fetcher.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import { readSnapshot } from "./snapshot.ts";
import { standingsThrough } from "./standings.ts";
import {
  rankingsDir,
  readWorkspace,
  snapshotsDir,
  weekStem,
} from "./workspace.ts";
import { writeWorkspaceFile } from "./workspace-files.ts";

export interface DraftResult {
  /** The ranking file written. */
  path: string;
  /** The ranking week: the last scored week when the draft began. */
  week: number;
  /** The snapshot the draft was built from. */
  snapshot: string;
  /** The new draft's problems list, hard first. */
  problems: Problem[];
}

export class DraftExistsError extends Error {
  override name = "DraftExistsError";
}

/**
 * Fetches the workspace's latest season and writes a new draft for its
 * ranking week, starting in standings order, and checks it.
 */
export async function draft(
  workspaceDir: string,
  deps: Deps,
): Promise<DraftResult> {
  const ws = await readWorkspace(workspaceDir);
  const { id } = await fetchSleeperSnapshot({
    transport: deps.transport,
    clock: deps.clock,
    snapshotsDir: snapshotsDir(ws),
    cacheDir: deps.cacheDir,
    leagueId: ws.season.leagueId,
  });
  const snapshot = await readSnapshot(snapshotsDir(ws), id);
  const league = normalizeSleeper(snapshot);
  const week = league.lastScoredWeek;

  const dir = rankingsDir(ws);
  const path = join(dir, `${weekStem(week)}.md`);
  const order = startingOrder(league, week);
  const now = deps.clock.now().toISOString();
  const text = renderDraft(
    {
      season: Number(league.season),
      week,
      pundit: ws.pundit,
      data_as_of: snapshot.manifest.fetched_at,
      checked_at: now,
      snapshot: id,
      data_hash: dataHash(league, week),
      starting_order: order,
      created_at: now,
    },
    league,
    order,
    draftData(league, week),
  );
  await mkdir(dir, { recursive: true });
  try {
    await writeWorkspaceFile(path, text, { exclusive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    throw new DraftExistsError(
      `${weekStem(week)}.md already exists, so it was left as it is`,
    );
  }
  const { problems } = await checkDraft(workspaceDir);
  return { path, week, snapshot: id, problems };
}

/**
 * The tool's proposed order: the standings through the ranking week. The
 * power-score methods replace this later.
 */
function startingOrder(league: League, week: number): TeamId[] {
  return standingsThrough(league, week).map((s) => s.team);
}
