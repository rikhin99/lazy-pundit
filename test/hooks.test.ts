import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
  "mutate-one.sh": {
    tool_name: "Bash",
    tool_input: {
      command:
        "npm run -s mutate -- f 'a' 'b' t; echo ===; npm run -s mutate -- f 'c' 'd' t",
    },
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
  "long-line-docs.sh": {
    tool_name: "Bash",
    tool_input: { command: "grep -n -i handle docs/agents/module-map.md" },
  },
  "git-log-subjects.sh": {
    tool_name: "Bash",
    tool_input: { command: "git log --oneline -3" },
  },
  "echo-equals.sh": {
    tool_name: "Bash",
    tool_input: { command: "git status; echo =====; git log -1" },
  },
  "plain-prose-reminder.sh": {
    tool_name: "Edit",
    session_id: `refused-${basename(TMP)}`,
    tool_input: { file_path: join(ROOT, "src", "validator", "extract.ts") },
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
    // In #106, a module-map row's literal pipe read as an alternative.
    ["grep -n '^| `lineup.ts`' docs/agents/module-map.md", 0],
    ["grep -n -F -e '| `lineup.ts`' docs/agents/module-map.md", 0],
    ["grep -nF '||' src/stakes.ts", 0],
    ["grep -n 'logKey\\|^' src/stakes.ts", 2],
    ["grep -n -iE 'logKey|^' src/stakes.ts", 2],
  ])("read-by-outline.sh on %s exits %i", (command, status) => {
    expect(runHook("read-by-outline.sh", command).status).toBe(status);
  });

  // In #63(a)'s retro, saving two ticket bodies to edit was refused, and three
  // one-line edits cost a 42k subagent; a body saved to a file isn't read here.
  test.each([
    [
      "gh issue view 66 --json body > /tmp/66.md && gh issue view 64 > /tmp/64.md",
      0,
    ],
    [
      "gh issue view 66 --json body --jq .body > a.md; gh issue view 64 >b.md",
      0,
    ],
    [
      "gh issue view 66 > a.md && gh issue view 64 --json body && gh issue view 63",
      2,
    ],
    ["gh issue view 66 --json body && gh issue view 64 --json body", 2],
    ["gh issue view 66 2>&1 > /tmp/66.md && gh issue view 64 2>&1", 2],
    // In #123 a ticket's whole thread came in as JSON (7.2k with the workflow).
    ["gh issue view 123 --json title,body,labels,comments", 2],
    [
      "gh issue view 123 --json title,body,comments --jq '.title, .body, (.comments[-1].body // \"\")'",
      0,
    ],
    ["gh issue view 123 --json body,labels", 0],
  ])("ticket-brief.sh on %s exits %i", (command, status) => {
    expect(runHook("ticket-brief.sh", command).status).toBe(status);
  });

  // In #120 an `echo ===` between two mutate calls stopped the second. In #93
  // a loop check matched a heredoc's `for (` line, so mutate runs alone.
  test.each([
    ["npm run -s mutate -- src/a.ts 'x' 'y' test/a.test.ts", 0],
    ["npm run -s mutate -- f 'a || b; c' \"d && $(e)\" t 2>&1", 0],
    ["npm run -s mutate -- f 'a' 'b' t && npm run mutate -- f 'c' 'd' t", 2],
    ["for m in a b; do npm run -s mutate -- f $m t; done", 2],
    ["cd src && npm run -s mutate -- f 'a' 'b' t", 2],
    ["node x.mjs\nnpm run -s mutate -- f 'a' 'b' t", 2],
    ["npm run -s mutate -- f 'a' 'b' t | tail -3", 2],
    ["npm run -s format && npx vitest run test/a.test.ts", 0],
  ])("mutate-one.sh on %s exits %i", (command, status) => {
    expect(runHook("mutate-one.sh", command).status).toBe(status);
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

  // In #92 a 138-line test append went through `cat >> test/… <<'EOF'`,
  // carrying a garbled line.
  test.each([
    ["cat >> test/rerun.test.ts <<'EOF'\nx\nEOF", 2],
    ["printf x > src/cli.ts", 2],
    [`printf x > "${ROOT}/test/a.ts"`, 2],
    ["echo x | tee -a test/a.ts", 2],
    ["npx vitest run test/rerun.test.ts 2>&1 | tail -5", 0],
    ["npm run -s outline -- src/cli.ts > /tmp/outline.txt", 0],
    ["cat src/cli.ts >> scratch/out.txt", 0],
  ])("edit-with-edit.sh on %s exits %i", (command, status) => {
    expect(runHook("edit-with-edit.sh", command).status).toBe(status);
  });

  // A commit message here is one long line: in #100's retro, `git log
  // --oneline -3` printed about 3k.
  test.each([
    ["git log --oneline -3", 2],
    ["git log --oneline --stat -- CHANGELOG.md", 2],
    ["git -C . log --oneline", 2],
    ["git log --format='%h %<(100,trunc)%s' -3", 0],
    ["git log -1 261c76f", 0],
  ])("git-log-subjects.sh on %s exits %i", (command, status) => {
    expect(runHook("git-log-subjects.sh", command).status).toBe(status);
  });

  // A module-map row and a CHANGELOG bullet are one long line each: in #110's
  // retro a module-map grep cost 6.2k and a CHANGELOG sed 3.3k.
  test.each([
    ["grep -n -i handle docs/agents/module-map.md", 2],
    ["sed -n '1,30p' CHANGELOG.md", 2],
    ["cat CHANGELOG.md", 2],
    [
      "grep -n -o '.\\{0,120\\}checkLeague.\\{0,120\\}' docs/agents/module-map.md",
      0,
    ],
    ["grep -n '^##' CHANGELOG.md", 0],
    ["grep -n espn docs/agents/module-map.md | cut -c1-200", 0],
    ["grep -rn handle src", 0],
    [
      "awk -v t='checkLeague' '{i=index($0,t); if(i) print NR\": \"substr($0,(i>150?i-150:1),300)}' docs/agents/module-map.md",
      0,
    ],
  ])("long-line-docs.sh on %s exits %i", (command, status) => {
    expect(runHook("long-line-docs.sh", command).status).toBe(status);
  });

  // In #123's retro, the -o window it suggested failed three times in ugrep.
  test("long-line-docs.sh suggests a window ugrep can't refuse", () => {
    const { stderr } = runHook(
      "long-line-docs.sh",
      "grep -n -i handle docs/agents/module-map.md",
    );
    expect(stderr).toContain("awk -v t='<term>'");
    expect(stderr).not.toContain("grep -o");
  });

  // In #100 and #102 the standards review's one hard finding was a validator
  // change with no plain-prose entries.
  test("plain-prose-reminder.sh speaks once a session, on a claim-shape file", () => {
    const session = `once-${basename(TMP)}`;
    const edit = (...path: string[]) =>
      spawnSync(join(ROOT, ".claude", "hooks", "plain-prose-reminder.sh"), {
        input: JSON.stringify({
          tool_name: "Edit",
          session_id: session,
          tool_input: { file_path: join(ROOT, ...path) },
        }),
        encoding: "utf8",
      }).status;
    expect(edit("src", "validator", "judge.ts")).toBe(0);
    expect(edit("src", "validator", "claims-team.ts")).toBe(2);
    expect(edit("src", "validator", "extract.ts")).toBe(0);
  });

  // In #127 the claims diff came in, read only from ticket-workflow.md.
  test("plain-prose-reminder.sh points to the claims diff", () => {
    const run = spawnSync(
      join(ROOT, ".claude", "hooks", "plain-prose-reminder.sh"),
      {
        input: JSON.stringify({
          tool_name: "Edit",
          session_id: `claims-diff-${basename(TMP)}`,
          tool_input: {
            file_path: join(ROOT, "src", "validator", "extract.ts"),
          },
        }),
        encoding: "utf8",
      },
    );
    expect(run.stderr).toContain("npm run -s claims:diff");
  });

  // In #127 an `echo =====` between two commands stopped the run: zsh reads
  // a word starting with `=` as a command's path.
  test.each([
    ["git status; echo =====; git log -1", 2],
    ["echo ===", 2],
    ["echo '====='; git status", 0],
    ["echo ---; git status", 0],
    ["node -e 'a === b'", 0],
  ])("echo-equals.sh on %s exits %i", (command, status) => {
    expect(runHook("echo-equals.sh", command).status).toBe(status);
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

  /**
   * The environment without git's own variables, which a git hook running
   * this suite passes on: under `git commit -a`, `GIT_INDEX_FILE` names the
   * outer repo's index by its full path, and the scratch repo would use it.
   */
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );

  /** A scratch repo holding `a.md`, staged; `git` runs in it. */
  function scratchRepo(file: string) {
    const repo = mkdtempSync(join(tmpdir(), "lazy-pundit-commit-"));
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: repo, env, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(repo, "a.md"), file);
    git("add", "a.md");
    return { repo, git };
  }

  /** A hook's denylist line run as git runs it, through `sh -e`, in `repo`. */
  function runLine(repo: string, hook: string, ...args: string[]) {
    return spawnSync("sh", ["-ec", denylistLine(hook), "hook", ...args], {
      cwd: repo,
      env: { ...env, DENYLIST },
      encoding: "utf8",
    });
  }

  /** Runs each hook's denylist line on a commit of `file` with `message`. */
  function commit(message: string, file: string) {
    const { repo } = scratchRepo(file);
    writeFileSync(join(repo, "msg.txt"), message);
    return {
      pre: runLine(repo, "pre-commit").status,
      msg: runLine(repo, "commit-msg", "msg.txt").status,
    };
  }

  test.each([
    ["a clean commit", "Week 8", "Quix-week notes\n", { pre: 0, msg: 0 }],
    ["a name in the diff", "Week 8", "Zorblax won\n", { pre: 1, msg: 0 }],
    ["a name in the message", "Zorblax won", "notes\n", { pre: 0, msg: 1 }],
  ])("%s", (_, message, file, expected) => {
    expect(commit(message, file)).toEqual(expected);
  });

  test("the pre-commit line fails when git diff does", () => {
    const { repo, git } = scratchRepo("Zorblax won\n");
    const sha = git("rev-parse", ":a.md").stdout.trim();
    rmSync(join(repo, ".git", "objects", sha.slice(0, 2), sha.slice(2)));
    rmSync(join(repo, "a.md"));
    expect(git("diff", "--cached").status).not.toBe(0);
    const pre = runLine(repo, "pre-commit");
    expect(pre.status).not.toBe(0);
    expect(pre.stderr).toContain("so the staged diff went unchecked");
  });
});
