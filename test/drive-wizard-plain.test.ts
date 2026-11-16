import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";

const SCRIPT = join(
  import.meta.dirname,
  "..",
  "scripts",
  "drive-wizard-plain.sh",
);

/** The plain filter's output for a raw run, as drive-wizard.exp prints it. */
function plain(raw: string): string {
  const run = spawnSync("bash", [SCRIPT, "--filter"], {
    input: raw,
    encoding: "utf8",
  });
  expect(run.status).toBe(0);
  return run.stdout;
}

test("the plain filter keeps answered prompts, every line of a log line, success lines and the end, and drops redraws", () => {
  const raw = [
    "\x1b[?25l\x1b[2K◆  Your pundit name",
    "│  Rik_",
    "◇  Your pundit name",
    "│  Rikhin",
    "│",
    "●  To change an answer, run one command.",
    "│  To change the folder, run another.",
    "│",
    "◆  Fear The Turtle, 2025: 12 teams.",
    "│",
    "▲  lore.md differs from what this step writes:",
    "│  -## Running jokes",
    "│",
    "◆  Workspace folder",
    "│  _",
    "└  Done.",
    "WROTE lazy-pundit/fear-the-turtle",
    "HOME /tmp/home",
    "EXIT 0",
  ]
    .map((line) => `${line}\r\n`)
    .join("");

  expect(plain(raw)).toBe(
    [
      "◇  Your pundit name",
      "│  Rikhin",
      "●  To change an answer, run one command.",
      "│  To change the folder, run another.",
      "◆  Fear The Turtle, 2025: 12 teams.",
      "▲  lore.md differs from what this step writes:",
      "│  -## Running jokes",
      "└  Done.",
      "WROTE lazy-pundit/fear-the-turtle",
      "HOME /tmp/home",
      "EXIT 0",
      "",
    ].join("\n"),
  );
});

test("a log line with a blank line inside keeps every line after it, up to the bare line that ends it", () => {
  const raw = [
    "●  To copy your espn_s2 cookie:",
    "│    1. Open the league.",
    "│",
    "│       ┌ Cookies ┐",
    "│",
    "│  It's kept in credentials.yaml.",
    "│",
    "◆  espn_s2 cookie",
    "│  _",
    "◇  espn_s2 cookie",
    "│  ▪▪▪▪",
    "EXIT 0",
  ]
    .map((line) => `${line}\r\n`)
    .join("");

  expect(plain(raw)).toBe(
    [
      "●  To copy your espn_s2 cookie:",
      "│    1. Open the league.",
      "│",
      "│       ┌ Cookies ┐",
      "│",
      "│  It's kept in credentials.yaml.",
      "◇  espn_s2 cookie",
      "│  ▪▪▪▪",
      "EXIT 0",
      "",
    ].join("\n"),
  );
});
