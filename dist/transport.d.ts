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
export declare function requestUrl(req: Pick<TransportRequest, "url" | "params">): string;
/**
 * How long a platform request waits for its whole answer, body included,
 * before it's aborted (see `platformRequest` in `snapshot.ts`).
 */
export declare const PLATFORM_WAIT_MS = 30000;
/** A request that got no whole answer within its wait, and was aborted. */
export declare class NoAnswer extends Error {
    name: string;
    constructor(waitMs: number);
}
/**
 * Sends `req` through `transport`, aborting it through its `signal` and
 * throwing `NoAnswer` when no answer comes within `waitMs`.
 */
export declare function requestWithin(transport: Transport, req: TransportRequest, waitMs: number): Promise<TransportResponse>;
/** The production transport: platform and LLM APIs over Node's built-in fetch. */
export declare function httpTransport(): Transport;
