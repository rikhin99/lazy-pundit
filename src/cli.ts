#!/usr/bin/env node
import { relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "@commander-js/extra-typings";
import {
  check,
  DraftExistsError,
  draft,
  FetchError,
  type Problem,
  publish,
  systemDeps,
  WorkspaceFileError,
} from "./index.ts";

/** The `lazy-pundit` bin: it parses args, prompts and prints. The library does the rest. */
const program = new Command()
  .name("lazy-pundit")
  .description("Power rankings with checked stats for your fantasy league.")
  .showHelpAfterError();

const workspace = process.cwd();
const shown = (path: string) => relative(workspace, path) || path;

const KINDS: Record<Problem["kind"], string> = {
  wrong: "wrong",
  stale: "stale",
  "unknown-id": "unknown ID",
  loose: "loose",
  unchecked: "unchecked",
  swear: "word list",
  "unreadable-tag": "unreadable tag",
};

/** The problems list as the library ordered it: one line per item. */
function printProblems(problems: Problem[]): void {
  for (const p of problems) {
    const mark = p.severity === "hard" ? "✗" : "·";
    const cause = p.cause ? `, after a ${p.cause}` : "";
    console.log(
      `  ${mark} line ${p.line} ${p.section}: "${p.text}" ${KINDS[p.kind]}${cause}: ${p.reason}`,
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
 * Publish anyway / Back to editing, defaulting to Back to editing. Closed
 * input, as in a script, is Back to editing too.
 */
async function confirmPublish(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const closed = new Promise<string>((resolve) =>
    rl.once("close", () => resolve("")),
  );
  try {
    const answer = await Promise.race([
      rl.question("Publish anyway, or Back to editing? [p/B] "),
      closed,
    ]);
    return /^p(ublish)?( anyway)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

program
  .command("draft")
  .description("Fetch the league and start a draft for the last scored week.")
  .action(async () => {
    const result = await draft(workspace, systemDeps());
    console.log(
      `Drafted week ${result.week}: ${shown(result.path)} (snapshot ${result.snapshot})`,
    );
    report(result.problems);
  });

program
  .command("check")
  .description("Check the latest draft's claims and add tags to clear ones.")
  .action(async () => {
    const result = await check(workspace, systemDeps());
    if (result.autoTagged > 0) {
      console.log(
        `Tagged ${result.autoTagged} claim${result.autoTagged === 1 ? "" : "s"} in ${shown(result.path)}.`,
      );
    }
    report(result.problems);
  });

program
  .command("publish")
  .description("Check and freeze the latest draft and write the plain text.")
  .option("-y, --yes", "publish even with hard problems, without asking")
  .action(async (opts) => {
    let asked = false;
    const result = await publish(workspace, systemDeps(), {
      yes: opts.yes ?? false,
      confirm: async (hard) => {
        asked = true;
        console.log("Hard problems:");
        printProblems(hard);
        return confirmPublish();
      },
    });
    if (!result.published) {
      console.log("Back to editing; nothing was published.");
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

try {
  await program.parseAsync();
} catch (err) {
  if (
    err instanceof WorkspaceFileError ||
    err instanceof DraftExistsError ||
    err instanceof FetchError
  ) {
    console.error(err.message);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
