import { type Transport } from "./transport.ts";
/** Anthropic's API. */
export declare const ANTHROPIC_API = "https://api.anthropic.com/v1";
/** How long the key check waits for Anthropic's answer before giving up. */
export declare const KEY_CHECK_WAIT_MS = 10000;
/**
 * Asks Anthropic whether a key works, by listing models: a free call that
 * spends nothing. `rejected` is a 401 or 403; `unreachable` means the request
 * failed, the API answered with an error of its own, or no answer came within
 * `KEY_CHECK_WAIT_MS`, when the request is aborted.
 */
export declare function checkAnthropicKey(transport: Transport, key: string): Promise<"ok" | "rejected" | {
    unreachable: string;
}>;
/** One request for prose: the key and model it runs on, and what the model reads. */
export interface LlmRequest {
    key: string;
    model: string;
    /** The standing instructions. */
    system: string;
    /** This draft's material, as the one user message. */
    prompt: string;
    /** The most the reply may spend on output, thinking included. */
    maxTokens: number;
}
export interface LlmReply {
    /** The reply's text blocks, joined. */
    text: string;
    /** Tokens the API reports the call used, which spend is counted from. */
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}
/**
 * The LLM behind every draft and revision. Injected through `Deps`, like the
 * transport, so tests script its replies and read the prompts it was sent.
 */
export interface Llm {
    write(req: LlmRequest): Promise<LlmReply>;
}
/**
 * Why an LLM call failed: Anthropic refused the key (401 or 403), the
 * account has no credits left, or anything else went wrong with the provider.
 */
export type LlmErrorKind = "invalid-key" | "no-credits" | "provider";
/**
 * A failed LLM call. `usage` is set when the API billed the call anyway, as
 * for a reply cut off at the token limit.
 */
export declare class LlmError extends Error {
    name: string;
    readonly kind: LlmErrorKind;
    readonly usage: LlmReply["usage"] | undefined;
    constructor(kind: LlmErrorKind, message: string, usage?: LlmReply["usage"]);
}
/**
 * Anthropic's Messages API through the transport. Throws an `LlmError` on an
 * error answer, a network failure, and a reply cut off at the token limit or
 * refused, so a half-written blurb never reaches a draft.
 */
export declare function anthropicLlm(transport: Transport): Llm;
