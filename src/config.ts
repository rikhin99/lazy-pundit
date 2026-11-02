import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import { type ZodType, z } from "zod";
import type { Deps } from "./deps.ts";

/**
 * The person-level files in the config folder, outside any workspace:
 *
 *   config.yaml       name, model, monthly cap, price overrides, workspaces
 *   credentials.yaml  the Anthropic key and espn_s2, at mode 0600
 *   usage.yaml        LLM spend by calendar month
 *
 * Each carries `format:`, versioned by `CONFIG_FORMAT`.
 */
export const CONFIG_FORMAT = 1;

export class ConfigFileError extends Error {
  override name = "ConfigFileError";
}

/** A league slug: the workspace's short name, as in `--league <slug>`. */
const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

/** A price per million tokens, in US dollars. */
const priceSchema = z.object({
  input_per_mtok: z.number().nonnegative(),
  output_per_mtok: z.number().nonnegative(),
});

export const configSchema = z.object({
  format: z.literal(CONFIG_FORMAT),
  /** The person's pundit name, the default for each new workspace. */
  name: z.string().min(1).optional(),
  model: z.string().min(1).default("claude-sonnet-5-5"),
  /** The hard cap on LLM spend per calendar month, across every league. */
  monthly_cap_usd: z.number().nonnegative().default(5),
  /** Prices that replace or add to the table shipped with the tool, by model. */
  prices: z.record(z.string(), priceSchema).default({}),
  /** Each league workspace by slug: its folder. */
  workspaces: z
    .record(
      slugSchema,
      z.string().refine(isAbsolute, {
        error:
          "give the workspace's full path, such as /Users/you/lazy-pundit/<slug> (not ~ or a relative path)",
      }),
    )
    .default({}),
});

export type Config = z.output<typeof configSchema>;

export const credentialsSchema = z.object({
  format: z.literal(CONFIG_FORMAT),
  anthropic_api_key: z.string().min(1).optional(),
  espn_s2: z
    .object({ value: z.string().min(1), saved_at: z.iso.date() })
    .optional(),
});

export const usageSchema = z.object({
  format: z.literal(CONFIG_FORMAT),
  /** Spend in US dollars by calendar month in local time (`2025-10`). */
  months: z
    .record(z.string().regex(/^\d{4}-\d{2}$/), z.number().nonnegative())
    .default({}),
});

export function configPath(deps: Pick<Deps, "configDir">): string {
  return join(deps.configDir, "config.yaml");
}

export function credentialsPath(deps: Pick<Deps, "configDir">): string {
  return join(deps.configDir, "credentials.yaml");
}

export function usagePath(deps: Pick<Deps, "configDir">): string {
  return join(deps.configDir, "usage.yaml");
}

/** A credential in use, and where it came from. */
export interface Credential {
  value: string;
  /** `env` when an environment variable overrides the stored value. */
  from: "env" | "file";
}

export interface Credentials {
  anthropicApiKey?: Credential;
  /** `savedAt` is the stored cookie's local date; an override has none. */
  espnS2?: Credential & { savedAt?: string };
  /** Anything the person should fix, such as a file others can read. */
  warnings: string[];
}

/**
 * The credentials to use: each environment override, else the stored value.
 * Warns when other users on the machine can read `credentials.yaml`.
 */
export async function loadCredentials(
  deps: Pick<Deps, "configDir" | "env">,
): Promise<Credentials> {
  const path = credentialsPath(deps);
  const stored = await readConfigFile(path, credentialsSchema);
  const result = envCredentials(deps.env);
  if (stored) {
    const open = exposure(path, (await stat(path)).mode & 0o777);
    if (open) result.warnings.push(`${open.message} ${open.fix}`);
  }
  if (!result.anthropicApiKey && stored?.anthropic_api_key) {
    result.anthropicApiKey = { value: stored.anthropic_api_key, from: "file" };
  }
  if (!result.espnS2 && stored?.espn_s2) {
    result.espnS2 = {
      value: stored.espn_s2.value,
      from: "file",
      savedAt: stored.espn_s2.saved_at,
    };
  }
  return result;
}

