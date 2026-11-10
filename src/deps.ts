import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { anthropicLlm, type Llm } from "./anthropic.ts";
import { type Clipboard, noClipboard, systemClipboard } from "./clipboard.ts";
import { type Clock, systemClock } from "./clock.ts";
import { fileTransport } from "./file-transport.ts";
import { httpTransport, type Transport } from "./transport.ts";

/**
 * What every library entry point is handed instead of reaching the outside
 * world itself. Tests pass a file transport, a fixed clock, a recording
 * clipboard and temp folders, so nothing touches the real home directory.
 */
export interface Deps {
  transport: Transport;
  /** The LLM that writes blurbs and the week intro, called only with a key. */
  llm: Llm;
  clock: Clock;
  clipboard: Clipboard;
  /** The operator's cache folder for large platform files. */
  cacheDir: string;
  /** The operator's config folder: `config.yaml`, `credentials.yaml`, `spend.yaml`. */
  configDir: string;
  /** The folder new league workspaces go in by default, one per league slug. */
  workspacesDir: string;
  /** What the environment overrides or reports. */
  env: Environment;
}

export interface Environment {
  /** `ANTHROPIC_API_KEY`: used instead of the stored Anthropic key. */
  anthropicApiKey?: string;
  /** `LAZY_PUNDIT_ESPN_S2`: used instead of the stored `espn_s2` cookie. */
  espnS2?: string;
  /** The running Node's version, such as `v24.1.0`. */
  nodeVersion: string;
  /** `NO_COLOR`, set and not empty: no bold or colour in the terminal. */
  noColor?: true;
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
 *                          didn't record, such as the key check, gets a 404
 */
export function systemDeps(): Deps {
  const env = process.env;
  const home = homedir();
  const http = httpTransport();
  return {
    transport: env.LAZY_PUNDIT_REPLAY
      ? fileTransport(
          dirname(env.LAZY_PUNDIT_REPLAY),
          basename(env.LAZY_PUNDIT_REPLAY),
        )
      : http,
    llm: anthropicLlm(http),
    clock: systemClock,
    clipboard:
      env.LAZY_PUNDIT_CLIPBOARD === "off" ? noClipboard : systemClipboard,
    cacheDir: join(env.XDG_CACHE_HOME || join(home, ".cache"), "lazy-pundit"),
    configDir: join(
      env.XDG_CONFIG_HOME || join(home, ".config"),
      "lazy-pundit",
    ),
    workspacesDir: join(home, "lazy-pundit"),
    env: {
      ...(env.ANTHROPIC_API_KEY
        ? { anthropicApiKey: env.ANTHROPIC_API_KEY }
        : {}),
      ...(env.LAZY_PUNDIT_ESPN_S2 ? { espnS2: env.LAZY_PUNDIT_ESPN_S2 } : {}),
      nodeVersion: process.version,
      ...(env.NO_COLOR ? { noColor: true as const } : {}),
    },
  };
}
