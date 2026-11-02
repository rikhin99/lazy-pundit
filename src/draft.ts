import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { checkDraft, type Problem } from "./check.ts";
import {
  CONFIG_FORMAT,
  configSchema,
  loadCredentials,
  readConfig,
} from "./config.ts";
import { dataHash } from "./data-hash.ts";
import type { Deps } from "./deps.ts";
import { type DraftContext, draftContext } from "./draft-context.ts";
import { type DraftData, draftData } from "./draft-data.ts";
import type { League, TeamId } from "./league.ts";
import { FIRST_DRAFT_SYSTEM, firstDraftPrompt, readReply } from "./prompt.ts";
import { type DraftProse, renderDraft } from "./ranking-file.ts";
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
  /** Anything the operator should fix, such as a credentials file others can read. */
  warnings: string[];
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
  const data = draftData(league, week);
  const { anthropicApiKey, warnings } = await loadCredentials(deps);
  const prose = anthropicApiKey
    ? await llmProse(
        draftContext(league, data),
        data,
        anthropicApiKey.value,
        deps,
      )
    : statLines(data);
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
    prose,
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
  return { path, week, snapshot: id, problems, warnings };
}

/** Room for a league-week's blurbs and intro, with the model's thinking. */
const MAX_TOKENS = 16000;

/**
 * The LLM's first draft of the intro and every blurb, from the draft context
 * alone. A team or intro the reply leaves out keeps its stat line.
 */
async function llmProse(
  ctx: DraftContext,
  data: DraftData,
  key: string,
  deps: Deps,
): Promise<DraftProse> {
  const config =
    (await readConfig(deps)) ?? configSchema.parse({ format: CONFIG_FORMAT });
  const reply = await deps.llm.write({
    key,
    model: config.model,
    system: FIRST_DRAFT_SYSTEM,
    prompt: firstDraftPrompt(ctx),
    maxTokens: MAX_TOKENS,
  });
  const written = readReply(reply.text, ctx);
  const fallback = statLines(data);
  return {
    intro: written.intro ?? fallback.intro,
    blurbs: { ...fallback.blurbs, ...written.teams },
  };
}

/** A new draft's prose without an LLM: the league stat line and each team's stat line. */
function statLines(data: DraftData): DraftProse {
  return {
    intro: data.intro,
    blurbs: Object.fromEntries(
      Object.entries(data.teams).map(([id, t]) => [id, t.statLine]),
    ),
  };
}

/**
 * The tool's proposed order: the standings through the ranking week. The
 * power-score methods replace this later.
 */
function startingOrder(league: League, week: number): TeamId[] {
  return standingsThrough(league, week).map((s) => s.team);
}
