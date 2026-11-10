import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");

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
};

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
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      encoding: "utf8",
    });

    expect(run.error).toBeUndefined();
    expect(run.status).toBe(2);
    expect(run.stderr).not.toBe("");
  });
});
