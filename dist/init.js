import { mkdir, readdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { stringify } from "yaml";
import { checkAnthropicKey } from "./anthropic.js";
import { defaultConfig, listWorkspace, loadCredentials, monthSpend, readConfig, saveCredentials, spendMonth, } from "./config.js";
import { FORMAT, WorkspaceFileError } from "./front-matter.js";
import { leagueFilePath } from "./league-file.js";
import { MAX_TOKENS } from "./llm-call.js";
import { GATE_RETRIES } from "./llm-gate.js";
import { validatorNames, } from "./lore.js";
import { PRESETS, personaPath } from "./persona.js";
import { ceilingCost, priceOf, usd } from "./prices.js";
import { DEFAULT_SETTINGS, punditSettingsPath } from "./pundit-settings.js";
import { fetchSleeper } from "./sleeper/fetcher.js";
import { sleeperLeagueKind, sleeperUserLeagues, } from "./sleeper/setup.js";
import { FetchError } from "./snapshot.js";
import { punditDir, readWorkspace, seasonDir, } from "./workspace.js";
import { writeGitignore, writeWorkspaceFile } from "./workspace-files.js";
/** A setup answer the tool can't go on with, said so the pundit can act on it. */
export class SetupRefusal extends Error {
    name = "SetupRefusal";
}
/** Why setup stops at this platform, or undefined if it can go on. */
export function platformStop(platform) {
    if (platform === "yahoo")
        return "Yahoo support comes in a later release.";
    if (platform === "espn")
        return "ESPN support comes in a later release.";
    return undefined;
}
/** What this version doesn't model about a league it still accepts. */
function leagueWarnings(settings) {
    const warnings = [];
    const noStatus = (what) => `This league uses ${what}, which this version doesn't model, so the league gets no playoff status: no team is called clinched or eliminated.`;
    if (settings.median)
        warnings.push(noStatus("median scoring"));
    if (settings.divisions > 0)
        warnings.push(noStatus("divisions"));
    if (settings.keepers !== null) {
        warnings.push(`This league has ${settings.keepers} rules, which this version doesn't model: rankings treat it as a redraft league.`);
    }
    return warnings;
}
/**
 * The league data step's live fetch: proves the league can be read, and says
 * what the tool can't model about it. Nothing is written.
 */
export async function checkLeague(deps, leagueId) {
    const kind = await sleeperLeagueKind(deps.transport, leagueId);
    if (kind === undefined) {
        throw new SetupRefusal(`Sleeper has no league with the ID ${leagueId}. Check it against the league's URL, or pick from your leagues by username.`);
    }
    if (kind.sport !== undefined && kind.sport !== "nfl") {
        throw new SetupRefusal(`This league's sport is ${kind.sport}, and Lazy Pundit ranks football leagues only.`);
    }
    if (!kind.pointValues) {
        throw new SetupRefusal("This league has no point values, as a categories or roto league wouldn't, and Lazy Pundit ranks only leagues scored by points.");
    }
    const { league } = await fetchSleeper({
        transport: deps.transport,
        clock: deps.clock,
        // Never written: this fetch's `write` isn't called.
        snapshotsDir: join(deps.cacheDir, "unused"),
        cacheDir: deps.cacheDir,
        leagueId,
    }).catch((err) => {
        if (err instanceof FetchError)
            throw err;
        throw new SetupRefusal(`Can't read Sleeper league ${leagueId}: ${err.message}`, { cause: err });
    });
    const teamList = league.teams.map((t) => ({
        id: t.id,
        name: t.name,
        managers: t.managers.map((m) => ({
            account: `${league.platform}:${m.accountId}`,
            displayName: m.displayName,
        })),
    }));
    return {
        platform: league.platform,
        leagueId: league.leagueId,
        name: league.name,
        season: league.season,
        teams: league.teams.length,
        warnings: leagueWarnings(league.settings),
        managers: teamList.flatMap((t) => t.managers),
        teamList,
    };
}
/**
 * The handles step's list: a handle for each manager, from their display name
 * and holding their account, so accepting it links what's in hand and guesses
 * nothing (ADR 0001).
 */
export function proposedHandles(league) {
    const taken = new Set();
    const proposed = [];
    for (const manager of new Map(league.managers.map((m) => [m.account, m])).values()) {
        const base = slugOf(manager.displayName) || "manager";
        let handle = base;
        for (let n = 2; taken.has(handle); n++)
            handle = `${base}-${n}`;
        taken.add(handle);
        proposed.push({ ...manager, handle });
    }
    return proposed;
}
/**
 * What's wrong with a handle, which a lore heading has to be able to name, or
 * undefined. `others` are the handles the rest of the list holds.
 */
export function handleProblem(handle, others) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) {
        return "A handle is lowercase letters, digits and dashes, so a lore heading can name it.";
    }
    if (others.includes(handle)) {
        return `Another manager already has the handle ${handle}.`;
    }
    return undefined;
}
/** The lore step's league types, the first preselected. */
export const LEAGUE_TYPE_CHOICES = [
    { value: "friends", label: "Friends" },
    { value: "family", label: "Family" },
    { value: "work", label: "Work" },
    { value: "other", label: "Other" },
];
/** Said at the lore step, before anything is asked, and kept atop `lore.md`. */
export const LORE_NOTICE = "Lore is sent to the LLM provider with each draft, and kept in this workspace's LLM transcripts until you run lazy-pundit transcripts delete. Don't write anything personal: no addresses, phone numbers, emails, birthdays or health.";
/**
 * The lore step's prefill: each team's name and its managers' display names,
 * leaving out any that would read as another team's, so accepting it never
 * makes a nickname clash.
 */
