import { expect, test } from "vitest";
import {
  ANTHROPIC_API,
  anthropicLlm,
  type TransportRequest,
} from "../src/index.ts";

/** A transport that answers every request with one status and JSON body. */
function answering(status: number, body: unknown) {
  const requests: TransportRequest[] = [];
  return {
    requests,
    transport: {
      async request(req: TransportRequest) {
        requests.push(req);
        return {
          status,
          body: new TextEncoder().encode(JSON.stringify(body)),
        };
      },
    },
  };
}

test("posts the system prompt and one user message to the Messages API with the key", async () => {
  const { requests, transport } = answering(200, {
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text: "## {intro}\n" },
      { type: "text", text: "Big week." },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 812, output_tokens: 95 },
  });

  const reply = await anthropicLlm(transport).write({
    key: "sk-ant-test",
    model: "claude-sonnet-5-5",
    system: "You are a pundit.",
    prompt: "Week 8.",
    maxTokens: 16000,
  });

  expect(reply).toEqual({
    text: "## {intro}\nBig week.",
    usage: { inputTokens: 812, outputTokens: 95 },
  });
  expect(requests).toHaveLength(1);
  const [req] = requests as [TransportRequest];
  expect(req.url).toBe(`${ANTHROPIC_API}/messages`);
  expect(req.method).toBe("POST");
  expect(req.headers).toMatchObject({
    "x-api-key": "sk-ant-test",
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  });
  expect(JSON.parse(req.body ?? "")).toEqual({
    model: "claude-sonnet-5-5",
    max_tokens: 16000,
    system: "You are a pundit.",
    messages: [{ role: "user", content: "Week 8." }],
  });
});

test.each([
  [
    401,
    {
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    },
    /Anthropic answered 401: invalid x-api-key/,
  ],
  [529, "overloaded", /Anthropic answered 529/],
])(
  "an error answer (%i) throws with the status",
  async (status, body, message) => {
    const { transport } = answering(status, body);
    await expect(
      anthropicLlm(transport).write({
        key: "k",
        model: "claude-sonnet-5-5",
        system: "s",
        prompt: "p",
        maxTokens: 10,
      }),
    ).rejects.toThrow(message);
  },
);

test("a reply cut off by the token limit or refused throws rather than giving partial prose", async () => {
  for (const stop_reason of ["max_tokens", "refusal"]) {
    const { transport } = answering(200, {
      content: [{ type: "text", text: "## {intro}\nHalf a" }],
      stop_reason,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(
      anthropicLlm(transport).write({
        key: "k",
        model: "claude-sonnet-5-5",
        system: "s",
        prompt: "p",
        maxTokens: 10,
      }),
    ).rejects.toThrow(new RegExp(stop_reason));
  }
});

test("a reply that isn't a Messages API body throws naming the URL", async () => {
  for (const body of ["<html>proxy page</html>", { content: "nope" }]) {
    const { transport } = answering(200, body);
    await expect(
      anthropicLlm(transport).write({
        key: "k",
        model: "claude-sonnet-5-5",
        system: "s",
        prompt: "p",
        maxTokens: 10,
      }),
    ).rejects.toThrow(
      `${ANTHROPIC_API}/messages answered with something that isn't a Messages API reply`,
    );
  }
});
