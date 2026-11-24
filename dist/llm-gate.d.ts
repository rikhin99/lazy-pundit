import type { DraftContext } from "./draft-context.ts";
import type { TeamId } from "./league.ts";
import { LlmStopped } from "./llm-call.ts";
import type { ValidatorNames } from "./lore.ts";
import { type WrittenProse } from "./prompt.ts";
import { type CheckedClaim, type Swear } from "./validator.ts";
/** How many times prose that fails the LLM gate goes back to the LLM. */
export declare const GATE_RETRIES = 2;
/** One section of LLM prose: the week intro or a team's blurb. */
export type SectionKey = "intro" | TeamId;
/** What the LLM gate found wrong with a section's text. */
export interface GateFaults {
    /** Every claim that isn't tagged and verified. */
    claims: CheckedClaim[];
    /** Word-list hits, when swearing is off. */
    swears: Swear[];
    /** Under `stakes: none`, each mention of money, a prize or a punishment. */
    stakesMentions: Swear[];
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
    stopped?: {
        reason: LlmStopped;
        replies: number;
    };
}
/**
 * The LLM's prose for a draft, through the LLM gate: the first draft writes
 * every section, and each retry asks only for the sections still failing,
 * with the validator's complaints. `names` holds lore's nicknames and section
 * names for the validator only; none of it is sent to the LLM. A section that never passes keeps its
 * best attempt. `ask` sends one prompt and returns the reply's text. When
 * `ask` throws `LlmStopped` on a retry, the gate stops there and keeps what
 * it has; on the first draft, it throws.
 */
export declare function gatedProse(ctx: DraftContext, names: ValidatorNames, ask: (system: string, prompt: string) => Promise<string>): Promise<GatedProse>;