export function proposedNicknames(league, handles = []) {
    const proposed = league.teamList.map((t) => ({
        team: t.id,
        teamName: t.name,
        section: sectionFor(t, league, handles),
        nicknames: [],
    }));
    for (const [i, t] of league.teamList.entries()) {
        const entry = proposed[i];
        if (!entry)
            continue;
        const names = [t.name, ...t.managers.map((m) => m.displayName)];
        for (const name of new Set(names)) {
            if (nicknameShapeProblem(name))
                continue;
            entry.nicknames.push(name);
            if (nicknamesProblem(league, handles, proposed))
                entry.nicknames.pop();
        }
    }
    return proposed;
}
function sectionFor(team, league, handles) {
    const [only, ...more] = team.managers;
    const handle = handles.find((h) => h.account === only?.account);
    const teamsRun = league.teamList.filter((t) => t.managers.some((m) => m.account === handle?.account));
    return handle && more.length === 0 && teamsRun.length === 1
        ? `{manager=${handle.handle}}`
        : `{team=${team.id}}`;
}
/** A team's typed nicknames, separated by commas. */
export function nicknamesOf(typed) {
    return typed
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
}
function nicknameShapeProblem(name) {
    if (/[{},]/.test(name)) {
        return `"${name}" can't be a nickname: it holds a brace or a comma`;
    }
    return undefined;
}
/**
 * What's wrong with the lore step's nicknames, or undefined: one that holds a
 * brace or comma, or one that reads as two teams' names, as `lore.md` would
 * refuse to load.
 */
