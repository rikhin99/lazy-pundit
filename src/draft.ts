import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import type { League, TeamId } from "./league.ts";
import { renderDraft } from "./ranking-file.ts";
import { fetchSleeperSnapshot } from "./sleeper/fetcher.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import { readSnapshot } from "./snapshot.ts";
import {
  rankingsDir,
  readWorkspace,
  snapshotsDir,
  weekStem,
} from "./workspace.ts";

export interface DraftResult {
  /** The ranking file written. */
  path: string;
  /** The ranking week: the last scored week when the draft began. */
  week: number;
  /** The snapshot the draft was built from. */
  snapshot: string;
}

export class DraftExistsError extends Error {
  override name = "DraftExistsError";
}

/**
 * Fetches the workspace's latest season and writes a new draft for its
 * ranking week, starting in standings order.
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
    leagueId: ws.season.leagueId,
  });
  const snapshot = await readSnapshot(snapshotsDir(ws), id);
  const league = normalizeSleeper(snapshot);
  const week = league.lastScoredWeek;

  const dir = rankingsDir(ws);
  const path = join(dir, `${weekStem(week)}.md`);
  const order = startingOrder(league);
  const now = deps.clock.now().toISOString();
  const text = renderDraft(
    {
      season: Number(league.season),
      week,
      pundit: ws.pundit,
      data_as_of: snapshot.manifest.fetched_at,
      checked_at: now,
      snapshot: id,
      starting_order: order,
      created_at: now,
    },
    league,
    order,
  );
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path, text, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    throw new DraftExistsError(
      `${weekStem(week)}.md already exists, so it was left as it is`,
    );
  }
  return { path, week, snapshot: id };
}

/**
 * The tool's proposed order: by standings (wins, ties as half, then points
 * for). The power-score methods replace this later.
 */
function startingOrder(league: League): TeamId[] {
  const winValue = (t: League["teams"][number]) =>
    t.standing.wins + t.standing.ties / 2;
  return [...league.teams]
    .sort(
      (a, b) =>
        winValue(b) - winValue(a) ||
        b.standing.pointsFor - a.standing.pointsFor ||
        a.id.localeCompare(b.id, "en", { numeric: true }),
    )
    .map((t) => t.id);
}
