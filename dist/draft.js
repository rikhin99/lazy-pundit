import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { checkDraft, withGateFailures, withLeagueItem, } from "./check.js";
import { CONFIG_FORMAT, configSchema, credentialsPath, loadCredentials, readConfig, } from "./config.js";
import { dataHash } from "./data-hash.js";
import { draftContext, } from "./draft-context.js";
import { draftData } from "./draft-data.js";
import { loadLeagueFile } from "./league-file.js";
import { LlmStopped, llmAsk, MAX_TOKENS } from "./llm-call.js";
import { GATE_RETRIES, gatedProse, } from "./llm-gate.js";
import { renderLlmProseFile } from "./llm-prose-file.js";
import { loadLore, refuseLocal, sentLore, validatorNames, } from "./lore.js";
import { loadPersona, personaRecord } from "./persona.js";
import { startingOrder } from "./power-score.js";
import { ceilingCost, costOf, estimatedTokens, priceOf, usd, } from "./prices.js";
import { FIRST_DRAFT_SYSTEM, firstDraftPrompt, loreBlock } from "./prompt.js";
import { loadPunditSettings, methodForWeek } from "./pundit-settings.js";
import { lastPublished, lastPublishedMeta, renderDraft, } from "./ranking-file.js";
import { dataChangedWarning, fetchOrContinue } from "./refresh.js";
import { normalizeSleeper } from "./sleeper/normalizer.js";
import { readSnapshot } from "./snapshot.js";
import { houseRuleOutcomes, leagueFileChangeWarnings, sentStakes, stakesSectionNames, stakesWarnings, } from "./stakes.js";
import { stripTags } from "./validator.js";
import { rankingsDir, readWorkspace, snapshotsDir, weekStem, } from "./workspace.js";
import { writeWorkspaceFile } from "./workspace-files.js";
export class DraftExistsError extends Error {
    name = "DraftExistsError";
}
/**
 * Fetches the workspace's latest season and writes a new draft for its
 * ranking week, starting in the order the pundit's settings give, and checks it.
 */
