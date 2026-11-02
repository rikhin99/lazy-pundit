import type { Llm, LlmReply, LlmRequest } from "../../src/index.ts";

/**
 * One scripted answer: reply text (reporting 0 tokens), a whole reply with
 * its token counts, an error to throw, or a function of the request.
 */
export type Scripted =
  | string
  | LlmReply
  | Error
  | ((req: LlmRequest) => string | LlmReply);

/**
 * An LLM that answers from a script and remembers every request. After the
 * last answer, the last answer repeats.
 */
export function scriptedLlm(
  ...replies: Scripted[]
): Llm & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async write(req) {
      requests.push(req);
      const scripted = replies[Math.min(requests.length, replies.length) - 1];
      if (scripted === undefined) throw new Error("the script has no replies");
      if (scripted instanceof Error) throw scripted;
      const reply = typeof scripted === "function" ? scripted(req) : scripted;
      return typeof reply === "string"
        ? { text: reply, usage: { inputTokens: 0, outputTokens: 0 } }
        : reply;
    },
  };
}

/** An LLM that fails the test if it's ever called. */
export const noLlm: Llm = {
  write: async () => {
    throw new Error("this test makes no LLM call");
  },
};
