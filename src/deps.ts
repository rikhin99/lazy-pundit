import { homedir } from "node:os";
import { join } from "node:path";
import { type Clipboard, systemClipboard } from "./clipboard.ts";
import { type Clock, systemClock } from "./clock.ts";
import { httpTransport, type Transport } from "./transport.ts";

/**
 * What every library entry point is handed instead of reaching the outside
 * world itself. Tests pass a file transport, a fixed clock and a recording
 * clipboard.
 */
export interface Deps {
  transport: Transport;
  clock: Clock;
  clipboard: Clipboard;
  /** The person-level cache folder for large platform files. */
  cacheDir: string;
}

/** The real network, system time, system clipboard and XDG cache dir. */
export function systemDeps(): Deps {
  return {
    transport: httpTransport(),
    clock: systemClock,
    clipboard: systemClipboard,
    cacheDir: join(
      process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
      "lazy-pundit",
    ),
  };
}
