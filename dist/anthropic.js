import { z } from "zod";
import { requestWithin } from "./transport.js";
/** Anthropic's API. */
export const ANTHROPIC_API = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
/** How long the key check waits for Anthropic's answer before giving up. */
export const KEY_CHECK_WAIT_MS = 10_000;
/**
 * Asks Anthropic whether a key works, by listing models: a free call that
 * spends nothing. `rejected` is a 401 or 403; `unreachable` means the request
 * failed, the API answered with an error of its own, or no answer came within
 * `KEY_CHECK_WAIT_MS`, when the request is aborted.
 */
export async function checkAnthropicKey(transport, key) {
    try {
        const res = await requestWithin(transport, {
            url: `${ANTHROPIC_API}/models`,
            headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
        }, KEY_CHECK_WAIT_MS);
        if (res.status === 200)
            return "ok";
        if (res.status === 401 || res.status === 403)
            return "rejected";
        return { unreachable: `Anthropic answered ${res.status}` };
    }
    catch (err) {
        return { unreachable: err.message };
    }
}
const messageSchema = z.object({
    content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
    stop_reason: z.string().nullable(),
    usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});
/**
 * A failed LLM call. `usage` is set when the API billed the call anyway, as
 * for a reply cut off at the token limit.
 */
export class LlmError extends Error {
    name = "LlmError";
    kind;
    usage;
    constructor(kind, message, usage) {
        super(message);
        this.kind = kind;
        this.usage = usage;
    }
}
/**
 * Anthropic's Messages API through the transport. Throws an `LlmError` on an
 * error answer, a network failure, and a reply cut off at the token limit or
 * refused, so a half-written blurb never reaches a draft.
 */
export function anthropicLlm(transport) {
    return {
        async write(req) {
            const url = `${ANTHROPIC_API}/messages`;
            let res;
            try {
                res = await transport.request({
                    url,
                    method: "POST",
                    headers: {
                        "x-api-key": req.key,
                        "anthropic-version": ANTHROPIC_VERSION,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        model: req.model,
                        max_tokens: req.maxTokens,
                        system: req.system,
                        messages: [{ role: "user", content: req.prompt }],
                    }),
                });
            }
            catch (err) {
                throw new LlmError("provider", `Couldn't reach Anthropic: ${err.message}`);
            }
            const text = new TextDecoder().decode(res.body);
            if (res.status !== 200) {
                const detail = errorMessage(text);
                throw new LlmError(errorKind(res.status, detail), `Anthropic answered ${res.status}${detail ? `: ${detail}` : ""}`);
            }
            const parsed = messageSchema.safeParse(parseJson(text));
            if (!parsed.success) {
                throw new LlmError("provider", `${url} answered with something that isn't a Messages API reply; check that nothing on this network intercepts requests to Anthropic`);
            }
            const message = parsed.data;
            const usage = {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
            };
            if (message.stop_reason !== "end_turn") {
                throw new LlmError("provider", `Anthropic's reply stopped early (${message.stop_reason}), so it wasn't used`, usage);
            }
            return {
                text: message.content
                    .filter((b) => b.type === "text")
                    .map((b) => b.text ?? "")
                    .join(""),
                usage,
            };
        },
    };
}
/** What an error answer's status and message say went wrong. */
function errorKind(status, message) {
    if (status === 401 || status === 403)
        return "invalid-key";
    if (status === 400 && /credit balance is too low/i.test(message)) {
        return "no-credits";
    }
    return "provider";
}
const errorSchema = z.object({ error: z.object({ message: z.string() }) });
/** The message in an Anthropic error body, or "". */
function errorMessage(body) {
    const parsed = errorSchema.safeParse(parseJson(body));
    return parsed.success ? parsed.data.error.message : "";
}
/** The JSON in `text`, or undefined when it isn't JSON. */
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=anthropic.js.map