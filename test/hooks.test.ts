import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");

// A made-up denylist, so the denylist checks run where the real one is absent (CI).
const TMP = mkdtempSync(join(tmpdir(), "lazy-pundit-denylist-"));
const DENYLIST = join(TMP, "denylist.txt");
writeFileSync(DENYLIST, "# made up\nZorblax\nQuix\nThe Mob Squad\nrikhin99\n");
const BODY = join(TMP, "body.md");
writeFileSync(BODY, "Week 8: The Mob Squad cashed in.\n");

/**
 * One input each hook in `.claude/settings.json` must refuse. A hook the
 * harness can't run (not executable, say) fails without blocking anything, so
 * each is run here as the harness runs it: as a program, not through `sh`.
 */
const REFUSED: Record<string, object> = {
  "edit-with-edit.sh": {
    tool_name: "Bash",
    tool_input: { command: "sed -i '' 's/a/b/' src/cli.ts" },
  },
  "ticket-brief.sh": {
    tool_name: "Bash",
    tool_input: { command: "gh issue view 71 --comments" },
  },
  "commit-message-file.sh": {
    tool_name: "Bash",
    tool_input: {
      command:
        "cat > /tmp/msg.txt <<'EOF'\nA message\nEOF\ngit commit -F /tmp/msg.txt",
    },
  },
  "read-by-outline.sh": {
    tool_name: "Read",
    tool_input: { file_path: join(ROOT, "GLOSSARY.md") },
  },
  "denylist-gh.sh": {
    tool_name: "Bash",
    tool_input: { command: "gh issue comment 96 --body 'Zorblax won'" },
  },
};

/** Runs a hook as the harness does, on a Bash command. */
function runHook(hook: string, command: string, denylist = DENYLIST) {
  return spawnSync(join(ROOT, ".claude", "hooks", hook), {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, DENYLIST: denylist },
    encoding: "utf8",
  });
}

/** Each hook command's script, as a path under `.claude/hooks/`. */
function hooks(): string[] {
  const settings = JSON.parse(
    readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"),
  ) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  const commands = Object.values(settings.hooks).flatMap((matchers) =>
    matchers.flatMap((m) => m.hooks.map((h) => h.command)),
  );
  return [
    ...new Set(
      commands.map((c) =>
        c.replace('"$CLAUDE_PROJECT_DIR"/.claude/hooks/', ""),
      ),
    ),
  ];
}

describe("the repo's hooks", () => {
  test("each one has an input it refuses", () => {
    expect(hooks().sort()).toEqual(Object.keys(REFUSED).sort());
  });

  test.each(hooks())("%s runs as a program and refuses its input", (hook) => {
    const run = spawnSync(join(ROOT, ".claude", "hooks", hook), {
      input: JSON.stringify(REFUSED[hook]),
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, DENYLIST },
      encoding: "utf8",
    });

    expect(run.error).toBeUndefined();
    expect(run.status).toBe(2);
    expect(run.stderr).not.toBe("");
  });

  // In #76, `grep -n -E 'logKey|^' src/stakes.ts` printed every line (4.8k).
  test.each([
    ["grep -n -E 'logKey|^' src/stakes.ts", 2],
    ["grep -n -E 'logKey||lastPublished' src/stakes.ts", 2],
    ["grep -n -E '.*|logKey' src/stakes.ts", 2],
    ["grep -n -E 'logKey|lastPublished' src/stakes.ts || true", 0],
    ["grep -n -E '^export|^function' src/stakes.ts", 0],
  ])("read-by-outline.sh on %s exits %i", (command, status) => {
    expect(runHook("read-by-outline.sh", command).status).toBe(status);
  });

  // In #96 a tester's name turned up in issue edit history and main's history.
  test.each([
    [`gh issue comment 96 --body-file ${BODY}`, 2],
    [`gh issue create --title Week -F ${BODY}`, 2],
    [`gh api graphql -f query='mutation' -F body=@${BODY}`, 2],
    ["gh issue edit 96 --body 'Zorblax, Quix-week'", 2],
    ["gh issue comment 96 --body 'Quix-week 8, run by rikhin99'", 0],
    ["gh issue comment 96 --body 'Zorblaxes and The Mob'", 0],
    ["gh issue list --search Zorblax", 0],
  ])("denylist-gh.sh on %s exits %i", (command, status) => {
    expect(runHook("denylist-gh.sh", command).status).toBe(status);
  });

  test("denylist-gh.sh lets everything through without a denylist", () => {
    const run = runHook(
      "denylist-gh.sh",
      "gh issue comment 96 --body 'Zorblax won'",
      join(TMP, "absent.txt"),
    );
    expect(run.status).toBe(0);
  });
});

describe("the commit checks (.husky)", () => {
  /** A hook's denylist line, calling the check by its path in this repo. */
  function denylistLine(hook: string): string {
    const lines = readFileSync(join(ROOT, ".husky", hook), "utf8").split("\n");
    const line = lines.find((l) => l.includes("denylist-check.ts")) ?? "";
    return line.replace("scripts/", `${ROOT}/scripts/`);
  }

  /** Runs each hook's denylist line as git does, through `sh -e`, in a scratch repo. */
  function commit(message: string, file: string) {
    const repo = mkdtempSync(join(tmpdir(), "lazy-pundit-commit-"));
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(repo, "a.md"), file);
    git("add", "a.md");
    writeFileSync(join(repo, "msg.txt"), message);
    const run = (hook: string, ...args: string[]) =>
      spawnSync("sh", ["-ec", denylistLine(hook), "hook", ...args], {
        cwd: repo,
        env: { ...process.env, DENYLIST },
        encoding: "utf8",
      }).status;
    return { pre: run("pre-commit"), msg: run("commit-msg", "msg.txt") };
  }

  test.each([
    ["a clean commit", "Week 8", "Quix-week notes\n", { pre: 0, msg: 0 }],
    ["a name in the diff", "Week 8", "Zorblax won\n", { pre: 1, msg: 0 }],
    ["a name in the message", "Zorblax won", "notes\n", { pre: 0, msg: 1 }],
  ])("%s", (_, message, file, expected) => {
    expect(commit(message, file)).toEqual(expected);
  });
});
