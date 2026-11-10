import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { anthropicLlm } from "./anthropic.js";
import { noClipboard, systemClipboard } from "./clipboard.js";
import { systemClock } from "./clock.js";
import { fileTransport } from "./file-transport.js";
import { httpTransport } from "./transport.js";
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
 *                          didn't record, such as the key check, gets a 404
 */
export function systemDeps() {
    const env = process.env;
    const home = homedir();
    const http = httpTransport();
    return {
        transport: env.LAZY_PUNDIT_REPLAY
            ? fileTransport(dirname(env.LAZY_PUNDIT_REPLAY), basename(env.LAZY_PUNDIT_REPLAY))
            : http,
        llm: anthropicLlm(http),
        clock: systemClock,
        clipboard: env.LAZY_PUNDIT_CLIPBOARD === "off" ? noClipboard : systemClipboard,
        cacheDir: join(env.XDG_CACHE_HOME || join(home, ".cache"), "lazy-pundit"),
        configDir: join(env.XDG_CONFIG_HOME || join(home, ".config"), "lazy-pundit"),
        workspacesDir: join(home, "lazy-pundit"),
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