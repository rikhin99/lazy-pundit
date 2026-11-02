import type { Llm, LlmRequest } from "../../src/index.ts";

/**
 * An LLM that answers from a script and remembers every request. Each reply
 * is a string or a function of the request; after the last one, the last
 * reply repeats.
 */
export function scriptedLlm(
  ...replies: (string | ((req: LlmRequest) => string))[]
): Llm & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async write(req) {
      requests.push(req);
      const reply = replies[Math.min(requests.length, replies.length) - 1];
      if (reply === undefined) throw new Error("the script has no replies");
      return {
        text: typeof reply === "function" ? reply(req) : reply,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

/** An LLM that fails the test if it's ever called. */
export const noLlm: Llm = {
  write: async () => {
    throw new Error("this test makes no LLM call");
  },
};
