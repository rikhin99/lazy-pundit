#!/usr/bin/env node
import { relative } from "node:path";
import { Command } from "@commander-js/extra-typings";
import {
  DraftExistsError,
  draft,
  FetchError,
  publish,
  systemDeps,
  WorkspaceFileError,
} from "./index.ts";

/** The `lazy-pundit` bin: it parses args and prints. The library does the rest. */
const program = new Command()
  .name("lazy-pundit")
  .description("Power rankings with checked stats for your fantasy league.")
  .showHelpAfterError();

const workspace = process.cwd();
const shown = (path: string) => relative(workspace, path) || path;

program
  .command("draft")
  .description("Fetch the league and start a draft for the last scored week.")
  .action(async () => {
    const result = await draft(workspace, systemDeps());
    console.log(
      `Drafted week ${result.week}: ${shown(result.path)} (snapshot ${result.snapshot})`,
    );
  });

program
  .command("publish")
  .description("Freeze the latest draft and write the plain text.")
  .action(async () => {
    const result = await publish(workspace, systemDeps());
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
