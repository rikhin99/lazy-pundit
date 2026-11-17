import { stat } from "node:fs/promises";
import { join } from "node:path";
import { checkAnthropicKey } from "./anthropic.js";
import { configPath, credentialsPath, dropWorkspaces, envCredentials, exposure, loadCredentials, readConfig, readConfigFile, spendPath, spendSchema, } from "./config.js";
import { checkEspnCookie } from "./espn/fetcher.js";
import { ESPN_ENV_FIX, SETUP_ESPN_FIX } from "./refresh.js";
import { readWorkspace } from "./workspace.js";
/** The oldest Node this build runs on, as `engines` in package.json says. */
const NODE_MAJOR = 24;
/** An `espn_s2` cookie this many months old is near its end. */
const COOKIE_MONTHS = 11;
/**
 * Checks the operator's setup: Node, each of their files, each credential
 * with one live call, and every workspace `config.yaml` lists. A listed
 * folder that has gone is dropped from the list; no folder is ever touched.
 */
export async function doctor(deps) {
    const checks = [nodeCheck(deps.env.nodeVersion)];
    let config;
    try {
        config = await readConfig(deps);
        checks.push(config
            ? { subject: "config.yaml", status: "ok", message: configPath(deps) }
            : {
                subject: "config.yaml",
                status: "warn",
                message: `No config.yaml in ${deps.configDir}.`,
                fix: "Run: lazy-pundit init",
            });
    }
    catch (err) {
        checks.push({
            subject: "config.yaml",
            status: "fail",
            message: err.message,
            fix: `Fix ${configPath(deps)} as the message says.`,
        });
    }
    const credentials = await credentialsCheck(deps, checks);
    checks.push(await spendCheck(deps));
    checks.push(await anthropicCheck(deps, credentials));
    checks.push(await espnCheck(deps, credentials, config));
    if (config)
        checks.push(...(await workspaceChecks(deps, config)));
    checks.push(await clipboardCheck(deps));
    return { checks, ok: checks.every((c) => c.status !== "fail") };
}
function nodeCheck(version) {
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
async function credentialsCheck(deps, checks) {
    const path = credentialsPath(deps);
    const subject = "credentials.yaml";
    try {
        const credentials = await loadCredentials(deps);
        const mode = await modeOf(path);
        const open = mode === undefined ? undefined : exposure(path, mode);
        if (mode === undefined) {
            checks.push({ subject, status: "ok", message: "No stored credentials." });
        }
        else if (open) {
            checks.push({ subject, status: "warn", ...open });
        }
        else {
            checks.push({ subject, status: "ok", message: `${path} (mode 0600)` });
        }
        return credentials;
    }
    catch (err) {
        checks.push({
            subject,
            status: "fail",
            message: err.message,
            fix: `Fix ${path} as the message says, or delete it and run lazy-pundit setup key again.`,
        });
        return envCredentials(deps.env);
    }
}
async function spendCheck(deps) {
    const subject = "spend.yaml";
    try {
        const spend = await readConfigFile(spendPath(deps), spendSchema);
        return {
            subject,
            status: "ok",
            message: spend ? spendPath(deps) : "No LLM spend recorded yet.",
        };
    }
    catch (err) {
        return {
            subject,
            status: "fail",
            message: err.message,
            fix: `Fix ${spendPath(deps)} as the message says. Deleting it forgets this month's spend.`,
        };
    }
}
async function anthropicCheck(deps, credentials) {
    const subject = "Anthropic key";
    const key = credentials.anthropicApiKey;
    if (!key) {
        return {
            subject,
            status: "note",
            message: "No Anthropic key, so drafts get stat lines instead of LLM blurbs.",
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
            fix: key.from === "env"
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
 * The cookie, or its absence, checked live with one request for the first
 * listed workspace's league on ESPN, if there is one, and then by its age.
 * A public league reads with any cookie or none, so it proves only that the
 * league can be read.
 */
async function espnCheck(deps, credentials, config) {
    const subject = "ESPN cookie";
    const cookie = credentials.espnS2;
    const fromEnv = cookie?.from === "env";
    const which = !cookie
        ? "no cookie"
        : fromEnv
            ? "LAZY_PUNDIT_ESPN_S2"
            : "the stored cookie";
    const league = config && (await firstEspnLeague(config));
    let accepted;
    if (league) {
        const answer = await checkEspnCookie(deps.transport, cookie?.value, league);
        if (answer === "rejected") {
            return {
                subject,
                status: "fail",
                message: !cookie
                    ? `ESPN league ${league.leagueId} is private, and no cookie is stored.`
                    : `ESPN rejected ${which}${fromEnv ? "" : ` (saved ${cookie.savedAt})`} for league ${league.leagueId}.`,
                fix: fromEnv ? ESPN_ENV_FIX : SETUP_ESPN_FIX,
            };
        }
        if (answer === "no league") {
            return {
                subject,
                status: "warn",
                message: `Couldn't check ${which}: ESPN has no league ${league.leagueId} in ${league.season}.`,
                fix: `Check league_id in ${join(league.dir, "workspace.md")} against the league's URL.`,
            };
        }
        if (answer !== "ok") {
            return {
                subject,
                status: "warn",
                message: `Couldn't check ${which}: ${answer.unreachable}.`,
                fix: "Check your connection and run lazy-pundit doctor again.",
            };
        }
        accepted = !cookie
            ? `ESPN read league ${league.leagueId} with no cookie: it's public.`
            : `ESPN accepted ${which}${fromEnv ? "" : ` (saved ${cookie.savedAt})`} for league ${league.leagueId}.`;
    }
    if (!cookie) {
        return {
            subject,
            status: "ok",
            message: accepted ?? "None stored; only private ESPN leagues need one.",
        };
    }
    if (cookie.savedAt === undefined) {
        return {
            subject,
            status: "ok",
            message: accepted ?? "From LAZY_PUNDIT_ESPN_S2.",
        };
    }
    const [y, m, d] = cookie.savedAt.split("-").map(Number);
    const renewBy = new Date(y, m - 1 + COOKIE_MONTHS, d);
    if (deps.clock.now() >= renewBy) {
        return {
            subject,
            status: "warn",
            message: `The espn_s2 cookie was saved ${cookie.savedAt}, over ${COOKIE_MONTHS} months ago, and may stop working soon.`,
            fix: SETUP_ESPN_FIX,
        };
    }
    return {
        subject,
        status: "ok",
        message: accepted ?? `Saved ${cookie.savedAt}.`,
    };
}
/** The first listed workspace's league on ESPN; one that can't be read is skipped. */
async function firstEspnLeague(config) {
    for (const dir of Object.values(config.workspaces)) {
        const ws = await readWorkspace(dir).catch(() => undefined);
        if (ws?.season.platform === "espn") {
            return { leagueId: ws.season.leagueId, season: ws.season.year, dir };
        }
    }
    return undefined;
}
/**
 * Each listed workspace's `workspace.md`. A folder that no longer exists is
 * dropped from `config.yaml` with a note; nothing in any folder is touched.
 */
async function workspaceChecks(deps, config) {
    const checks = [];
    const gone = [];
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
        }
        catch (err) {
            checks.push({
                subject,
                status: "fail",
                message: err.message,
                fix: `Fix workspace.md in ${dir}, or remove "${slug}" from ${configPath(deps)}.`,
            });
        }
    }
    if (gone.length > 0)
        await dropWorkspaces(deps, gone);
    return checks;
}
async function clipboardCheck(deps) {
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
async function isGone(path) {
    try {
        await stat(path);
        return false;
    }
    catch (err) {
        return err.code === "ENOENT";
    }
}
/** A path's permission bits, or undefined if nothing is there. */
async function modeOf(path) {
    try {
        return (await stat(path)).mode & 0o777;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=doctor.js.map