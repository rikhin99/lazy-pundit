import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ANTHROPIC_API, anthropicLlm, type Llm } from "./anthropic.ts";
import { type Clipboard, noClipboard, systemClipboard } from "./clipboard.ts";
import { type Clock, systemClock } from "./clock.ts";
import { ESPN_API } from "./espn/api.ts";
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
  /** The operator's home folder, which a typed `~` stands for. */
  homeDir: string;
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

/** A clock stopped at `iso`, for a scripted run of a replay. */
function fixedAt(iso: string): Clock {
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
function privateTo(cookie: string | undefined, replay: Transport): Transport {
  if (!cookie) return replay;
  return {
    request: (req) =>
      req.url.startsWith(ESPN_API) &&
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
function withoutAnthropic(replay: Transport): Transport {
  return {
    request: (req) =>
      req.url.startsWith(ANTHROPIC_API)
        ? Promise.reject(
            new Error(
              "LAZY_PUNDIT_REPLAY is set, so nothing went to Anthropic",
            ),
          )
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
export function systemDeps(): Deps {
  const env = process.env;
  const home = homedir();
  const http = httpTransport();
  return {
    transport: env.LAZY_PUNDIT_REPLAY
      ? withoutAnthropic(
          privateTo(
            env.LAZY_PUNDIT_REPLAY_COOKIE,
            fileTransport(
              dirname(env.LAZY_PUNDIT_REPLAY),
              basename(env.LAZY_PUNDIT_REPLAY),
            ),
          ),
        )
      : http,
    llm: anthropicLlm(http),
    clock:
      env.LAZY_PUNDIT_REPLAY && env.LAZY_PUNDIT_NOW
        ? fixedAt(env.LAZY_PUNDIT_NOW)
        : systemClock,
    clipboard:
      env.LAZY_PUNDIT_CLIPBOARD === "off" ? noClipboard : systemClipboard,
    cacheDir: join(env.XDG_CACHE_HOME || join(home, ".cache"), "lazy-pundit"),
    configDir: join(
      env.XDG_CONFIG_HOME || join(home, ".config"),
      "lazy-pundit",
    ),
    workspacesDir: join(home, "lazy-pundit"),
    homeDir: home,
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
