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
