import { type Config } from "./config.ts";
import type { Deps } from "./deps.ts";
import { type TranscriptPlace } from "./transcripts.ts";
/** Room for a league-week's blurbs and intro, with the model's thinking. */
export declare const MAX_TOKENS = 16000;
/**
 * The LLM stopped, or never ran, and the draft falls back. The message says
 * why, for the operator, without saying what the draft has instead.
 */
export declare class LlmStopped extends Error {
    name: string;
}
export interface CallSetup {
    deps: Deps;
    key: string;
    config: Config;
    /** Where each call's LLM transcript goes. */
    transcript: TranscriptPlace;
}
/**
 * The `ask` a draft hands the LLM gate: each call sends one prompt and
 * returns the reply's text. Before each call, a model with no price, or a
 * ceiling cost that would pass the spend cap, stops it unmade. After it, its
 * LLM transcript is written and its reported tokens are added to the month's
 * spend. A call that can't be made or fails throws `LlmStopped`.
 */
export declare function llmAsk({ deps, key, config, transcript, }: CallSetup): (system: string, prompt: string) => Promise<string>;
