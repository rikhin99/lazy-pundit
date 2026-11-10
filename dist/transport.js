/** The URL a request resolves to, query parameters included. */
export function requestUrl(req) {
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
    name = "NoAnswer";
    constructor(waitMs) {
        super(`no answer in ${waitMs / 1000} seconds`);
    }
}
/**
 * Sends `req` through `transport`, aborting it through its `signal` and
 * throwing `NoAnswer` when no answer comes within `waitMs`.
 */
export async function requestWithin(transport, req, waitMs) {
    const controller = new AbortController();
    let timer;
    const noAnswer = new Promise((_, reject) => {
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
    }
    finally {
        clearTimeout(timer);
    }
}
/** The production transport: platform and LLM APIs over Node's built-in fetch. */
export function httpTransport() {
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
//# sourceMappingURL=transport.js.map