/** Only the credentials the environment gives, as when nothing is stored. */
export function envCredentials(env: Deps["env"]): Credentials {
  return {
    ...(env.anthropicApiKey
      ? { anthropicApiKey: { value: env.anthropicApiKey, from: "env" } }
      : {}),
    ...(env.espnS2 ? { espnS2: { value: env.espnS2, from: "env" } } : {}),
    warnings: [],
  };
}

/**
 * Removes workspaces from `config.yaml`'s list, keeping the rest of the file
 * as written, comments included.
 */
export async function dropWorkspaces(
  deps: Pick<Deps, "configDir">,
  slugs: string[],
): Promise<void> {
  const path = configPath(deps);
  await readConfigFile(path, configSchema);
  const doc = parseDocument(await readFile(path, "utf8"));
  for (const slug of slugs) doc.deleteIn(["workspaces", slug]);
  const mode = (await stat(path)).mode & 0o777;
  await writeConfigFile(path, doc.toString(), mode);
}

/**
 * What's wrong with a credentials file's permission bits, and the fix, or
 * undefined when only its owning user can use it.
 */
export function exposure(
  path: string,
  mode: number,
): { message: string; fix: string } | undefined {
  if ((mode & 0o077) === 0) return undefined;
  const how = mode & 0o044 ? "read" : "changed";
  return {
    message: `${path} can be ${how} by other users on this machine (mode 0${mode.toString(8)}).`,
    fix: `Run: chmod 600 ${path}`,
  };
}

/**
 * Stores credentials in `credentials.yaml` at mode 0600, keeping any stored
 * value not given. A new `espn_s2` is dated today. Returns the file's path.
 */
export async function saveCredentials(
  deps: Pick<Deps, "configDir" | "clock">,
  values: { anthropicApiKey?: string; espnS2?: string },
): Promise<string> {
  const path = credentialsPath(deps);
  const stored = (await readConfigFile(path, credentialsSchema)) ?? {
    format: CONFIG_FORMAT,
  };
  const next: z.input<typeof credentialsSchema> = {
    ...stored,
    ...(values.anthropicApiKey
      ? { anthropic_api_key: values.anthropicApiKey }
      : {}),
    ...(values.espnS2
      ? {
          espn_s2: {
            value: values.espnS2,
            saved_at: localDate(deps.clock.now()),
          },
        }
      : {}),
  };
  await writeConfigFile(path, stringify(credentialsSchema.parse(next)), 0o600);
  return path;
}

/** `2025-10-28`, in local time. */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Writes a person-level file whole, through a temp file renamed into place,
 * so a crash never leaves half a file and the new file has `mode` from the
 * start. A new config folder is made at mode 0700, closed to other users.
 */
async function writeConfigFile(path: string, text: string, mode: number) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, text, { mode });
  await rename(tmp, path);
}

/** Reads `config.yaml`, or undefined if there is none. */
export function readConfig(deps: Pick<Deps, "configDir">) {
  return readConfigFile(configPath(deps), configSchema);
}

/**
 * Reads and parses one person-level YAML file. A missing file is undefined;
 * a file that doesn't parse, or has another format version, is refused with
 * its path and what to fix.
 */
export async function readConfigFile<T>(
  path: string,
  schema: ZodType<T>,
): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ConfigFileError(`Can't read ${path}`, { cause: err });
  }
  let data: unknown;
  try {
    data = parse(text) ?? {};
  } catch (cause) {
    throw new ConfigFileError(`${path} isn't valid YAML`, { cause });
  }
  const format = (data as { format?: unknown } | null)?.format;
  if (format !== CONFIG_FORMAT) {
    throw new ConfigFileError(
      format === undefined
        ? `${path} has no format version; add "format: ${CONFIG_FORMAT}" at the top`
        : `${path} is format ${String(format)}, but this version of Lazy Pundit reads only format ${CONFIG_FORMAT}`,
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ConfigFileError(`${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
