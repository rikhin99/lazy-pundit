import { LlmStopped } from "./llm-call.js";
import { FIRST_DRAFT_SYSTEM, firstDraftPrompt, readReply, rewritePrompt, } from "./prompt.js";
import { gateLlm, isHard, validate, } from "./validator.js";
/** How many times prose that fails the LLM gate goes back to the LLM. */
export const GATE_RETRIES = 2;
/**
 * The LLM's prose for a draft, through the LLM gate: the first draft writes
 * every section, and each retry asks only for the sections still failing,
 * with the validator's complaints. `names` holds lore's nicknames and section
 * names for the validator only; none of it is sent to the LLM. A section that never passes keeps its
 * best attempt. `ask` sends one prompt and returns the reply's text. When
 * `ask` throws `LlmStopped` on a retry, the gate stops there and keeps what
 * it has; on the first draft, it throws.
 */
export async function gatedProse(ctx, names, ask) {
    const first = readReply(await ask(FIRST_DRAFT_SYSTEM, firstDraftPrompt(ctx)), ctx);
    const written = { ...first, teams: { ...first.teams } };
    /** Sections still failing: their latest attempt, and their best. */
    const failing = new Map();
    for (const [key, text] of sectionsOf(first)) {
        const failed = gate(ctx, names, key, text);
        if (failed)
            failing.set(key, { latest: failed, best: failed });
    }
    let stopped;
    for (let retry = 1; retry <= GATE_RETRIES && failing.size > 0; retry++) {
        const asked = [...failing.values()].map((f) => f.latest);
        let text;
        try {
            text = await ask(FIRST_DRAFT_SYSTEM, rewritePrompt(ctx, asked));
        }
        catch (err) {
            if (!(err instanceof LlmStopped))
                throw err;
            stopped = { reason: err, replies: retry };
            break;
        }
        const reply = readReply(text, ctx);
        for (const [key, text] of sectionsOf(reply)) {
            const was = failing.get(key);
            if (!was)
                continue;
            const failed = gate(ctx, names, key, text);
            if (!failed) {
                failing.delete(key);
                setSection(written, key, text);
            }
            else {
                was.latest = failed;
                if (score(failed) < score(was.best))
                    was.best = failed;
            }
        }
    }
    const failed = [...failing.values()].map((f) => f.best);
    for (const f of failed)
        setSection(written, f.key, f.text);
    return { written, failed, ...(stopped && { stopped }) };
}
/** A section's faults, or undefined when it passes the gate. */
function gate(ctx, names, key, text) {
    const result = gateLlm(validate({
        text,
        team: key === "intro" ? null : key,
        evidence: ctx.evidence,
        // A first draft has no order to cite.
        order: {},
        ...names,
        swearing: ctx.persona.swearing,
    }));
    return result.pass
        ? undefined
        : {
            key,
            text,
            claims: result.claims,
            swears: result.swears,
            stakesMentions: result.stakesMentions,
        };
}
/** Fewer hard faults is better, then fewer faults in all. */
function score(f) {
    const hard = f.claims.filter((c) => isHard(c.status)).length + f.stakesMentions.length;
    return hard * 1000 + f.claims.length + f.swears.length;
}
function sectionsOf(prose) {
    return [
        ...(prose.intro !== undefined
            ? [["intro", prose.intro]]
            : []),
        ...Object.entries(prose.teams),
    ];
}
function setSection(prose, key, text) {
    if (key === "intro")
        prose.intro = text;
    else
        prose.teams[key] = text;
}
//# sourceMappingURL=llm-gate.js.map