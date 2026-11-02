# Anthropic's API over raw HTTP through the transport, not the SDK

Spec #37 ("Shape and runtime") named `@anthropic-ai/sdk` for LLM calls, and the `claude-api` skill defaults to the SDK too. We call the Messages API ourselves instead: `anthropicLlm` in `src/anthropic.ts` POSTs JSON through the injected `Transport`, the same way `checkAnthropicKey` lists models and the Sleeper adapter fetches leagues. That keeps the repo's one network rule intact: only `transport.ts` reaches the network, and tests drive every outside call through a transport that records requests and replays canned answers. The client needs one endpoint, one request shape and a few stop reasons, so the SDK would add a dependency and a second way of reaching the network for very little.

## Considered options

- **`@anthropic-ai/sdk` with its own `fetch`**: rejected. The SDK accepts an injected `fetch`, which could wrap our transport, but that adds a layer between the SDK's types and the recording transport, and its retries and timeouts would run inside our tests unless each is turned off.
- **`@anthropic-ai/sdk` called directly**: rejected. It would break the rule that only `transport.ts` reaches the network, which `test/injected-boundaries.test.ts` enforces.

## Consequences

- Request and reply shapes are ours to keep current. `anthropicLlm` validates the reply with zod and throws on an error answer, a reply that isn't a Messages API reply, and any stop reason other than `end_turn`, so a changed API fails loudly rather than quietly.
- Retries, server-side fallbacks and the spend estimate are written in this repo (#52 part b, #53), not taken from the SDK.
- New Anthropic calls copy `src/anthropic.ts`. Reach for the `claude-api` skill only for an endpoint or feature that file doesn't use yet, and read its `typescript/` and `curl/` sections, not the whole skill.
