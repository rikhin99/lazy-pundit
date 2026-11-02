import { stat } from "node:fs/promises";
import { checkAnthropicKey } from "./anthropic.ts";
import {
  type Config,
  type Credentials,
  configPath,
  credentialsPath,
  dropWorkspaces,
  envCredentials,
  exposure,
  loadCredentials,
  readConfig,
  readConfigFile,
  spendPath,
  spendSchema,
} from "./config.ts";
import type { Deps } from "./deps.ts";
import { readWorkspace } from "./workspace.ts";

export interface DoctorCheck {
  /** What was checked: `Node`, `config.yaml`, `workspace <slug>` and so on. */
  subject: string;
  /** `note` is something to know that needs no fixing. */
  status: "ok" | "note" | "warn" | "fail";
  message: string;
  /** What to do about a `warn` or `fail`, or how to change a `note`. */
  fix?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  /** True when no check failed. */
  ok: boolean;
}

/** The oldest Node this build runs on, as `engines` in package.json says. */
const NODE_MAJOR = 24;

/** An `espn_s2` cookie this many months old is near its end. */
const COOKIE_MONTHS = 11;

/**
 * Checks the operator's setup: Node, each of their files, each credential
 * with one live call, and every workspace `config.yaml` lists. A listed
 * folder that has gone is dropped from the list; no folder is ever touched.
 */
export async function doctor(deps: Deps): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [nodeCheck(deps.env.nodeVersion)];

  let config: Config | undefined;
  try {
    config = await readConfig(deps);
    checks.push(
      config
        ? { subject: "config.yaml", status: "ok", message: configPath(deps) }
        : {
            subject: "config.yaml",
            status: "warn",
            message: `No config.yaml in ${deps.configDir}.`,
            fix: "Run: lazy-pundit init",
          },
    );
  } catch (err) {
    checks.push({
      subject: "config.yaml",
      status: "fail",
      message: (err as Error).message,
      fix: `Fix ${configPath(deps)} as the message says.`,
    });
  }

  const credentials = await credentialsCheck(deps, checks);
  checks.push(await spendCheck(deps));
  checks.push(await anthropicCheck(deps, credentials));
  checks.push(espnCheck(deps, credentials));
  if (config) checks.push(...(await workspaceChecks(deps, config)));
  checks.push(await clipboardCheck(deps));

  return { checks, ok: checks.every((c) => c.status !== "fail") };
}

function nodeCheck(version: string): DoctorCheck {
  const major = Number(/^v?(\d+)/.exec(version)?.[1]);
  return major >= NODE_MAJOR
    ? { subject: "Node", status: "ok", message: version }
    : {
        subject: "Node",
        status: "fail",
        message: `Node ${version} is older than ${NODE_MAJOR}.`,
        fix: `Install Node ${NODE_MAJOR} or later from https://nodejs.org, then reinstall Lazy Pundit.`,
      };
}

/** Parses `credentials.yaml` and checks its mode; the env-only credentials if it fails. */
async function credentialsCheck(
  deps: Deps,
  checks: DoctorCheck[],
): Promise<Credentials> {
  const path = credentialsPath(deps);
  const subject = "credentials.yaml";
  try {
    const credentials = await loadCredentials(deps);
    const mode = await modeOf(path);
    const open = mode === undefined ? undefined : exposure(path, mode);
    if (mode === undefined) {
      checks.push({ subject, status: "ok", message: "No stored credentials." });
    } else if (open) {
      checks.push({ subject, status: "warn", ...open });
    } else {
      checks.push({ subject, status: "ok", message: `${path} (mode 0600)` });
    }
    return credentials;
  } catch (err) {
    checks.push({
      subject,
      status: "fail",
      message: (err as Error).message,
      fix: `Fix ${path} as the message says, or delete it and run lazy-pundit setup key again.`,
    });
    return envCredentials(deps.env);
  }
}

async function spendCheck(deps: Deps): Promise<DoctorCheck> {
  const subject = "spend.yaml";
  try {
    const spend = await readConfigFile(spendPath(deps), spendSchema);
    return {
      subject,
      status: "ok",
      message: spend ? spendPath(deps) : "No LLM spend recorded yet.",
    };
  } catch (err) {
    return {
      subject,
      status: "fail",
      message: (err as Error).message,
      fix: `Fix ${spendPath(deps)} as the message says. Deleting it forgets this month's spend.`,
    };
  }
}

