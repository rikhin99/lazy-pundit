import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { checkDraft, type Problem, withGateFailures } from "./check.ts";
import {
  CONFIG_FORMAT,
  type Config,
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
import { loadLeagueFile } from "./league-file.ts";
import { type CallSetup, LlmStopped, llmAsk, MAX_TOKENS } from "./llm-call.ts";
import {
  type FailedSection,
  GATE_RETRIES,
  type GatedProse,
  gatedProse,
} from "./llm-gate.ts";
import {
  loadLore,
  refuseLocal,
  sentLore,
  type ValidatorNames,
  validatorNames,
} from "./lore.ts";
import { loadPersona, type Persona, personaRecord } from "./persona.ts";
import { startingOrder } from "./power-score.ts";
import {
  ceilingCost,
  costOf,
  estimatedTokens,
  priceOf,
  usd,
} from "./prices.ts";
import { FIRST_DRAFT_SYSTEM, firstDraftPrompt, loreBlock } from "./prompt.ts";
import { loadPunditSettings, methodForWeek } from "./pundit-settings.ts";
import { type DraftProse, lastPublished, renderDraft } from "./ranking-file.ts";
import { dataChangedWarning, fetchFresh } from "./refresh.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import { readSnapshot } from "./snapshot.ts";
import {
  changedOutcomeWarnings,
  houseRuleOutcomes,
  stakesWarnings,
} from "./stakes.ts";
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

export interface DraftOptions {
  /**
   * Told each warning as it arises, so that one about what the LLM is to be
   * sent is seen before the call.
   */
  onWarnings?: (warnings: string[]) => void;
}

export class DraftExistsError extends Error {
  override name = "DraftExistsError";
}

/**
 * Fetches the workspace's latest season and writes a new draft for its
 * ranking week, starting in the order the pundit's settings give, and checks it.
 */
export async function draft(
  workspaceDir: string,
  deps: Deps,
  opts: DraftOptions = {},
): Promise<DraftResult> {
  const warnings: string[] = [];
  const warn = (more: string[]) => {
    warnings.push(...more);
    if (more.length > 0) opts.onWarnings?.(more);
  };
  const ws = await readWorkspace(workspaceDir);
  const lore = await loadLore(ws);
  refuseLocal(lore);
  warn(lore.warnings);
  // Before the fetch, so a malformed league.md costs nothing.
  const { stakes } = await loadLeagueFile(ws);
  const settings = await loadPunditSettings(ws);
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
  const method = methodForWeek(settings, league, week);
  const order = startingOrder(league, week, method);
  const data = draftData(league, week, stakes);
  const earlier = await lastPublished(dir, week);
  warn([
    ...stakesWarnings(stakes, league),
    ...changedOutcomeWarnings(
      stakes,
      earlier?.ranking.meta.house_rule_outcomes,
      earlier?.week ?? 0,
    ),
  ]);
  const outcomes = houseRuleOutcomes(stakes);
  const { anthropicApiKey, warnings: credentialWarnings } =
    await loadCredentials(deps);
  const { persona, warnings: personaWarnings } = await loadPersona(
    ws,
    league,
    lore,
  );
  warn([...credentialWarnings, ...personaWarnings]);
  const began = deps.clock.now();
  let outcome: ProseOutcome;
  if (anthropicApiKey) {
    const sent = sentLore(lore, league, ws.handles);
    const ctx = draftContext(
      league,
      data,
      persona,
      sent.lore,
      await lastBlurbs(dir, week),
    );
    const config =
      (await readConfig(deps)) ?? configSchema.parse({ format: CONFIG_FORMAT });
    warn([...sent.warnings, ...loreSizeWarning(ctx, config)]);
    // The LLM may cite only what it was sent; a pundit may cite any section.
    const gateNames: ValidatorNames = {
      ...names,
      sections: {
        ...names.sections,
        lore: sent.lore.sections.map((s) => s.name),
      },
    };
    outcome = await llmProse(ctx, gateNames, data, {
      deps,
      config,
      key: anthropicApiKey.value,
      transcript: { ws, week, at: began },
    });
  } else {
    outcome = {
      prose: statLines(data, persona),
      failed: [],
      fallback: `No Anthropic key, so the LLM didn't run: set ANTHROPIC_API_KEY, or add anthropic_api_key to ${credentialsPath(deps)}${STAT_LINES}`,
    };
  }
  const { prose, failed, fallback } = outcome;
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
      power_score: method,
      persona: personaRecord(persona),
      ...(outcomes && { house_rule_outcomes: outcomes }),
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
  // The gate knows what was sent and `check` doesn't, so `check` passes these.
  warn(
    failed
      .flatMap((f) => f.claims)
      .filter(
        (c) =>
          c.status === "unknown-id" &&
          !checked.problems.some((p) => p.text === c.text),
      )
      .map(
        (c) =>
          `The LLM cited lore it wasn't sent, so it may have made this up: "${c.text}".`,
      ),
  );
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

/** Lore's size, in the tokens `ceilingCost` counts, past which a draft warns. */
const LORE_TOKENS_WARNED = 2000;

/**
 * The warning for lore past about 2,000 tokens: what it sends, and the most a
 * draft is estimated to cost against the spend cap. Every call, the retries'
 * too, repeats the lore.
 */
function loreSizeWarning(ctx: DraftContext, config: Config): string[] {
  const tokens = estimatedTokens(loreBlock(ctx));
  if (tokens <= LORE_TOKENS_WARNED) return [];
  const size = `lore.md sends about ${tokens.toLocaleString("en-US")} tokens with every LLM call.`;
  const price = priceOf(config);
  if (!price) return [size];
  const calls = 1 + GATE_RETRIES;
  const draftCost =
    calls *
    ceilingCost(price, {
      system: FIRST_DRAFT_SYSTEM,
      prompt: firstDraftPrompt(ctx),
      maxTokens: MAX_TOKENS,
    });
  const loreCost =
    calls * costOf(price, { inputTokens: tokens, outputTokens: 0 });
  return [
    `${size} A draft is estimated at up to ${usd(draftCost)} (${calls} calls at most), ${usd(loreCost)} of it for lore, against your ${usd(config.spend_cap_usd)} spend cap.`,
  ];
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
  setup: CallSetup,
): Promise<ProseOutcome> {
  const lines = statLines(data, ctx.persona);
  let gated: GatedProse;
  try {
    gated = await gatedProse(ctx, names, llmAsk(setup));
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
