import type { DraftContext } from "./draft-context.ts";
import type { TeamId } from "./league.ts";
import { LlmStopped } from "./llm-call.ts";
import {
  FIRST_DRAFT_SYSTEM,
  firstDraftPrompt,
  readReply,
  rewritePrompt,
  type WrittenProse,
} from "./prompt.ts";
import {
  type CheckedClaim,
  gateLlm,
  isHard,
  type Swear,
  validate,
} from "./validator.ts";

/** How many times prose that fails the LLM gate goes back to the LLM. */
export const GATE_RETRIES = 2;

/** One section of LLM prose: the week intro or a team's blurb. */
export type SectionKey = "intro" | TeamId;

/** What the LLM gate found wrong with a section's text. */
export interface GateFaults {
  /** Every claim that isn't tagged and verified. */
  claims: CheckedClaim[];
  /** Word-list hits, when swearing is off. */
  swears: Swear[];
}

/** A section that failed the gate: its text and the faults found in it. */
export interface FailedSection extends GateFaults {
  key: SectionKey;
  text: string;
}

export interface GatedProse {
  written: WrittenProse;
  /** Each section written as its best attempt, never having passed. */
  failed: FailedSection[];
  /** Why a retry was stopped, and how many replies came before it. */
  stopped?: { reason: LlmStopped; replies: number };
}

/**
 * The LLM's prose for a draft, through the LLM gate: the first draft writes
 * every section, and each retry asks only for the sections still failing,
 * with the validator's complaints. A section that never passes keeps its
 * best attempt. `ask` sends one prompt and returns the reply's text. When
 * `ask` throws `LlmStopped` on a retry, the gate stops there and keeps what
 * it has; on the first draft, it throws.
 */
export async function gatedProse(
  ctx: DraftContext,
  ask: (system: string, prompt: string) => Promise<string>,
): Promise<GatedProse> {
  const first = readReply(
    await ask(FIRST_DRAFT_SYSTEM, firstDraftPrompt(ctx)),
    ctx,
  );
  const written: WrittenProse = { ...first, teams: { ...first.teams } };
  /** Sections still failing: their latest attempt, and their best. */
  const failing = new Map<
    SectionKey,
    { latest: FailedSection; best: FailedSection }
  >();
  for (const [key, text] of sectionsOf(first)) {
    const failed = gate(ctx, key, text);
    if (failed) failing.set(key, { latest: failed, best: failed });
  }

  let stopped: GatedProse["stopped"];
  for (let retry = 1; retry <= GATE_RETRIES && failing.size > 0; retry++) {
    const asked = [...failing.values()].map((f) => f.latest);
    let text: string;
    try {
      text = await ask(FIRST_DRAFT_SYSTEM, rewritePrompt(ctx, asked));
    } catch (err) {
      if (!(err instanceof LlmStopped)) throw err;
      stopped = { reason: err, replies: retry };
      break;
    }
    const reply = readReply(text, ctx);
    for (const [key, text] of sectionsOf(reply)) {
      const was = failing.get(key);
      if (!was) continue;
      const failed = gate(ctx, key, text);
      if (!failed) {
        failing.delete(key);
        setSection(written, key, text);
      } else {
        was.latest = failed;
        if (score(failed) < score(was.best)) was.best = failed;
      }
    }
  }

  const failed = [...failing.values()].map((f) => f.best);
  for (const f of failed) setSection(written, f.key, f.text);
  return { written, failed, ...(stopped && { stopped }) };
}

/** A section's faults, or undefined when it passes the gate. */
function gate(
  ctx: DraftContext,
  key: SectionKey,
  text: string,
): FailedSection | undefined {
  const result = gateLlm(
    validate({
      text,
      team: key === "intro" ? null : key,
      evidence: ctx.evidence,
      // A first draft has no order to cite.
      order: {},
      nicknames: Object.fromEntries(
        ctx.teams.map((t) => [t.id, [t.name, ...t.managers]]),
      ),
      sections: { lore: [], stakes: [], log: [] },
      swearing: ctx.persona.swearing,
    }),
  );
  return result.pass
    ? undefined
    : { key, text, claims: result.claims, swears: result.swears };
}

/** Fewer hard faults is better, then fewer faults in all. */
function score(f: GateFaults): number {
  const hard = f.claims.filter((c) => isHard(c.status)).length;
  return hard * 1000 + f.claims.length + f.swears.length;
}

function sectionsOf(prose: WrittenProse): [SectionKey, string][] {
  return [
    ...(prose.intro !== undefined
      ? [["intro", prose.intro] as [SectionKey, string]]
      : []),
    ...(Object.entries(prose.teams) as [TeamId, string][]),
  ];
}

function setSection(prose: WrittenProse, key: SectionKey, text: string): void {
  if (key === "intro") prose.intro = text;
  else prose.teams[key] = text;
}
