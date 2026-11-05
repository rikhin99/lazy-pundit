#!/usr/bin/env node
import { relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { intro, isCancel, log, outro, select, text } from "@clack/prompts";
import { Command } from "@commander-js/extra-typings";
import {
  ConfigFileError,
  check,
  checkLeague,
  type Deps,
  type DoctorCheck,
  DraftExistsError,
  defaultPunditName,
  deleteTranscripts,
  doctor,
  draft,
  FetchError,
  findWorkspace,
  type LeagueCheck,
  type PersonaRecord,
  type PlatformChoice,
  type Problem,
  platformStop,
  publish,
  punditNameProblem,
  refresh,
  SetupRefusal,
  setUpWorkspace,
  sleeperLeagues,
  systemDeps,
  WorkspaceFileError,
} from "./index.ts";

/** The `lazy-pundit` bin: it parses args, prompts and prints. The library does the rest. */
const program = new Command()
  .name("lazy-pundit")
  .description("Power rankings with checked stats for your fantasy league.")
  .option("--league <slug>", "act on this league's workspace from anywhere")
  .showHelpAfterError();

const cwd = process.cwd();
const shown = (path: string) => relative(cwd, path) || path;

/** The workspace `--league` names, or the one the current folder is in. */
function workspace(deps: Deps): Promise<string> {
  const { league } = program.opts();
  return findWorkspace(deps, { cwd, ...(league ? { league } : {}) });
}

const MARKS: Record<DoctorCheck["status"], string> = {
  ok: "✓",
  note: "·",
  warn: "!",
  fail: "✗",
};

const KINDS: Record<Problem["kind"], string> = {
  wrong: "wrong",
  stale: "stale",
  "unknown-id": "unknown ID",
  loose: "loose",
  unchecked: "unchecked",
  swear: "word list",
  "unreadable-tag": "unreadable tag",
  moved: "you moved this team",
  "small-sample": "small sample",
};

/** The problems list as the library ordered it: one line per item. */
function printProblems(problems: Problem[]): void {
  for (const p of problems) {
    const mark = p.severity === "hard" ? "✗" : "·";
    const cause = p.cause ? `, after a ${p.cause}` : "";
    const gate = p.gate ? ", gate failure" : "";
    if (p.line === null) {
      console.log(`  ${mark} ${p.section}: ${KINDS[p.kind]}: ${p.reason}`);
      continue;
    }
    console.log(
      `  ${mark} line ${p.line} ${p.section}: "${p.text}" ${KINDS[p.kind]}${cause}${gate}: ${p.reason}`,
    );
  }
}

/** A heading and the list, or a note that there's nothing to fix. */
function report(problems: Problem[]): void {
  if (problems.length === 0) {
    console.log("No problems.");
    return;
  }
  const hard = problems.filter((p) => p.severity === "hard").length;
  console.log(`Problems: ${hard} hard, ${problems.length - hard} soft`);
  printProblems(problems);
}

/**
 * Asks `question` and says whether the answer matches `yes`. Anything else,
 * including closed input as in a script, is the default answer: false.
 */
async function ask(question: string, yes: RegExp): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const closed = new Promise<string>((resolve) =>
    rl.once("close", () => resolve("")),
  );
  try {
    const answer = await Promise.race([rl.question(question), closed]);
    return yes.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Publish anyway / Back to editing, defaulting to Back to editing. */
function confirmPublish(): Promise<boolean> {
  return ask(
    "Publish anyway, or Back to editing? [p/B] ",
    /^p(ublish)?( anyway)?$/i,
  );
}

/** Publish with a relaxed family-league persona, defaulting to No. */
function confirmRelaxed(persona: PersonaRecord): Promise<boolean> {
  console.log(
    `The family league is on, and this draft's persona relaxes it: swearing ${persona.swearing}, teasing ${persona.teasing}.`,
  );
  return ask("Publish with it? [y/N] ", /^y(es)?$/i);
}

function printWarnings(warnings: string[]): void {
  for (const w of warnings) console.error(`${MARKS.warn} ${w}`);
}

program
  .command("draft")
  .description("Fetch the league and start a draft for the last scored week.")
  .action(async () => {
    const deps = systemDeps();
    const result = await draft(await workspace(deps), deps, {
      onWarnings: printWarnings,
    });
    if (result.fallback) console.error(`${MARKS.warn} ${result.fallback}`);
    console.log(
      `Drafted week ${result.week}: ${shown(result.path)} (snapshot ${result.snapshot})`,
    );
    report(result.problems);
  });

program
  .command("check")
  .description("Check the latest draft's claims and add tags to clear ones.")
  .action(async () => {
    const deps = systemDeps();
    const result = await check(await workspace(deps), deps);
    printWarnings(result.warnings);
    if (result.autoTagged > 0) {
      console.log(
        `Tagged ${result.autoTagged} claim${result.autoTagged === 1 ? "" : "s"} in ${shown(result.path)}.`,
      );
    }
    report(result.problems);
  });

program
  .command("refresh")
  .description(
    "Refetch the league and move the latest draft onto any new data, leaving your order and words.",
  )
  .action(async () => {
    const deps = systemDeps();
    const result = await refresh(await workspace(deps), deps);
    printWarnings(result.warnings);
    if (result.methodChanged) {
      console.log(
        "The draft recorded another power-score method or weights: its starting order now follows your settings.",
      );
    }
    if (result.changes.length === 0) {
      if (!result.methodChanged) {
        console.log(`No changes since ${result.dataAsOf}.`);
      }
    } else {
      console.log(
        `Data changed since ${result.dataAsOf}: week ${result.week} now stands on snapshot ${result.snapshot}.`,
      );
      if (result.newlyStale.length > 0) {
        console.log("Newly stale:");
        printProblems(result.newlyStale);
      }
    }
    report(result.problems);
  });

program
  .command("publish")
  .description("Check and freeze the latest draft and write the plain text.")
  .option(
    "-y, --yes",
    "publish even with hard problems or a relaxed family-league persona, without asking",
  )
  .action(async (opts) => {
    let asked = false;
    const deps = systemDeps();
    const result = await publish(await workspace(deps), deps, {
      yes: opts.yes ?? false,
      confirm: async (hard) => {
        asked = true;
        console.log("Hard problems:");
        printProblems(hard);
        return confirmPublish();
      },
      confirmRelaxed,
      onWarnings: printWarnings,
    });
    if (!result.published) {
      console.log(
        result.stoppedBy === "relaxed"
          ? "Not published, so nothing was written. Publish again to confirm, or lower the persona in persona.md and draft again."
          : "Back to editing; nothing was published.",
      );
      process.exitCode = 1;
      return;
    }
    const left = asked
      ? result.problems.filter((p) => p.severity === "soft")
      : result.problems;
    if (left.length > 0) report(left);
    console.log(`Published week ${result.week}:`);
    console.log(`  ${shown(result.publishedPath)}`);
    console.log(`  ${shown(result.textPath)}`);
    console.log(
      result.copied
        ? "Copied the text to the clipboard."
        : "No clipboard found; paste from the .txt file.",
    );
  });

program
  .command("transcripts")
  .description("Manage the workspace's LLM transcripts.")
  .command("delete")
  .description("Delete every LLM transcript in the workspace.")
  .action(async () => {
    const deps = systemDeps();
    const { path, files } = await deleteTranscripts(await workspace(deps));
    console.log(
      files > 0
        ? `Deleted ${files} LLM transcript${files === 1 ? "" : "s"} in ${shown(path)}.`
        : "No LLM transcripts to delete.",
    );
  });

/** The pundit cancelled a prompt, which ends setup rather than asking again. */
class SetupCancelled extends Error {}

/** A prompt's answer, or stops setup with nothing written if the pundit cancels. */
function answered<T>(answer: T): Exclude<T, symbol> {
  if (isCancel(answer)) {
    throw new SetupCancelled("Setup cancelled. Nothing was written.");
  }
  return answer as Exclude<T, symbol>;
}

/** The league ID the pundit picks from their Sleeper leagues, or types. */
async function askLeagueId(deps: Deps): Promise<string> {
  const accountName = answered(
    await text({
      message: "Your Sleeper username (leave empty to type a league ID)",
    }),
  )?.trim();
  if (accountName) {
    const leagues = await sleeperLeagues(deps, accountName);
    if (leagues.length === 0)
      log.warn(`${accountName} has no leagues this season.`);
    else {
      const picked = answered(
        await select({
          message: "Which league?",
          options: [
            ...leagues.map((l) => ({
              value: l.leagueId,
              label: `${l.name} (${l.season}, ${l.teams} teams)`,
            })),
            { value: "", label: "Type a league ID instead" },
          ],
        }),
      );
      if (picked) return picked;
    }
  }
  return answered(
    await text({
      message: "Sleeper league ID (the number in the league's URL)",
      validate: (v) => (v?.trim() ? undefined : "Enter the league ID."),
    }),
  ).trim();
}

/** Asks for a league until one passes the live fetch. */
async function askLeague(deps: Deps): Promise<LeagueCheck> {
  for (;;) {
    try {
      const leagueId = await askLeagueId(deps);
      log.info("Fetching the league from Sleeper…");
      return await checkLeague(deps, leagueId);
    } catch (err) {
      if (!(err instanceof SetupRefusal)) throw err;
      log.error(err.message);
    }
  }
}

program
  .command("init")
  .description("Set up a league, step by step.")
  .action(async () => {
    if (!process.stdin.isTTY) {
      throw new SetupRefusal("init asks questions, so run it in a terminal.");
    }
    const deps = systemDeps();
    intro("Lazy Pundit setup");
    const punditName = answered(
      await text({
        message: "Your pundit name",
        initialValue: (await defaultPunditName(deps)) ?? "",
        validate: (v) => punditNameProblem(v ?? ""),
      }),
    );
    const platform = answered(
      await select<PlatformChoice>({
        message: "Which platform is the league on?",
        options: [
          { value: "sleeper", label: "Sleeper" },
          { value: "espn", label: "ESPN" },
          { value: "yahoo", label: "Yahoo" },
        ],
      }),
    );
    const stop = platformStop(platform);
    if (stop) {
      outro(stop);
      return;
    }
    const league = await askLeague(deps);
    log.success(`${league.name}, ${league.season}: ${league.teams} teams.`);
    for (const warning of league.warnings) log.warn(warning);
    const dir = answered(
      await text({
        message: `Workspace folder (leave empty for a new one in ${deps.workspacesDir})`,
      }),
    )?.trim();
    const workspace = await setUpWorkspace(deps, {
      punditName,
      league,
      ...(dir ? { dir } : {}),
    });
    outro(
      `Workspace ready in ${workspace.dir}. Next: lazy-pundit --league ${workspace.slug} draft`,
    );
  });

program
  .command("doctor")
  .description("Check Node, your config and credentials, and each workspace.")
  .action(async () => {
    const result = await doctor(systemDeps());
    for (const c of result.checks) {
      console.log(`${MARKS[c.status]} ${c.subject}: ${c.message}`);
      if (c.fix) console.log(`    Fix: ${c.fix}`);
    }
    if (!result.ok) process.exitCode = 1;
  });

try {
  await program.parseAsync();
} catch (err) {
  if (
    err instanceof WorkspaceFileError ||
    err instanceof ConfigFileError ||
    err instanceof DraftExistsError ||
    err instanceof FetchError ||
    err instanceof SetupRefusal ||
    err instanceof SetupCancelled
  ) {
    console.error(err.message);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
