import type { LlmReply, LlmRequest } from "./anthropic.ts";
import type { Config } from "./config.ts";

/** A model's price per million tokens, in US dollars. */
export interface Price {
  input_per_mtok: number;
  output_per_mtok: number;
}

/** The date the shipped price table was last checked against Anthropic's prices. */
export const PRICES_AS_OF = "2026-10-30";

/** The price table shipped with the tool, by model. */
export const PRICE_TABLE: Readonly<Record<string, Price>> = {
  "claude-sonnet-5-5": { input_per_mtok: 2, output_per_mtok: 10 },
  "claude-haiku-5-5": { input_per_mtok: 0.1, output_per_mtok: 0.5 },
  "claude-opus-5-5": { input_per_mtok: 4, output_per_mtok: 20 },
};

/**
 * The configured model's price: `config.yaml`'s `prices`, else the shipped
 * table. Undefined for a model in neither, which is never called.
 */
export function priceOf(config: Config): Price | undefined {
  const { model, prices } = config;
  if (Object.hasOwn(prices, model)) return prices[model];
  if (Object.hasOwn(PRICE_TABLE, model)) return PRICE_TABLE[model];
  return undefined;
}

/** What the API's reported tokens cost. */
export function costOf(price: Price, usage: LlmReply["usage"]): number {
  return (
    (usage.inputTokens * price.input_per_mtok +
      usage.outputTokens * price.output_per_mtok) /
    1_000_000
  );
}

/**
 * The most a call can cost, before it's made: the system text and prompt at
 * one token per 3 characters (more tokens than real text has), and the whole
 * `maxTokens` as output, thinking included. So the cap can't be passed.
 */
export function ceilingCost(
  price: Price,
  req: Pick<LlmRequest, "system" | "prompt" | "maxTokens">,
): number {
  return costOf(price, {
    inputTokens: Math.ceil((req.system.length + req.prompt.length) / 3),
    outputTokens: req.maxTokens,
  });
}
