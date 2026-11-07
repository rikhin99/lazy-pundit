import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import {
  type Deps,
  deleteTranscripts,
  draft,
  draftData,
  LlmError,
  type LlmReply,
} from "../src/index.ts";
import { type Scripted, scriptedLlm } from "./support/llm.ts";
import {
  committed,
  fearTheTurtle,
  fixedClock,
  withoutReminder,
} from "./support/workspace.ts";

const KEY = "sk-ant-api03-test-key";

/** Fear The Turtle week 8 with an Anthropic key and a scripted LLM. */
async function withLlm(...replies: Scripted[]) {
  const ws = await fearTheTurtle(8);
  const llm = scriptedLlm(...replies);
  ws.deps.llm = llm;
  ws.deps.env.anthropicApiKey = KEY;
  return { ...ws, llm };
}

/** Week 8's draft as stat lines alone: the intro and each team's stat line. */
async function expectStatLines(path: string) {
  const data = draftData(await committed(8), 8);
  const text = await readFile(path, "utf8");
  expect(text).toContain(`## Intro {intro}\n${data.intro}\n`);
  for (const t of Object.values(data.teams)) {
    expect(text).toContain(`}\n${t.statLine}\n`);
  }
}

describe("the fallback", () => {
  test("with no key, the draft has stat lines and says why the LLM didn't run", async () => {
    const { dir, deps } = await fearTheTurtle(8);

    const result = await draft(dir, deps);

    await expectStatLines(result.path);
    expect(result.fallback).toMatch(
      /^No Anthropic key, so the LLM didn't run: set ANTHROPIC_API_KEY, or add anthropic_api_key to .*credentials\.yaml; the draft has stat lines\.$/,
    );
  });

  test.each([
    [
      "an invalid key",
      new LlmError("invalid-key", "Anthropic answered 401: invalid x-api-key"),
      /^Anthropic refused the key \(Anthropic answered 401: invalid x-api-key\): check it with `lazy-pundit doctor`; the draft has stat lines\.$/,
    ],
    [
      "no credits",
      new LlmError(
        "no-credits",
        "Anthropic answered 400: Your credit balance is too low",
      ),
      /^Anthropic answered 400: Your credit balance is too low; the draft has stat lines\.$/,
    ],
    [
      "a provider error",
      new LlmError("provider", "Anthropic answered 529: Overloaded"),
      /^Anthropic answered 529: Overloaded; the draft has stat lines\.$/,
    ],
  ])(
    "with %s on the first call, the draft has stat lines and one reason",
    async (_, error, reason) => {
      const { dir, deps, llm } = await withLlm(error);

      const result = await draft(dir, deps);

      expect(llm.requests).toHaveLength(1);
      await expectStatLines(result.path);
      expect(result.fallback).toMatch(reason);
      expect(withoutReminder(result.problems)).toEqual([]);
    },
  );

  test("an LLM draft that runs to the end has no fallback", async () => {
    const { dir, deps } = await withLlm(await passingReply());

    const result = await draft(dir, deps);

    expect(result.fallback).toBeUndefined();
  });
});

/** Writes one of the operator's files into the temp config folder. */
async function operatorFile(deps: Deps, name: string, text: string) {
  await mkdir(deps.configDir, { recursive: true });
  await writeFile(join(deps.configDir, name), text);
}

/** `spend.yaml`'s months, as written. */
async function spentMonths(deps: Deps): Promise<Record<string, number>> {
  const text = await readFile(join(deps.configDir, "spend.yaml"), "utf8");
  return parse(text).months;
}

/** Week 8's reply with every claim verified, reporting some token counts. */
async function passingReply(
  inputTokens = 0,
  outputTokens = 0,
): Promise<LlmReply> {
  const data = draftData(await committed(8), 8);
  return {
    text: [
      `## {intro}\nWhat a week. ${data.intro}`,
      ...Object.entries(data.teams).map(
        ([id, t]) => `## {team=${id}}\nSteady. ${t.statLine}`,
      ),
    ].join("\n\n"),
    usage: { inputTokens, outputTokens },
  };
}

