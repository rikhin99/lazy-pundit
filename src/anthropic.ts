import { z } from "zod";
import type { Transport } from "./transport.ts";

/** Anthropic's API. */
export const ANTHROPIC_API = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Asks Anthropic whether a key works, by listing models: a free call that
 * spends nothing. `rejected` is a 401 or 403; `unreachable` means the request
 * failed or the API answered with an error of its own.
 */
export async function checkAnthropicKey(
  transport: Transport,
  key: string,
): Promise<"ok" | "rejected" | { unreachable: string }> {
  try {
    const res = await transport.request({
      url: `${ANTHROPIC_API}/models`,
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
    });
    if (res.status === 200) return "ok";
    if (res.status === 401 || res.status === 403) return "rejected";
    return { unreachable: `Anthropic answered ${res.status}` };
  } catch (err) {
    return { unreachable: (err as Error).message };
  }
}

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
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * The LLM behind every draft and revision. Injected through `Deps`, like the
 * transport, so tests script its replies and read the prompts it was sent.
 */
export interface Llm {
  write(req: LlmRequest): Promise<LlmReply>;
}

const messageSchema = z.object({
  content: z.array(
    z.looseObject({ type: z.string(), text: z.string().optional() }),
  ),
  stop_reason: z.string().nullable(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/**
 * Anthropic's Messages API through the transport. Throws on an error answer,
 * and on a reply cut off at the token limit or refused, so a half-written
 * blurb never reaches a draft.
 */
export function anthropicLlm(transport: Transport): Llm {
  return {
    async write(req) {
      const url = `${ANTHROPIC_API}/messages`;
      const res = await transport.request({
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
      const text = new TextDecoder().decode(res.body);
      if (res.status !== 200) {
        throw new Error(
          `Anthropic answered ${res.status}${errorMessage(text)}`,
        );
      }
      const parsed = messageSchema.safeParse(parseJson(text));
      if (!parsed.success) {
        throw new Error(
          `${url} answered with something that isn't a Messages API reply; check that nothing on this network intercepts requests to Anthropic`,
        );
      }
      const message = parsed.data;
      if (message.stop_reason !== "end_turn") {
        throw new Error(
          `Anthropic's reply stopped early (${message.stop_reason}), so it wasn't used`,
        );
      }
      return {
        text: message.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join(""),
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    },
  };
}

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

/** `: <message>` from an Anthropic error body, or nothing. */
function errorMessage(body: string): string {
  const parsed = errorSchema.safeParse(parseJson(body));
  return parsed.success ? `: ${parsed.data.error.message}` : "";
}

/** The JSON in `text`, or undefined when it isn't JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
