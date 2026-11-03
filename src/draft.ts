import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { checkDraft, type Problem, withGateFailures } from "./check.ts";
import {
  CONFIG_FORMAT,
  configSchema,
  credentialsPath,
  loadCredentials,
  readConfig,
} from "./config.ts";
import { dataHash } from "./data-hash.ts";
import type { Deps } from "./deps.ts";
import {
  type DraftContext,
  draftContext,
  type LastBlurbs,
} from "./draft-context.ts";
import { type DraftData, draftData } from "./draft-data.ts";
import type { League } from "./league.ts";
import { type CallSetup, LlmStopped, llmAsk } from "./llm-call.ts";
import { type FailedSection, type GatedProse, gatedProse } from "./llm-gate.ts";
import {
  loadLore,
  refuseLocal,
  type ValidatorNames,
  validatorNames,
} from "./lore.ts";
import { loadPersona, type Persona, personaRecord } from "./persona.ts";
import { type DraftProse, lastPublished, renderDraft } from "./ranking-file.ts";
import { dataChangedWarning, fetchFresh } from "./refresh.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import { readSnapshot } from "./snapshot.ts";
import { startingOrder } from "./standings.ts";
import { stripTags } from "./validator.ts";
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
  /** Why the LLM didn't run or stopped partway, and what the draft has instead. */
  fallback?: string;
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
  const lore = await loadLore(ws);
  refuseLocal(lore);
  const fetched = await fetchFresh(ws, deps);
  const names = validatorNames(lore, fetched.league, ws.handles);
  const week = fetched.league.lastScoredWeek;
  const dir = rankingsDir(ws);
  const path = join(dir, `${weekStem(week)}.md`);
  // Before the snapshot and the LLM call: a draft in the way needs neither.
  if (
    await access(path).then(
      () => true,
      () => false,
    )
  ) {
    throw await draftExists(workspaceDir, week, fetched.league);
  }

  const { id } = await fetched.write();
  const snapshot = await readSnapshot(snapshotsDir(ws), id);
  const league = normalizeSleeper(snapshot);
  const order = startingOrder(league, week);
  const data = draftData(league, week);
  const { anthropicApiKey, warnings: credentialWarnings } =
    await loadCredentials(deps);
  const { persona, warnings: personaWarnings } = await loadPersona(ws, league);
  const warnings = [...credentialWarnings, ...personaWarnings];
  const began = deps.clock.now();
  const { prose, failed, fallback } = anthropicApiKey
    ? await llmProse(
        draftContext(league, data, persona, await lastBlurbs(dir, week)),
        names,
        data,
        {
          deps,
          key: anthropicApiKey.value,
          transcript: { ws, week, at: began },
        },
      )
    : {
        prose: statLines(data, persona),
        failed: [],
        fallback: `No Anthropic key, so the LLM didn't run: set ANTHROPIC_API_KEY, or add anthropic_api_key to ${credentialsPath(deps)}${STAT_LINES}`,
      };
  const now = began.toISOString();
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
      persona: personaRecord(persona),
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
    throw await draftExists(workspaceDir, week, league);
  }
  const checked = await checkDraft(workspaceDir);
  const problems = withGateFailures(checked, failed);
  return {
    path,
    week,
    snapshot: id,
    problems,
    warnings,
    ...(fallback && { fallback }),
  };
}

/**
 * The error for a draft in the way, with the data-changed warning when the
 * draft can be compared. One that can't still gets the plain message.
 */
async function draftExists(
  workspaceDir: string,
  week: number,
  fresh: League,
): Promise<DraftExistsError> {
  const message = `${weekStem(week)}.md already exists, so it was left as it is`;
  try {
    const checked = await checkDraft(workspaceDir, { autoTag: false });
    const warning = dataChangedWarning(checked, fresh);
    return new DraftExistsError(warning ? `${message}. ${warning}` : message);
  } catch {
    return new DraftExistsError(message);
  }
}

/**
 * Each team's blurb in the season's last published ranking before `week`,
 * tags stripped. None before the first publish.
 */
async function lastBlurbs(
  dir: string,
  week: number,
): Promise<LastBlurbs | undefined> {
  const last = await lastPublished(dir, week);
  if (!last) return undefined;
  return {
    week: last.week,
    blurbs: Object.fromEntries(
      last.ranking.entries.flatMap((e) =>
        e.kind === "team" && e.blurb ? [[e.team, stripTags(e.blurb)]] : [],
      ),
    ),
  };
}

/** The end of a fallback reason when the LLM never replied. */
const STAT_LINES = "; the draft has stat lines.";

/** A new draft's prose, its gate failures and any fallback reason. */
interface ProseOutcome {
  prose: DraftProse;
  failed: FailedSection[];
  /** The fallback reason, when the LLM didn't run or stopped partway. */
  fallback?: string;
}

/**
 * The LLM's intro and blurbs through the LLM gate, from the draft context
 * alone. A team or intro the first reply leaves out keeps its stat line, and
 * an LLM that stops before its first reply leaves every stat line.
 */
async function llmProse(
  ctx: DraftContext,
  names: ValidatorNames,
  data: DraftData,
  setup: Omit<CallSetup, "config">,
): Promise<ProseOutcome> {
  const config =
    (await readConfig(setup.deps)) ??
    configSchema.parse({ format: CONFIG_FORMAT });
  const lines = statLines(data, ctx.persona);
  let gated: GatedProse;
  try {
    gated = await gatedProse(ctx, names, llmAsk({ ...setup, config }));
  } catch (err) {
    if (!(err instanceof LlmStopped)) throw err;
    return {
      prose: lines,
      failed: [],
      fallback: `${err.message}${STAT_LINES}`,
    };
  }
  const { written, failed, stopped } = gated;
  return {
    prose: {
      intro: written.intro ?? lines.intro,
      blurbs: { ...lines.blurbs, ...written.teams },
    },
    failed,
    ...(stopped && {
      fallback: `${stopped.reason.message}; the LLM gate stopped after ${stopped.replies} repl${stopped.replies === 1 ? "y" : "ies"}, so the draft has the LLM's prose so far, each failing section at its best attempt.`,
    }),
  };
}

/**
 * A new draft's prose without an LLM: the league stat line (unless the
 * persona turns the week intro off) and each team's stat line.
 */
function statLines(data: DraftData, persona: Persona): DraftProse {
  return {
    intro: persona.intro ? data.intro : "",
    blurbs: Object.fromEntries(
      Object.entries(data.teams).map(([id, t]) => [id, t.statLine]),
    ),
  };
}
