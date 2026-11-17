import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ANTHROPIC_API, anthropicLlm } from "./anthropic.js";
import { noClipboard, systemClipboard } from "./clipboard.js";
import { systemClock } from "./clock.js";
import { ESPN_API } from "./espn/api.js";
import { fileTransport } from "./file-transport.js";
import { httpTransport } from "./transport.js";
/** A clock stopped at `iso`, for a scripted run of a replay. */
function fixedAt(iso) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) {
        throw new Error(`LAZY_PUNDIT_NOW is ${iso}, not an ISO time.`);
    }
    return { now: () => new Date(at) };
}
/**
 * A replay whose ESPN league is private to `cookie`: an ESPN request without
 * it gets a 401, as ESPN answers a private league. No cookie, no change.
 */
function privateTo(cookie, replay) {
    if (!cookie)
        return replay;
    return {
        request: (req) => req.url.startsWith(ESPN_API) &&
            req.headers?.Cookie !== `espn_s2=${cookie}`
            ? Promise.resolve({ status: 401, body: new Uint8Array() })
            : replay.request(req),
    };
}
/**
 * A replay that sends nothing to Anthropic: a request to its API, which no
 * snapshot records, fails saying so, so the key check's warning doesn't
 * report the replay's 404 as Anthropic's answer.
 */
function withoutAnthropic(replay) {
    return {
        request: (req) => req.url.startsWith(ANTHROPIC_API)
            ? Promise.reject(new Error("LAZY_PUNDIT_REPLAY is set, so nothing went to Anthropic"))
            : replay.request(req),
    };
}
/**
 * The real network, system time and system clipboard, with folders and
 * overrides read from the environment. This is the only place that reads
 * environment variables:
 *
 *   XDG_CONFIG_HOME        config folder, else ~/.config (then /lazy-pundit)
 *   XDG_CACHE_HOME         cache folder, else ~/.cache (then /lazy-pundit)
 *   ANTHROPIC_API_KEY      overrides the stored Anthropic key
 *   LAZY_PUNDIT_ESPN_S2    overrides the stored espn_s2 cookie
 *   NO_COLOR               not empty: the terminal output has no bold
 *   LAZY_PUNDIT_CLIPBOARD  `off` leaves the clipboard alone, as on a machine
 *                          without one, so scripted runs don't overwrite it
 *   LAZY_PUNDIT_REPLAY     a snapshot's folder: every request replays it, not
 *                          the network, so scripted runs stay offline; one it
 *                          didn't record gets a 404, and the key check fails
 *                          with a reason that says nothing went to Anthropic
 *   LAZY_PUNDIT_NOW        with LAZY_PUNDIT_REPLAY, an ISO time the clock
 *                          reads instead of the system's, so a scripted run
 *                          asks for the replay's season
 *   LAZY_PUNDIT_REPLAY_COOKIE  with LAZY_PUNDIT_REPLAY, the one espn_s2 the
 *                          replayed ESPN league reads with: any other, or
 *                          none, gets a 401, as from a private league
 */
export function systemDeps() {
    const env = process.env;
    const home = homedir();
    const http = httpTransport();
    return {
        transport: env.LAZY_PUNDIT_REPLAY
            ? withoutAnthropic(privateTo(env.LAZY_PUNDIT_REPLAY_COOKIE, fileTransport(dirname(env.LAZY_PUNDIT_REPLAY), basename(env.LAZY_PUNDIT_REPLAY))))
            : http,
        llm: anthropicLlm(http),
        clock: env.LAZY_PUNDIT_REPLAY && env.LAZY_PUNDIT_NOW
            ? fixedAt(env.LAZY_PUNDIT_NOW)
            : systemClock,
        clipboard: env.LAZY_PUNDIT_CLIPBOARD === "off" ? noClipboard : systemClipboard,
        cacheDir: join(env.XDG_CACHE_HOME || join(home, ".cache"), "lazy-pundit"),
        configDir: join(env.XDG_CONFIG_HOME || join(home, ".config"), "lazy-pundit"),
        workspacesDir: join(home, "lazy-pundit"),
        homeDir: home,
        env: {
            ...(env.ANTHROPIC_API_KEY
                ? { anthropicApiKey: env.ANTHROPIC_API_KEY }
                : {}),
            ...(env.LAZY_PUNDIT_ESPN_S2 ? { espnS2: env.LAZY_PUNDIT_ESPN_S2 } : {}),
            nodeVersion: process.version,
            ...(env.NO_COLOR ? { noColor: true } : {}),
        },
    };
}
//# sourceMappingURL=deps.js.map