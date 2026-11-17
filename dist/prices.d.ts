import type { LlmReply, LlmRequest } from "./anthropic.ts";
import type { Config } from "./config.ts";
/** A model's price per million tokens, in US dollars. */
export interface Price {
    input_per_mtok: number;
    output_per_mtok: number;
}
/** The date the shipped price table was last checked against Anthropic's prices. */
export declare const PRICES_AS_OF = "2026-10-30";
/** The price table shipped with the tool, by model. */
export declare const PRICE_TABLE: Readonly<Record<string, Price>>;
/**
 * The configured model's price: `config.yaml`'s `prices`, else the shipped
 * table. Undefined for a model in neither, which is never called.
 */
export declare function priceOf(config: Config): Price | undefined;
/** What the API's reported tokens cost. */
export declare function costOf(price: Price, usage: LlmReply["usage"]): number;
/**
 * Text's tokens before it's sent, at one token per 3 characters: more tokens
 * than real text has.
 */
export declare function estimatedTokens(text: string): number;
/** `$0.17` */
export declare function usd(n: number): string;
/**
 * The most a call can cost, before it's made: the system text and prompt at
 * their estimated tokens, and the whole `maxTokens` as output, thinking
 * included. So the cap can't be passed.
 */
export declare function ceilingCost(price: Price, req: Pick<LlmRequest, "system" | "prompt" | "maxTokens">): number;