export function nicknamesProblem(league, handles, nicknames) {
    for (const t of nicknames) {
        for (const n of t.nicknames) {
            const problem = nicknameShapeProblem(n);
            if (problem)
                return problem;
        }
    }
    const lore = {
        sections: nicknames.map((t) => ({
            name: t.section.replace(/^\{(manager|team)=(.*)\}$/, "$1:$2"),
            line: 0,
            nicknames: t.nicknames,
            entries: [],
        })),
        localLines: [],
        warnings: [],
    };
    try {
        validatorNames(lore, leagueNames(league), linksOf(handles));
    }
    catch (err) {
        if (!(err instanceof WorkspaceFileError))
            throw err;
        return err.message.replace(/^lore\.md: /, "");
    }
    return undefined;
}
/** A checked league as lore's names read it. */
function leagueNames(league) {
    const accountId = (account) => account.slice(`${league.platform}:`.length);
    return {
        platform: league.platform,
        teams: league.teamList.map((t) => ({
            id: t.id,
            name: t.name,
            managers: t.managers.map((m) => ({
                accountId: accountId(m.account),
                displayName: m.displayName,
            })),
        })),
    };
}
/** The handles as `workspace.md`'s `handles:` links them. */
function linksOf(handles) {
    return Object.fromEntries(handles.map((h) => [h.handle, [h.account]]));
}
/** A name kept safe inside a Markdown comment: no tag and no comment end. */
function commentSafe(name) {
    return name.replace(/[{}]/g, "").replace(/--+/g, "-");
}
const LORE_COMMENT = `<!--
${LORE_NOTICE}
Lore is context for the prose, and the data still comes from the league.

Sections look like this:

## League
type: friends

## {manager=their-handle}
nicknames: Bo, The Boss
- Hasn't won a title since 2019.
-->`;
/** The answered lore step's \`lore.md\`. */
function loreText(answers, league) {
    const sections = answers.nicknames.map((t) => {
        const team = league.teamList.find((x) => x.id === t.team);
        const who = [
            t.teamName,
            ...(team?.managers.map((m) => m.displayName) ?? []),
        ].map(commentSafe);
        // With no nicknames, only a comment says whose section it is.
        return [
            `## ${t.section}`,
            t.nicknames.length > 0
                ? `nicknames: ${t.nicknames.join(", ")}`
                : `<!-- ${who.join(", ")} -->`,
        ].join("\n");
    });
    return `---
lore: 1
---

# Lore

${LORE_COMMENT}

## League
type: ${answers.type}

${sections.join("\n\n")}
`;
}
/** The stakes step's checklist of common house rules, each asked for its outcome. */
export const COMMON_HOUSE_RULES = [
    {
        id: "high-score",
        name: "Weekly high score",
        trigger: "high-score",
        per: "week",
    },
    {
        id: "low-score",
        name: "Weekly low score",
        trigger: "low-score",
        per: "week",
    },
    {
        id: "most-left-on-bench",
        name: "Most points left on the bench in a week",
        trigger: "most-left-on-bench",
        per: "week",
    },
    {
        id: "last-place",
        name: "Last place",
        trigger: "last-place",
        per: "season",
    },
];
/** The asking text of the stakes step's first question, default No. */
export const STAKES_QUESTION = "Is anything at stake besides bragging rights?";
/** The payouts when the pundit takes the default: winner takes all. */
export const WINNER_TAKES_ALL = ["100%"];
/** Whether the family league starts on: only for a family league type. */
export function familyLeagueDefault(type) {
    return type === "family";
}
const DOLLARS = /^\d+(?:\.\d{1,2})?$/;
/** What's wrong with a typed buy-in, or undefined. */
export function buyInProblem(typed) {
    return DOLLARS.test(typed.trim())
        ? undefined
        : "The buy-in is a number of dollars per team, such as 50.";
}
/** The typed payouts, one per place, first place first. */
export function payoutsOf(typed) {
    return typed
        .split(",")
        .map((p) => p.trim().replace(/\s+/g, ""))
        .filter(Boolean);
}
/**
 * What's wrong with typed payouts, or undefined: each place's payout is `$N`
 * or `N%` of the pot, and the shares come to 100% at most.
 */
