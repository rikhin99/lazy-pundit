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

/** The production transport: the platform's API over Node's built-in fetch. */
export function httpTransport(): Transport {
  return {
    async request(req) {
      const res = await fetch(requestUrl(req), {
        headers: req.headers ?? {},
      });
      return {
        status: res.status,
        body: new Uint8Array(await res.arrayBuffer()),
      };
    },
  };
}
