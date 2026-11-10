import { type ZodType, z } from "zod";
import type { Deps } from "./deps.ts";
/**
 * The operator's files in the config folder, outside any workspace:
 *
 *   config.yaml       name, model, spend cap, price overrides, workspaces
 *   credentials.yaml  the Anthropic key and espn_s2, at mode 0600
 *   spend.yaml        LLM spend by calendar month
 *
 * Each carries `format:`, versioned by `CONFIG_FORMAT`.
 */
export declare const CONFIG_FORMAT = 1;
export declare class ConfigFileError extends Error {
    name: string;
}
export declare const configSchema: z.ZodObject<{
    format: z.ZodLiteral<1>;
    name: z.ZodOptional<z.ZodString>;
    model: z.ZodDefault<z.ZodString>;
    spend_cap_usd: z.ZodDefault<z.ZodNumber>;
    prices: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        input_per_mtok: z.ZodNumber;
        output_per_mtok: z.ZodNumber;
    }, z.core.$strip>>>;
    workspaces: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type Config = z.output<typeof configSchema>;
/** The config with no `config.yaml`: every default. */
export declare function defaultConfig(): Config;
export declare const credentialsSchema: z.ZodObject<{
    format: z.ZodLiteral<1>;
    anthropic_api_key: z.ZodOptional<z.ZodString>;
    espn_s2: z.ZodOptional<z.ZodObject<{
        value: z.ZodString;
        saved_at: z.ZodISODate;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const spendSchema: z.ZodObject<{
    format: z.ZodLiteral<1>;
    months: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, z.core.$strip>;
export declare function configPath(deps: Pick<Deps, "configDir">): string;
export declare function credentialsPath(deps: Pick<Deps, "configDir">): string;
export declare function spendPath(deps: Pick<Deps, "configDir">): string;
/** A credential in use, and where it came from. */
export interface Credential {
    value: string;
    /** `env` when an environment variable overrides the stored value. */
    from: "env" | "file";
}
export interface Credentials {
    anthropicApiKey?: Credential;
    /** `savedAt` is the stored cookie's local date; an override has none. */
    espnS2?: Credential & {
        savedAt?: string;
    };
    /** Anything the operator should fix, such as a file others can read. */
    warnings: string[];
}
/**
 * The credentials to use: each environment override, else the stored value.
 * Warns when other users on the machine can read `credentials.yaml`.
 */
export declare function loadCredentials(deps: Pick<Deps, "configDir" | "env">): Promise<Credentials>;
/** Only the credentials the environment gives, as when nothing is stored. */
export declare function envCredentials(env: Deps["env"]): Credentials;
/**
 * Adds a workspace to `config.yaml`'s list. A new file gets the defaults written
 * out, so they can be seen and edited; an existing one keeps everything as
 * written, comments included, gains `name` only if it has none, and changes
 * `spend_cap_usd` only when given one.
 */
export declare function listWorkspace(deps: Pick<Deps, "configDir">, entry: {
    name: string;
    slug: string;
    dir: string;
    spendCap?: number;
}): Promise<void>;
/**
 * Removes workspaces from `config.yaml`'s list, keeping the rest of the file
 * as written, comments included.
 */
export declare function dropWorkspaces(deps: Pick<Deps, "configDir">, slugs: string[]): Promise<void>;
/**
 * Sets `spend_cap_usd` in `config.yaml`, keeping the rest of the file as
 * written, comments included. A missing file gets the defaults written out.
 */
export declare function setSpendCap(deps: Pick<Deps, "configDir">, cap: number): Promise<void>;
/**
 * What's wrong with a credentials file's permission bits, and the fix, or
 * undefined when only its owning user can use it.
 */
export declare function exposure(path: string, mode: number): {
    message: string;
    fix: string;
} | undefined;
/**
 * Stores credentials in `credentials.yaml` at mode 0600, keeping any stored
 * value not given. A new `espn_s2` is dated today. Returns the file's path.
 */
export declare function saveCredentials(deps: Pick<Deps, "configDir" | "clock">, values: {
    anthropicApiKey?: string;
    espnS2?: string;
}): Promise<string>;
/** `2025-10`: the calendar month in local time that spend is counted under. */
export declare function spendMonth(d: Date): string;
/** The spend counted for `month` in `spend.yaml`: 0 with no file or entry. */
export declare function monthSpend(deps: Pick<Deps, "configDir">, month: string): Promise<number>;
/** Adds `usd` to `month` in `spend.yaml`, keeping every other month. */
export declare function addSpend(deps: Pick<Deps, "configDir">, month: string, usd: number): Promise<void>;
/** Reads `config.yaml`, or undefined if there is none. */
export declare function readConfig(deps: Pick<Deps, "configDir">): Promise<{
    format: 1;
    name?: string | undefined;
    model: string;
    spend_cap_usd: number;
    prices: Record<string, {
        input_per_mtok: number;
        output_per_mtok: number;
    }>;
    workspaces: Record<string, string>;
} | undefined>;
/**
 * Reads and parses one of the operator's YAML files. A missing file is undefined;
 * a file that doesn't parse, or has another format version, is refused with
 * its path and what to fix.
 */
export declare function readConfigFile<T>(path: string, schema: ZodType<T>): Promise<T | undefined>;