export function payoutsProblem(typed) {
    const payouts = payoutsOf(typed);
    if (payouts.length === 0) {
        return "Give each place's payout, first place first, such as 70%, 30%.";
    }
    let shares = 0;
    for (const p of payouts) {
        const share = /^(\d+(?:\.\d+)?)%$/.exec(p)?.[1];
        if (share !== undefined)
            shares += Number(share);
        else if (!/^\$\d+(?:\.\d{1,2})?$/.test(p)) {
            return `"${p}" isn't a payout: give dollars, such as $100, or a share of the pot, such as 70%.`;
        }
    }
    return shares > 100
        ? `The shares come to ${shares}%, more than the whole pot (100%).`
        : undefined;
}
/** What's wrong with a typed house rule outcome, or undefined. */
export function outcomeProblem(typed) {
    if (!typed.trim()) {
        return "Write the outcome: dollars such as $10, FAAB such as 5 FAAB, or anything in words.";
    }
    if (/[{}]/.test(typed))
        return "An outcome can't hold a brace.";
    return undefined;
}
/** The answered stakes step's `league.md`, or its placeholder when skipped. */
export function leagueText(season, answers, 
/** The family league to write; a skipped re-run passes the one recorded. */
familyLeague = answers?.familyLeague ?? false) {
    const stakes = answers?.stakes;
    const fields = stakes === undefined
        ? `# Stakes aren't recorded. Write stakes: none for bragging rights only, or
# buy-in: $50, payouts: ["70%", "30%"] and house-rules for what's played for.
`
        : stringify(stakes === "none"
            ? { stakes: "none" }
            : {
                "buy-in": `$${stakes.buyIn}`,
                payouts: stakes.payouts,
                ...(stakes.houseRules.length === 0
                    ? {}
                    : {
                        "house-rules": stakes.houseRules.map(({ rule, outcome }) => ({
                            id: rule.id,
                            name: rule.name,
                            trigger: rule.trigger,
                            per: rule.per,
                            outcome: outcome.trim(),
                        })),
                    }),
            });
    return `---
league: 1
season: "${season}"
# On keeps every persona clean, whatever it asks for.
family-league: ${familyLeague ? "on" : "off"}
${fields}---

<!--
This season's stakes belong here, not in lore. Like lore, what's written here is
sent to the LLM provider, so don't write anything personal, and nothing here
records who has paid.
-->
`;
}
/** Lowercase letters, digits and dashes, from any name. */
function slugOf(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
/** The name `config.yaml` gives the operator, the pundit name step's default. */
export async function defaultPunditName(deps) {
    return (await readConfig(deps))?.name;
}
/** The NFL season a date falls in: January and February finish last year's. */
function seasonAt(date) {
    const year = date.getFullYear();
    return String(date.getMonth() < 2 ? year - 1 : year);
}
/** The league data step's pick list: a Sleeper account's leagues this season. */
export async function sleeperLeagues(deps, accountName) {
    const leagues = await sleeperUserLeagues(deps.transport, accountName, seasonAt(deps.clock.now()));
    if (leagues === undefined) {
        throw new SetupRefusal(`Sleeper has no account named ${accountName}.`);
    }
    return leagues;
}
/** What's wrong with a pundit name, which has to give a slug, or undefined. */
export function punditNameProblem(name) {
    return slugOf(name) === ""
        ? "A pundit name needs at least a letter or digit."
        : undefined;
}
/** Refuses a league one of these folders already holds a workspace for. */
async function refuseLeagueInWorkspace(dirs, leagueId, pundit) {
    for (const dir of dirs) {
        // A listed workspace that can't be read is `doctor`'s to report.
        const ws = await readWorkspace(dir).catch((err) => {
            if (err instanceof WorkspaceFileError)
                return undefined;
            throw err;
        });
        if (ws?.season.leagueId !== leagueId)
            continue;
        throw new SetupRefusal(ws.pundit === pundit
            ? `This league is already set up in ${dir}.`
            : `This league's workspace in ${dir} belongs to ${ws.pundit}, and multi-pundit is a later stage.`);
    }
}
/** The league's slug, numbered if another league's workspace has it. */
function freeSlug(listed, leagueName) {
    const base = slugOf(leagueName) || "league";
    let slug = base;
    for (let n = 2; slug in listed; n++)
        slug = `${base}-${n}`;
    return slug;
}
function folderRefusal(dir, cause) {
    return new SetupRefusal(`Can't use ${dir} for this league's workspace (${cause.code}). Choose another folder.`, { cause });
}
/** Refuses a folder with anything in it. A missing one is fine. */
async function refuseFolderInUse(dir) {
    const entries = await readdir(dir).catch((err) => {
        if (err.code === "ENOENT")
            return [];
        throw folderRefusal(dir, err);
    });
    if (entries.length > 0) {
        throw new SetupRefusal(`${dir} isn't empty. Choose a new folder for this league's workspace.`);
    }
}
/** The method step's choices, the default first so one key accepts it. */
export const METHOD_CHOICES = [
    { value: "ramped-blend", label: "Ramped blend (the default)" },
    { value: "standings", label: "Standings" },
    { value: "ppg", label: "Points per game" },
    { value: "all-play", label: "All-play record" },
    { value: "form", label: "Form" },
    { value: "ffwrapped", label: "The ffwrapped formula" },
    { value: "ffmwr", label: "The FFMWR rank average" },
];
const LORE_PLACEHOLDER = `---
lore: 1
---

# Lore

${LORE_COMMENT}
`;
/**
 * `persona.md` with this preset. Its explanation goes in YAML comments, since
 * all of the body is the style note, sent with every draft.
 */
export function personaText(preset) {
    return `---
format: ${FORMAT}
# The preset: broadcast, family, banter or roast. Any of its controls can be
# overridden here: swearing (off, mild, on), teasing (none, light, roast),
# formality (formal, casual, unhinged), shape (prose, bullets), length (2-3,
# or one number of sentences) and intro (on, off).
# Anything written below the front matter is your style note, sent with every draft.
preset: ${preset}
---
`;
}
/** The persona step's preselection, from the lore's league type. */
export function personaDefault(type) {
    if (type === "family")
        return "family";
    if (type === "friends")
        return "banter";
    return "broadcast";
}
/**
 * What the family league lowers in a preset, said at the persona step, or
 * undefined when it lowers nothing: swearing to off, teasing to light.
 */
export function familyLeagueLowers(preset, familyLeague) {
    if (!familyLeague)
        return undefined;
    const { name, swearing, teasing } = PRESETS[preset];
    const lowered = [
        ...(swearing === "off" ? [] : ["swearing to off"]),
        ...(teasing === "roast" ? ["teasing to light"] : []),
    ];
    return lowered.length === 0
        ? undefined
        : `The family league lowers ${name}'s ${lowered.join(" and ")}.`;
}
/**
 * The files the steps after the league data leave: the pundit settings, and the
 * lore, stakes and persona placeholders a pundit can fill in by hand. A settings
 * file naming no method reads as the default.
 */
async function writeStepFiles(ws, league, answers) {
    await mkdir(punditDir(ws), { recursive: true });
    await mkdir(seasonDir(ws), { recursive: true });
    await writeWorkspaceFile(punditSettingsPath(ws), settingsText(answers.method));
    await writeWorkspaceFile(join(ws.dir, "lore.md"), loreFileText(answers.lore, league), { versionKey: "lore" });
    await writeWorkspaceFile(leagueFilePath(ws), leagueText(league.season, answers.stakes), { versionKey: "league" });
    await writeWorkspaceFile(personaPath(ws), personaText(answers.persona ?? "broadcast"));
}
/** The method step's pundit settings: a file naming no method reads as the default. */
export function settingsText(method) {
    const chosen = method === undefined || method === DEFAULT_SETTINGS.method
        ? ""
        : `method: ${method}\n`;
    return `---
format: ${FORMAT}
# method: ${METHOD_CHOICES.map((c) => c.value).join(", ")}. With none, ${DEFAULT_SETTINGS.method}.
${chosen}---
`;
}
/** The lore step's `lore.md`, or its placeholder when skipped. */
export function loreFileText(answers, league) {
    return answers ? loreText(answers, league) : LORE_PLACEHOLDER;
}
/** Broadcast, the persona with no `persona.md`, is the default. */
export function personaStatus(preset) {
    if (preset === undefined)
        return "skipped";
    return preset === "broadcast" ? "default" : "done";
}
export function methodStatus(method) {
    if (method === undefined)
        return "skipped";
    return method === DEFAULT_SETTINGS.method ? "default" : "done";
}
/**
 * The setup checklist, in the order `init` asks the steps. `workspace.md`
 * records how each league-level step went, and any step it doesn't name reads
 * as skipped. The key and cap belong to the operator, so they read as they
 * stand now, whichever league set them.
 */
export async function setupChecklist(deps, dir) {
    const { setup } = await readWorkspace(dir);
    const { askKey, spendCap } = await operatorSteps(deps);
    const hasKey = !askKey;
    const { spend_cap_usd } = defaultConfig();
    return [
        { step: "pundit name", status: "done" },
        { step: "league data", status: "done" },
        { step: "handles", status: setup.handles ?? "skipped" },
        { step: "lore", status: setup.lore ?? "skipped" },
        { step: "stakes", status: setup.stakes ?? "skipped" },
        { step: "method", status: setup.method ?? "skipped" },
        { step: "key", status: hasKey ? "done" : "skipped" },
        { step: "cap", status: spendCap === spend_cap_usd ? "default" : "done" },
        { step: "persona", status: setup.persona ?? "skipped" },
    ];
}
/**
 * Where a league's workspace would go: its slug and folder, or the refusal
 * `setUpWorkspace` would give. Nothing is written, so the wizard can say so
 * right after the folder question rather than after every other step.
 */
export async function checkWorkspace(deps, answers) {
    const { league } = answers;
    const name = answers.punditName.trim();
    const nameProblem = punditNameProblem(name);
    if (nameProblem !== undefined)
        throw new SetupRefusal(nameProblem);
    if (answers.dir !== undefined && !isAbsolute(answers.dir)) {
        throw new SetupRefusal(`Give the workspace's full path, such as ${join(deps.workspacesDir, "my-league")}, not ${answers.dir}.`);
    }
    const listed = (await readConfig(deps))?.workspaces ?? {};
    const slug = freeSlug(listed, league.name);
    const dir = answers.dir ?? join(deps.workspacesDir, slug);
    await refuseLeagueInWorkspace([...Object.values(listed), dir], league.leagueId, slugOf(name));
    await refuseFolderInUse(dir);
    return { slug, dir };
}
/**
 * The operator's steps are asked only when missing. The key is missing with
 * none stored or in the environment. The cap always has a value once
 * `config.yaml` exists, so it's asked with no config, or alongside a key still
 * to come, when it first starts to matter.
 */
export async function operatorSteps(deps) {
    const config = await readConfig(deps);
    const askKey = !(await loadCredentials(deps)).anthropicApiKey;
    return {
        askKey,
        askCap: askKey || config === undefined,
        spendCap: (config ?? defaultConfig()).spend_cap_usd,
    };
}
/** Said at the key step, before asking. */
export const KEY_EXPLANATION = "An Anthropic key lets the LLM write your blurbs. It's stored on this machine, never in a workspace. Claude Pro doesn't include API credits; Max and Ultra do.";
/** Said when the key step is skipped. */
export const KEY_SKIPPED = "With no key, each draft is stat lines and says why. Add one later with ANTHROPIC_API_KEY or credentials.yaml.";
/** Said when the handles step is skipped. */
export const HANDLES_SKIPPED = "With no handles, manager sections in the lore aren't sent until their handles are linked. Team sections still are.";
/**
 * Checks a key live, which spends nothing. A `problem` means Anthropic refused
 * it, so ask again. A `warning` means it couldn't be checked, so it's kept.
 */
export async function checkKey(deps, key) {
    const answer = await checkAnthropicKey(deps.transport, key);
    if (answer === "ok")
        return {};
    if (answer === "rejected") {
        return { problem: "Anthropic refused that key. Check it and try again." };
    }
    return {
        warning: `The key is saved, but Lazy Pundit couldn't check it (${answer.unreachable}). lazy-pundit doctor checks it again.`,
    };
}
/** What's wrong with a typed spend cap, or undefined. */
export function spendCapProblem(typed) {
    return /^\d+(\.\d+)?$/.test(typed.trim()) &&
        Number.isFinite(Number(typed.trim()))
        ? undefined
        : "Give the spend cap as a number of US dollars, such as 5.";
}
/**
 * Said for a cap so small that one call can't fit under it: a call's check
 * counts its whole `MAX_TOKENS` reply, before any of its prompt.
 */
export async function spendCapWarning(deps, cap) {
    const { model, least } = await callCeiling(deps);
    if (least === undefined || cap >= least)
        return undefined;
    return `One LLM call on ${model} can cost more than ${usd(least)}, so under a spend cap of ${usd(cap)} every draft falls back to stat lines.`;
}
/**
 * Said at the cap step when it's re-run: this month's spend so far, the cap,
 * and what one draft can ask of it, so the new cap leaves room for a draft.
 */
export async function spendCapNote(deps) {
    const config = (await readConfig(deps)) ?? defaultConfig();
    const spent = await monthSpend(deps, spendMonth(deps.clock.now()));
    const { model, least } = await callCeiling(deps);
    const ceiling = least === undefined
        ? `${model} has no price, so no LLM call is made.`
        : `One LLM call on ${model} can cost more than ${usd(least)}, and a draft makes up to ${1 + GATE_RETRIES}.`;
    return `This month's spend is ${usd(spent)} of a ${usd(config.spend_cap_usd)} spend cap. ${ceiling}`;
}
/** The model and the least one call is checked against: its whole `MAX_TOKENS` reply. */
async function callCeiling(deps) {
    const config = (await readConfig(deps)) ?? defaultConfig();
    const price = priceOf(config);
    if (price === undefined)
        return { model: config.model };
    return {
        model: config.model,
        least: ceilingCost(price, {
            system: "",
            prompt: "",
            maxTokens: MAX_TOKENS,
        }),
    };
}
/** Everything `setUpWorkspace` writes in the workspace, which a failure takes back. */
const WRITTEN = [
    "workspace.md",
    ".gitignore",
    ".snapshots",
    "lore.md",
    "pundits",
    "seasons",
];
/**
 * Writes a checked league's workspace and lists it in `config.yaml`, last, so
 * the list never names a half-made workspace. Everything that can be refused
 * is refused first, and a failed write takes back what it had written. Any
 * file `writeStepFiles` adds goes in `WRITTEN`.
 */
export async function setUpWorkspace(deps, answers) {
    const { league } = answers;
    const handles = answers.handles ?? [];
    for (const [i, { handle }] of handles.entries()) {
        const others = handles.slice(0, i).map((h) => h.handle);
        const problem = handleProblem(handle, others);
        if (problem !== undefined)
            throw new SetupRefusal(problem);
    }
    if (answers.lore) {
        const problem = nicknamesProblem(league, handles, answers.lore.nicknames);
        if (problem !== undefined)
            throw new SetupRefusal(problem);
    }
    const fields = answers.stakes?.stakes;
    if (fields !== undefined && fields !== "none") {
        const problem = buyInProblem(String(fields.buyIn)) ??
            payoutsProblem(fields.payouts.join(",")) ??
            fields.houseRules.map((r) => outcomeProblem(r.outcome)).find(Boolean);
        if (problem !== undefined)
            throw new SetupRefusal(problem);
    }
    if (answers.spendCap !== undefined &&
        spendCapProblem(String(answers.spendCap)) !== undefined) {
        throw new SetupRefusal(`A spend cap of ${answers.spendCap} can't be written: ${spendCapProblem(String(answers.spendCap))}`);
    }
    const { slug, dir } = await checkWorkspace(deps, answers);
    // A credentials file that can't be read would refuse the key after the
    // listing, so it stops here, before anything is written.
    if (answers.key)
        await loadCredentials(deps);
    const name = answers.punditName.trim();
    const pundit = slugOf(name);
    const setup = {
        handles: handles.length === 0 ? "skipped" : "done",
        lore: answers.lore ? "done" : "skipped",
        stakes: answers.stakes ? "done" : "skipped",
        method: methodStatus(answers.method),
        persona: personaStatus(answers.persona),
    };
    const firstMade = await mkdir(dir, { recursive: true }).catch((err) => {
        throw folderRefusal(dir, err);
    });
    try {
        await mkdir(join(dir, ".snapshots"));
        await writeWorkspaceFile(join(dir, "workspace.md"), `---
format: ${FORMAT}
pundit: ${pundit}
seasons:
  ${league.season}:
    platform: sleeper
    league_id: "${league.leagueId}"
${handles.length === 0
            ? ""
            : stringify({
                handles: Object.fromEntries(handles.map((h) => [h.handle, [h.account]])),
            })}${stringify({ setup })}---

# ${league.name}
`, { exclusive: true });
        await writeStepFiles(await readWorkspace(dir), league, answers);
        await writeGitignore(join(dir, ".snapshots"), "*");
        // The snapshot folder's own `*` ignores itself, so a clone wouldn't have it;
        // and `transcripts delete` removes its folder. The root's lines outlive both.
        await writeGitignore(dir, ".snapshots/", "transcripts/");
        await listWorkspace(deps, {
            name,
            slug,
            dir,
            ...(answers.spendCap === undefined ? {} : { spendCap: answers.spendCap }),
        });
    }
    catch (err) {
        for (const entry of WRITTEN) {
            await rm(join(dir, entry), { recursive: true, force: true });
        }
        if (firstMade !== undefined) {
            await rm(firstMade, { recursive: true, force: true });
        }
        throw err;
    }
    // The key is the operator's, not the workspace's, so it's saved once the
    // workspace is listed. Saved first, a listing that failed would keep the key
    // and lose the cap: the next `init` asks the cap only with a key to come.
    if (answers.key) {
        await saveCredentials(deps, { anthropicApiKey: answers.key });
    }
    return { slug, dir };
}
//# sourceMappingURL=init.js.map