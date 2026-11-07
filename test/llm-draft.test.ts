import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  draft,
  draftData,
  type LlmRequest,
  publish,
  saveCredentials,
} from "../src/index.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  atWeek,
  committed,
  fearTheTurtle,
  withoutReminder,
} from "./support/workspace.ts";

const KEY = "sk-ant-api03-test-key";

/**
 * A reply in the format the prompt asks for: the intro, then a blurb per
 * team, each made from the team's checked stat line so every claim verifies.
 */
async function week8Reply(): Promise<string> {
  const data = draftData(await committed(8), 8);
  return [
    `## {intro}\nWhat a week. ${data.intro}`,
    ...Object.entries(data.teams).map(
      ([id, t]) => `## {team=${id}}\nSteady as ever. ${t.statLine}`,
    ),
  ].join("\n\n");
}

/** Fear The Turtle week 8 with an Anthropic key and a scripted LLM. */
async function withLlm(...replies: (string | ((r: LlmRequest) => string))[]) {
  const ws = await fearTheTurtle(8);
  const llm = scriptedLlm(...replies);
  ws.deps.llm = llm;
  ws.deps.env.anthropicApiKey = KEY;
  return { ...ws, llm };
}

describe("draft with an Anthropic key", () => {
  test("writes the LLM's blurbs into each team section and the intro", async () => {
    const { dir, deps, llm } = await withLlm(await week8Reply());

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]).toMatchObject({
      key: KEY,
      model: "claude-sonnet-5-5",
    });
    const text = await readFile(result.path, "utf8");
    expect(text).toMatch(/## Intro \{intro\}\nWhat a week\. Week high: /);
    expect(text).toContain(
      "## Hail Mary Hustle {team=sleeper:9}\nSteady as ever. [10th]{ev=pf_rank} in points · [lost 4 straight]{ev=streak} · [lost to]{ev=w8.result} [Tank Brigade]{ev=w8.opponent} by [31.3]{ev=w8.margin}\n",
    );
    expect(text.match(/Steady as ever\./g)).toHaveLength(12);
    expect(withoutReminder(result.problems)).toEqual([]);
  });

  test("uses the model named in config.yaml", async () => {
    const { dir, deps, llm } = await withLlm(await week8Reply());
    await mkdir(deps.configDir, { recursive: true });
    await writeFile(
      join(deps.configDir, "config.yaml"),
      "format: 1\nmodel: claude-haiku-5-5\n",
    );

    await draft(dir, deps);

    expect(llm.requests[0]?.model).toBe("claude-haiku-5-5");
  });

  test("the prompt carries each team's name, managers and stats, and the league items", async () => {
    const { dir, deps, llm } = await withLlm(await week8Reply());

    await draft(dir, deps);

    const { prompt } = llm.requests[0] as LlmRequest;
    const league = await committed(8);
    for (const team of league.teams) {
      expect(prompt).toContain(`### ${team.name} (team id ${team.id})`);
      for (const m of team.managers) expect(prompt).toContain(m.displayName);
    }
    expect(prompt).toContain("### Hail Mary Hustle (team id sleeper:9)");
    expect(prompt).toMatch(
      /### Hail Mary Hustle[^#]*\nrecord: 1-7\n[^#]*\nw8\.opponent: Tank Brigade\n/,
    );
    expect(prompt).toContain("wk.low_team: Hail Mary Hustle");
    expect(prompt).toContain("2 to 3 sentences");
  });

  test("a first draft's prompt holds no place, move or group evidence", async () => {
    const { dir, deps, llm } = await withLlm(await week8Reply());

    await draft(dir, deps);

    const { system, prompt } = llm.requests[0] as LlmRequest;
    for (const text of [system, prompt]) {
      expect(text).not.toMatch(/^(\S+\/)?(place|move|group): /m);
      expect(text).not.toMatch(/\{ev=(\S+\/)?(place|move|group)\}/);
    }
  });

  test("the prompt holds no platform account IDs or credential values", async () => {
    const { dir, deps, llm } = await withLlm(await week8Reply());
    deps.env.espnS2 = "espn-cookie-value";

    await draft(dir, deps);

    const { system, prompt } = llm.requests[0] as LlmRequest;
    const accountIds = (await committed(8)).teams.flatMap((t) =>
      t.managers.map((m) => m.accountId),
    );
    expect(accountIds.length).toBeGreaterThan(0);
    for (const secret of [KEY, "espn-cookie-value", ...accountIds]) {
      expect(system).not.toContain(secret);
      expect(prompt).not.toContain(secret);
    }
    expect(prompt).not.toMatch(/@\S+\.\w+/);
  });

  test("a team or intro the reply leaves out keeps its stat line", async () => {
    const { dir, deps } = await withLlm(
      "Some preamble.\n## {team=sleeper:9}\nOnly the Hustle got a blurb.\n## {team=sleeper:99}\nNot a team.",
    );

    const result = await draft(dir, deps);

    const text = await readFile(result.path, "utf8");
    expect(text).toContain(
      "## Hail Mary Hustle {team=sleeper:9}\nOnly the Hustle got a blurb.\n",
    );
    expect(text).toMatch(/## Intro \{intro\}\nWeek high: /);
    expect(text).not.toContain("preamble");
    expect(text).not.toContain("Not a team");
    expect(withoutReminder(result.problems)).toEqual([]);
  });

  test("last week's published blurb is in the prompt for that team, without its tags", async () => {
    const week7 = await fearTheTurtle(7);
    const first = await draft(week7.dir, week7.deps);
    const drafted = await readFile(first.path, "utf8");
    await writeFile(
      first.path,
      drafted.replace(
        /(## Hail Mary Hustle \{team=sleeper:9\}\n)[^\n]*\n/,
        "$1Still winless in spirit at [1-6]{ev=record}, and the schedule is no kinder.\n",
      ),
    );
    await publish(week7.dir, week7.deps, { yes: true });
    const llm = scriptedLlm(await week8Reply());
    const deps = {
      ...atWeek(week7.deps, 8),
      llm,
      env: { ...week7.deps.env, anthropicApiKey: KEY },
    };

    await draft(week7.dir, deps);

    const { prompt } = llm.requests[0] as LlmRequest;
    expect(prompt).toMatch(
      /### Hail Mary Hustle \(team id sleeper:9\)[^#]*Its blurb in the week 7 ranking[^\n]*\n[^\n]*Still winless in spirit at 1-6, and the schedule is no kinder\./,
    );
    expect(prompt).not.toContain("{ev=record}");
  });

  test("a credentials file others can read gives a warning", async () => {
    const { dir, deps } = await withLlm(await week8Reply());
    delete deps.env.anthropicApiKey;
    const path = await saveCredentials(deps, { anthropicApiKey: KEY });
    await chmod(path, 0o644);

    const result = await draft(dir, deps);

    expect(result.warnings).toEqual([
      `${path} can be read by other users on this machine (mode 0644). Run: chmod 600 ${path}`,
    ]);
  });
});

const HUSTLE = "sleeper:9";

/** Week 8's reply with the Hail Mary Hustle's blurb replaced. */
async function withHustle(blurb: string): Promise<string> {
  return (await week8Reply()).replace(
    /(## \{team=sleeper:9\}\n)[^\n]*/,
    `$1${blurb}`,
  );
}

/** The part of a retry prompt that lists the sections to rewrite. */
function toRewrite(req: LlmRequest | undefined): string {
  const at = req?.prompt.indexOf("## Sections to rewrite") ?? -1;
  expect(at).toBeGreaterThan(-1);
  return (req as LlmRequest).prompt.slice(at);
}

describe("the LLM gate", () => {
  test("a wrong claim twice, then a good one, passes on retry 2 with the complaints passed back", async () => {
    const wrong = "Rock bottom at [2-6]{ev=record}.";
    const { dir, deps, llm } = await withLlm(
      await withHustle(wrong),
      `## {team=${HUSTLE}}\n${wrong}`,
      `## {team=${HUSTLE}}\nRock bottom at [1-7]{ev=record}.`,
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(3);
    for (const req of llm.requests.slice(1)) {
      const rewrite = toRewrite(req);
      expect(rewrite).toContain("Hail Mary Hustle (team id sleeper:9)");
      expect(rewrite).toContain(wrong);
      expect(rewrite).toContain('"2-6" (cites record): wrong, record is 1-7');
      expect(rewrite).not.toContain("team id sleeper:1)");
      expect(rewrite).not.toContain("{intro}");
    }
    const text = await readFile(result.path, "utf8");
    expect(text).toContain(
      "## Hail Mary Hustle {team=sleeper:9}\nRock bottom at [1-7]{ev=record}.\n",
    );
    expect(text.match(/Steady as ever\./g)).toHaveLength(11);
    expect(text).toMatch(/## Intro \{intro\}\nWhat a week\./);
    expect(withoutReminder(result.problems)).toEqual([]);
  });

  test("prose that never passes is written as its best attempt, with its faults flagged as gate failures", async () => {
    const { dir, deps, llm } = await withLlm(
      await withHustle(
        "Rock bottom at [2-6]{ev=record}, scoring [999]{ev=pf}.",
      ),
      `## {team=${HUSTLE}}\nStill rock bottom at [2-6]{ev=record}.`,
      `## {team=${HUSTLE}}\nYes, rock bottom at [3-5]{ev=record}.`,
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(3);
    const text = await readFile(result.path, "utf8");
    expect(text).toContain(
      "## Hail Mary Hustle {team=sleeper:9}\nStill rock bottom at [2-6]{ev=record}.\n",
    );
    expect(withoutReminder(result.problems)).toEqual([
      expect.objectContaining({
        team: HUSTLE,
        section: "Hail Mary Hustle",
        severity: "hard",
        kind: "wrong",
        text: "2-6",
        id: "record",
        gate: true,
      }),
    ]);
  });

  test("a word-list hit with swearing off fails the gate and is flagged in the best attempt", async () => {
    const { dir, deps, llm } = await withLlm(
      (await week8Reply()).replace("What a week.", "What a damn week."),
      "## {intro}\nWhat a damn week, again.",
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(3);
    expect(toRewrite(llm.requests[1])).toContain(
      '"damn": on the word list, and swearing is off',
    );
    const text = await readFile(result.path, "utf8");
    expect(text).toMatch(/## Intro \{intro\}\nWhat a damn week\. Week high/);
    const line = text.split("\n").indexOf("## Intro {intro}") + 2;
    expect(withoutReminder(result.problems)).toEqual([
      {
        team: null,
        section: "Intro",
        severity: "soft",
        line,
        text: "damn",
        kind: "swear",
        reason: "on the word list, and swearing is off",
        gate: true,
      },
    ]);
  });

  test("an uncited claim fails the gate, and a retry that leaves the section out keeps it failing", async () => {
    const { dir, deps, llm } = await withLlm(
      await withHustle("Lost again, now 1-7 on the year."),
      "## {intro}\nNot asked for.",
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(3);
    expect(toRewrite(llm.requests[1])).toContain(
      '"1-7": no citation; it matches record (record is 1-7), so cite that',
    );
    expect(toRewrite(llm.requests[2])).toContain("Lost again, now 1-7");
    const text = await readFile(result.path, "utf8");
    expect(text).not.toContain("Not asked for.");
    // Written as the LLM wrote it; check then cites the claim it matches.
    expect(text).toContain("Lost again, now [1-7]{ev=record} on the year.");
    expect(withoutReminder(result.problems)).toEqual([]);
  });
});