async function anthropicCheck(
  deps: Deps,
  credentials: Credentials,
): Promise<DoctorCheck> {
  const subject = "Anthropic key";
  const key = credentials.anthropicApiKey;
  if (!key) {
    return {
      subject,
      status: "note",
      message:
        "No Anthropic key, so drafts get stat lines instead of LLM blurbs.",
      fix: "To have the LLM write blurbs, run: lazy-pundit setup key (or set ANTHROPIC_API_KEY).",
    };
  }
  const source = key.from === "env" ? "ANTHROPIC_API_KEY" : "the stored key";
  const answer = await checkAnthropicKey(deps.transport, key.value);
  if (answer === "ok") {
    return { subject, status: "ok", message: `Anthropic accepted ${source}.` };
  }
  if (answer === "rejected") {
    return {
      subject,
      status: "fail",
      message: `Anthropic rejected ${source}.`,
      fix:
        key.from === "env"
          ? "Set ANTHROPIC_API_KEY to a current key from https://console.anthropic.com, or unset it to use the stored key."
          : "Make a new key at https://console.anthropic.com, then run: lazy-pundit setup key",
    };
  }
  return {
    subject,
    status: "warn",
    message: `Couldn't check ${source}: ${answer.unreachable}.`,
    fix: "Check your connection and run lazy-pundit doctor again.",
  };
}

/**
 * The cookie's age. It's checked live against an ESPN league once ESPN
 * leagues can be set up; until then only its age is checked.
 */
function espnCheck(deps: Deps, credentials: Credentials): DoctorCheck {
  const subject = "ESPN cookie";
  const cookie = credentials.espnS2;
  if (!cookie) {
    return {
      subject,
      status: "ok",
      message: "None stored; only private ESPN leagues need one.",
    };
  }
  if (cookie.savedAt === undefined) {
    return {
      subject,
      status: "ok",
      message: "From LAZY_PUNDIT_ESPN_S2.",
    };
  }
  const [y, m, d] = cookie.savedAt.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const renewBy = new Date(y, m - 1 + COOKIE_MONTHS, d);
  if (deps.clock.now() >= renewBy) {
    return {
      subject,
      status: "warn",
      message: `The espn_s2 cookie was saved ${cookie.savedAt}, over ${COOKIE_MONTHS} months ago, and may stop working soon.`,
      fix: "Copy a fresh espn_s2 from your browser, then run: lazy-pundit setup espn",
    };
  }
  return { subject, status: "ok", message: `Saved ${cookie.savedAt}.` };
}

/**
 * Each listed workspace's `workspace.md`. A folder that no longer exists is
 * dropped from `config.yaml` with a note; nothing in any folder is touched.
 */
async function workspaceChecks(
  deps: Deps,
  config: Config,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const gone: string[] = [];
  for (const [slug, dir] of Object.entries(config.workspaces)) {
    const subject = `workspace ${slug}`;
    if (await isGone(dir)) {
      gone.push(slug);
      checks.push({
        subject,
        status: "note",
        message: `${dir} is gone, so it was dropped from config.yaml.`,
      });
      continue;
    }
    try {
      await readWorkspace(dir);
      checks.push({ subject, status: "ok", message: dir });
    } catch (err) {
      checks.push({
        subject,
        status: "fail",
        message: (err as Error).message,
        fix: `Fix workspace.md in ${dir}, or remove "${slug}" from ${configPath(deps)}.`,
      });
    }
  }
  if (gone.length > 0) await dropWorkspaces(deps, gone);
  return checks;
}

async function clipboardCheck(deps: Deps): Promise<DoctorCheck> {
  const command = await deps.clipboard.find();
  return command
    ? { subject: "clipboard", status: "ok", message: command }
    : {
        subject: "clipboard",
        status: "warn",
        message: "No clipboard command found, so publish can't copy the text.",
        fix: "Install wl-clipboard or xclip (Linux). Until then, paste from the .txt file publish writes.",
      };
}

/** Whether nothing is at a path. A folder we can't read isn't gone. */
async function isGone(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** A path's permission bits, or undefined if nothing is there. */
async function modeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o777;
  } catch {
    return undefined;
  }
}