export async function draft(workspaceDir, deps, opts = {}) {
    const warnings = [];
    const warn = (more) => {
        warnings.push(...more);
        if (more.length > 0)
            opts.onWarnings?.(more);
    };
    const ws = await readWorkspace(workspaceDir);
    const lore = await loadLore(ws);
    refuseLocal(lore);
    warn(lore.warnings);
    // Before the fetch, so a malformed league.md costs nothing.
    const { stakes, warnings: leagueFileWarnings } = await loadLeagueFile(ws);
    warn(leagueFileWarnings);
    const settings = await loadPunditSettings(ws);
    const fetched = await fetchOrContinue(ws, deps);
    const names = validatorNames(lore, fetched.league, ws.handles, stakes);
    const week = fetched.league.lastScoredWeek;
    const dir = rankingsDir(ws);
    const path = join(dir, `${weekStem(week)}.md`);
    // Before the snapshot, the LLM call and a draft in the way, which would
    // hide it: an earlier frozen copy that can't be read stops the draft here.
    await lastPublished(dir, week);
    // Before the snapshot and the LLM call: a draft in the way needs neither.
    if (await access(path).then(() => true, () => false)) {
        throw await draftExists(workspaceDir, week, fetched.league, warn);
    }
    const { id } = await fetched.write();
    const snapshot = await readSnapshot(snapshotsDir(ws), id);
    const league = normalizeSleeper(snapshot);
    const method = methodForWeek(settings, league, week);
    const order = startingOrder(league, week, method);
    const inProgress = league.weeks.find((w) => !w.scored && w.week > week)?.week;
    const included = opts.includeInProgress ? inProgress : undefined;
    if (inProgress !== undefined) {
        warn([
            included
                ? `week ${inProgress} is in progress: its stats are in this week ${week} draft, and every claim citing them is provisional`
                : `week ${inProgress} is in progress, so this is a week ${week} draft without it; \`--include-in-progress\` adds it as provisional`,
        ]);
    }
    const data = draftData(league, week, stakes, included);
    warn([
        ...stakesWarnings(stakes, league),
        // As check does: against the newest frozen copy through this week.
        ...leagueFileChangeWarnings(stakes, await lastPublishedMeta(dir, week)),
    ]);
    const outcomes = houseRuleOutcomes(stakes);
    const { anthropicApiKey, warnings: credentialWarnings } = await loadCredentials(deps);
    const { persona, warnings: personaWarnings } = await loadPersona(ws, league, lore);
    warn([...credentialWarnings, ...personaWarnings]);
    const began = deps.clock.now();
    let outcome;
    if (anthropicApiKey) {
        const sent = sentLore(lore, league, ws.handles);
        const stakesSent = sentStakes(stakes, league, week);
        const ctx = draftContext(league, data, persona, sent.lore, stakesSent, await lastBlurbs(dir, week));
        const config = (await readConfig(deps)) ?? configSchema.parse({ format: CONFIG_FORMAT });
        warn([...sent.warnings, ...loreSizeWarning(ctx, config)]);
        // The LLM may cite only what it was sent; a pundit may cite any section.
        const gateNames = {
            ...names,
            sections: {
                ...names.sections,
                lore: sent.lore.sections.map((s) => s.name),
                log: stakesSectionNames(stakesSent).log,
            },
        };
        outcome = await llmProse(ctx, gateNames, data, {
            deps,
            config,
            key: anthropicApiKey.value,
            transcript: { ws, week, at: began },
        });
    }
    else {
        outcome = {
            prose: statLines(data, persona),
            failed: [],
            fallback: `No Anthropic key, so the LLM didn't run: set ANTHROPIC_API_KEY, or add anthropic_api_key to ${credentialsPath(deps)}${STAT_LINES}`,
        };
    }
    const { prose, failed, fallback, llm } = outcome;
    const now = began.toISOString();
    const text = renderDraft({
        season: Number(league.season),
        week,
        ...(included && { in_progress_week: included }),
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
    }, league, order, prose);
    await mkdir(dir, { recursive: true });
    try {
        await writeWorkspaceFile(path, text, { exclusive: true });
    }
    catch (err) {
        if (err.code !== "EEXIST")
            throw err;
        throw await draftExists(workspaceDir, week, league, warn);
    }
    // One left by a deleted draft of the week would otherwise stand in for this one's.
    const llmPath = join(dir, `${weekStem(week)}.llm.md`);
    if (llm && (llm.intro || Object.keys(llm.blurbs).length > 0)) {
        await writeWorkspaceFile(llmPath, renderLlmProseFile({ season: Number(league.season), week, created_at: now }, league, llm));
    }
    else {
        await rm(llmPath, { force: true });
    }
    const checked = await checkDraft(workspaceDir);
    const problems = withLeagueItem(withGateFailures(checked, failed), fetched.failedFetch);
    // The gate knows what was sent and `check` doesn't, so `check` passes these.
    warn(failed
        .flatMap((f) => f.claims)
        .filter((c) => c.status === "unknown-id" &&
        !checked.problems.some((p) => p.text === c.text))
        .map((c) => `The LLM cited lore or stakes it wasn't sent, so it may have made this up: "${c.text}".`));
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
async function draftExists(workspaceDir, week, fresh, warn) {
    const message = `${weekStem(week)}.md already exists, so it was left as it is`;
    try {
        const checked = await checkDraft(workspaceDir, { autoTag: false });
        // The draft in the way may stand on names that clash with lore's.
        warn(checked.clashWarnings);
        const warning = dataChangedWarning(checked, fresh);
        return new DraftExistsError(warning ? `${message}. ${warning}` : message);
    }
    catch {
        return new DraftExistsError(message);
    }
}
/**
 * Each team's blurb in the season's last published ranking before `week`,
 * tags stripped. None before the first publish.
 */
async function lastBlurbs(dir, week) {
    const last = await lastPublished(dir, week);
    if (!last)
        return undefined;
    return {
        week: last.week,
        blurbs: Object.fromEntries(last.ranking.entries.flatMap((e) => e.kind === "team" && e.blurb ? [[e.team, stripTags(e.blurb)]] : [])),
    };
}
/** The end of a fallback reason when the LLM never replied. */
const STAT_LINES = "; the draft has stat lines.";
/** Lore's size, in the tokens `ceilingCost` counts, past which a draft warns. */
const LORE_TOKENS_WARNED = 2000;
/**
 * The warning for lore past about 2,000 tokens: what it sends, and the most a
 * draft is estimated to cost against the spend cap. Every call, the retries'
 * too, repeats the lore.
 */
function loreSizeWarning(ctx, config) {
    const tokens = estimatedTokens(loreBlock(ctx));
    if (tokens <= LORE_TOKENS_WARNED)
        return [];
    const size = `lore.md sends about ${tokens.toLocaleString("en-US")} tokens with every LLM call.`;
    const price = priceOf(config);
    if (!price)
        return [size];
    const calls = 1 + GATE_RETRIES;
    const draftCost = calls *
        ceilingCost(price, {
            system: FIRST_DRAFT_SYSTEM,
            prompt: firstDraftPrompt(ctx),
            maxTokens: MAX_TOKENS,
        });
    const loreCost = calls * costOf(price, { inputTokens: tokens, outputTokens: 0 });
    return [
        `${size} A draft is estimated at up to ${usd(draftCost)} (${calls} calls at most), ${usd(loreCost)} of it for lore, against your ${usd(config.spend_cap_usd)} spend cap.`,
    ];
}
/**
 * The LLM's intro and blurbs through the LLM gate, from the draft context
 * alone. A team or intro the first reply leaves out keeps its stat line, and
 * an LLM that stops before its first reply leaves every stat line.
 */
async function llmProse(ctx, names, data, setup) {
    const lines = statLines(data, ctx.persona);
    let gated;
    try {
        gated = await gatedProse(ctx, names, llmAsk(setup));
    }
    catch (err) {
        if (!(err instanceof LlmStopped))
            throw err;
        return {
            prose: lines,
            failed: [],
            fallback: `${err.message}${STAT_LINES}`,
        };
    }
    const { written, failed, stopped } = gated;
    return {
        llm: { intro: written.intro ?? "", blurbs: written.teams },
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
function statLines(data, persona) {
    return {
        intro: persona.intro ? data.intro : "",
        blurbs: Object.fromEntries(Object.entries(data.teams).map(([id, t]) => [id, t.statLine])),
    };
}
//# sourceMappingURL=draft.js.map