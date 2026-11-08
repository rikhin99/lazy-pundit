/**
 * The fetch transport. Every network read goes through one of these, so tests
 * can replay snapshot folders with no network.
 */
export interface TransportRequest {
  url: string;
  /** Query parameters. Recorded in the snapshot manifest. */
  params?: Record<string, string>;
  /** Request headers (cookies included). Never recorded anywhere. */
  headers?: Record<string, string>;
  /** `GET` unless given. Platform fetches are all `GET`; the LLM call posts. */
  method?: "GET" | "POST";
  /** The request body, sent with a `POST`. Never recorded anywhere. */
  body?: string;
  /** Aborts the request, for a caller that stops waiting for its answer. */
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  body: Uint8Array;
}

export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse>;
}

/** The URL a request resolves to, query parameters included. */
export function requestUrl(req: Pick<TransportRequest, "url" | "params">) {
  const url = new URL(req.url);
  for (const [key, value] of Object.entries(req.params ?? {})) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

/**
 * How long a platform request waits for its whole answer, body included,
 * before it's aborted (see `platformRequest` in `snapshot.ts`).
 */
export const PLATFORM_WAIT_MS = 30_000;

/** A request that got no whole answer within its wait, and was aborted. */
export class NoAnswer extends Error {
  override name = "NoAnswer";

  constructor(waitMs: number) {
    super(`no answer in ${waitMs / 1000} seconds`);
  }
}

/**
 * Sends `req` through `transport`, aborting it through its `signal` and
 * throwing `NoAnswer` when no answer comes within `waitMs`.
 */
export async function requestWithin(
  transport: Transport,
  req: TransportRequest,
  waitMs: number,
): Promise<TransportResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const noAnswer = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NoAnswer(waitMs));
    }, waitMs);
  });
  try {
    return await Promise.race([
      transport.request({ ...req, signal: controller.signal }),
      noAnswer,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The production transport: platform and LLM APIs over Node's built-in fetch. */
export function httpTransport(): Transport {
  return {
    async request(req) {
      const res = await fetch(requestUrl(req), {
        method: req.method ?? "GET",
        headers: req.headers ?? {},
        ...(req.body === undefined ? {} : { body: req.body }),
        ...(req.signal === undefined ? {} : { signal: req.signal }),
      });
      return {
        status: res.status,
        body: new Uint8Array(await res.arrayBuffer()),
      };
    },
  };
}