describe("the price table and spend cap", () => {
  test("each call's spend is counted from the reported tokens into the local calendar month", async () => {
    const { dir, deps } = await withLlm(await passingReply(8000, 1500));

    await draft(dir, deps);

    // 8000 in at $2/M plus 1500 out at $10/M (Sonnet 5.5).
    expect(await spentMonths(deps)).toEqual({ "2025-10": 0.031 });
  });

  test("near the spend cap the call is refused before it's made, and the draft has stat lines", async () => {
    const { dir, deps, llm } = await withLlm(await passingReply());
    await operatorFile(
      deps,
      "spend.yaml",
      "format: 1\nmonths:\n  2025-10: 4.85\n",
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toEqual([]);
    await expectStatLines(result.path);
    // The ceiling: 12,855 chars of system and prompt ÷ 3 = 4,285 tokens at
    // $2/M ($0.0086), plus 16,000 max tokens at $10/M ($0.16): $0.17.
    expect(result.fallback).toMatch(
      /^The next LLM call could cost up to \$0\.17, and \$4\.85 of this month's \$5\.00 spend cap is spent, so it wasn't made: raise the cap with lazy-pundit setup cap, or wait for next month; the draft has stat lines\.$/,
    );
  });

  test("spend starts again on a new local calendar month", async () => {
    const { dir, deps, llm } = await withLlm(await passingReply(8000, 1500));
    await operatorFile(
      deps,
      "spend.yaml",
      "format: 1\nmonths:\n  2025-10: 5\n",
    );
    deps.clock = fixedClock("2025-11-01T12:00:00.000Z");

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(1);
    expect(result.fallback).toBeUndefined();
    expect(await spentMonths(deps)).toEqual({ "2025-10": 5, "2025-11": 0.031 });
  });

  test("a model with no price is never called", async () => {
    const { dir, deps, llm } = await withLlm(await passingReply());
    await operatorFile(
      deps,
      "config.yaml",
      "format: 1\nmodel: claude-mystery-1\n",
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toEqual([]);
    await expectStatLines(result.path);
    expect(result.fallback).toMatch(
      /^claude-mystery-1 has no price in the price table, so it was never called: add it under prices in .*config\.yaml; the draft has stat lines\.$/,
    );
  });

  test("a price in config.yaml adds a model to the shipped table, or corrects one", async () => {
    const { dir, deps, llm } = await withLlm(await passingReply(1_000_000, 0));
    await operatorFile(
      deps,
      "config.yaml",
      "format: 1\nmodel: claude-sonnet-5-5\nprices:\n  claude-sonnet-5-5:\n    input_per_mtok: 3\n    output_per_mtok: 15\n",
    );

    await draft(dir, deps);

    expect(llm.requests).toHaveLength(1);
    expect(await spentMonths(deps)).toEqual({ "2025-10": 3 });
  });

  test("a reply cut off at the token limit still counts its billed tokens", async () => {
    const { dir, deps } = await withLlm(
      new LlmError(
        "provider",
        "Anthropic's reply stopped early (max_tokens), so it wasn't used",
        {
          inputTokens: 0,
          outputTokens: 16000,
        },
      ),
    );

    const result = await draft(dir, deps);

    expect(await spentMonths(deps)).toEqual({ "2025-10": 0.16 });
    expect(result.fallback).toMatch(/stopped early \(max_tokens\)/);
  });
});

const HUSTLE = "sleeper:9";
const WRONG = "Rock bottom at [2-6]{ev=record}.";

/** The passing reply with the Hail Mary Hustle's blurb wrong, so it fails the gate. */
async function wrongHustle(
  inputTokens = 0,
  outputTokens = 0,
): Promise<LlmReply> {
  const reply = await passingReply(inputTokens, outputTokens);
  return {
    ...reply,
    text: reply.text.replace(/(## \{team=sleeper:9\}\n)[^\n]*/, `$1${WRONG}`),
  };
}

describe("a stop partway through the LLM gate", () => {
  test("a provider error on a retry keeps the prose so far, with its gate failures and the reason", async () => {
    const { dir, deps, llm } = await withLlm(
      await wrongHustle(),
      new LlmError("provider", "Anthropic answered 529: Overloaded"),
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(2);
    const text = await readFile(result.path, "utf8");
    expect(text.match(/Steady\./g)).toHaveLength(11);
    expect(text).toContain(`## Hail Mary Hustle {team=${HUSTLE}}\n${WRONG}\n`);
    expect(withoutReminder(result.problems)).toEqual([
      expect.objectContaining({ team: HUSTLE, kind: "wrong", gate: true }),
    ]);
    expect(result.fallback).toBe(
      "Anthropic answered 529: Overloaded; the LLM gate stopped after 1 reply, so the draft has the LLM's prose so far, each failing section at its best attempt.",
    );
  });

  test("a retry that could pass the spend cap is refused, and the prose so far is kept", async () => {
    const { dir, deps, llm } = await withLlm(await wrongHustle(10000, 16000));
    await operatorFile(
      deps,
      "spend.yaml",
      "format: 1\nmonths:\n  2025-10: 4.7\n",
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(1);
    expect(await spentMonths(deps)).toEqual({ "2025-10": 4.88 });
    const text = await readFile(result.path, "utf8");
    expect(text).toContain(`## Hail Mary Hustle {team=${HUSTLE}}\n${WRONG}\n`);
    // $0.17 as above: the retry's prompt is the first one's size to within a cent.
    expect(result.fallback).toMatch(
      /^The next LLM call could cost up to \$0\.17, and \$4\.88 of this month's \$5\.00 spend cap is spent, .*; the LLM gate stopped after 1 reply, so the draft has the LLM's prose so far, each failing section at its best attempt\.$/,
    );
  });
});

describe("LLM transcripts", () => {
  /** The workspace's transcript folder for 2025. */
  const transcripts = (dir: string) => join(dir, "transcripts", "2025");

  test("each call writes one with the model, tokens, cost, system text, prompt and reply, never the key", async () => {
    const { dir, deps, llm } = await withLlm(await passingReply(8000, 1500));

    await draft(dir, deps);

    expect(await readdir(transcripts(dir))).toEqual([
      "week-08-20251028T150000Z-1.md",
    ]);
    const text = await readFile(
      join(transcripts(dir), "week-08-20251028T150000Z-1.md"),
      "utf8",
    );
    const [req] = llm.requests;
    expect(text).toContain("# LLM transcript: week 8, call 1\n");
    expect(text).toMatch(
      /^---\nformat: 1\nmodel: claude-sonnet-5-5\ninput_tokens: 8000\noutput_tokens: 1500\ncost_usd: 0\.031\n---\n/,
    );
    expect(text).toContain(req?.system);
    expect(text).toContain(req?.prompt);
    expect(text).toContain("## Reply\n");
    expect(text).toContain((await passingReply()).text);
    expect(text).not.toContain(KEY);
  });

  test("a retry writes its own, and a failed call's has the error", async () => {
    const { dir, deps } = await withLlm(
      await wrongHustle(),
      new LlmError("provider", "Anthropic answered 529: Overloaded"),
    );

    await draft(dir, deps);

    expect(await readdir(transcripts(dir))).toEqual([
      "week-08-20251028T150000Z-1.md",
      "week-08-20251028T150000Z-2.md",
    ]);
    const second = await readFile(
      join(transcripts(dir), "week-08-20251028T150000Z-2.md"),
      "utf8",
    );
    expect(second).toContain(
      "## Error\n\nAnthropic answered 529: Overloaded\n",
    );
    expect(second).toMatch(
      /^---\nformat: 1\nmodel: claude-sonnet-5-5\ncost_usd: 0\n---\n/,
    );
    expect(second).toContain("## Sections to rewrite");
  });

  test("no call, no transcript", async () => {
    const { dir, deps } = await fearTheTurtle(8);

    await draft(dir, deps);

    await expect(readdir(join(dir, "transcripts"))).rejects.toThrow(/ENOENT/);
  });

  test("deleting them removes the workspace's transcripts folder", async () => {
    const { dir, deps } = await withLlm(await passingReply());
    await draft(dir, deps);

    const result = await deleteTranscripts(dir);

    expect(result).toEqual({ path: join(dir, "transcripts"), files: 1 });
    await expect(readdir(join(dir, "transcripts"))).rejects.toThrow(/ENOENT/);
    expect(await deleteTranscripts(dir)).toEqual({
      path: join(dir, "transcripts"),
      files: 0,
    });
  });
});
