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
