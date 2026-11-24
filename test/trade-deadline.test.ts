import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { check, type Deps, draft } from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { hotTakeryWorkspace } from "./support/espn.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  type Patch,
  patchingTransport,
  published,
} from "./support/workspace.ts";

const SLEEPER_LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;

/** Fear The Turtle at `week`, with its league payload changed by `league`, if given. */
async function sleeperAt(week: number, league?: Patch) {
  const ws = await fearTheTurtle(week);
  if (!league) return ws;
  const transport = patchingTransport(ws.deps.transport, {
    [SLEEPER_LEAGUE]: league,
  });
  return { ...ws, deps: { ...ws.deps, transport } };
}

/** The plain text the league reads after drafting without an LLM and publishing. */
async function publishedText(ws: { dir: string; deps: Deps }): Promise<string> {
  const { path } = await draft(ws.dir, ws.deps);
  await published(ws.dir, ws.deps);
  return readFile(path.replace(/\.md$/, ".txt"), "utf8");
}

/**
 * `check`'s problems citing the trade deadline, as [text, kind], after
 * drafting without an LLM and adding `words` to the week intro.
 */
async function deadlineProblems(
  ws: { dir: string; deps: Deps },
  words: string,
) {
  const { path } = await draft(ws.dir, ws.deps);
  const heading = "## Intro {intro}\n";
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replace(heading, `${heading}${words}\n`));
  const { problems } = await check(ws.dir);
  return problems
    .filter((p) => p.id === "platform.trade_deadline")
    .map((p) => [p.text, p.kind]);
}

/** Runs the describe block's tests with the machine in New York's time zone. */
function inNewYork() {
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = "America/New_York";
  });
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });
}

describe("the trade deadline as evidence", () => {
  inNewYork();

  test("the week intro's prompt sees it in a reminder week", async () => {
    const ws = await fearTheTurtle(10);
    const llm = scriptedLlm("## {intro}\nA quiet week.");
    ws.deps.llm = llm;
    ws.deps.env.anthropicApiKey = "sk-ant-test";
    await draft(ws.dir, ws.deps);
    expect(llm.requests[0]?.prompt).toMatch(/platform\.trade_deadline\W+11\b/);
  });

  test("check judges a claim citing Sleeper's week as other league items", async () => {
    expect(
      await deadlineProblems(
        await sleeperAt(10),
        "Trades close after week [11]{ev=platform.trade_deadline}, not week [12]{ev=platform.trade_deadline}.",
      ),
    ).toEqual([["12", "wrong"]]);
    // Outside the reminder weeks the evidence pack has no deadline.
    expect(
      await deadlineProblems(
        await sleeperAt(8),
        "Trades close after week [11]{ev=platform.trade_deadline}.",
      ),
    ).toEqual([["11", "unknown-id"]]);
  });

  test("check takes ESPN's day with or without its weekday", async () => {
    expect(
      await deadlineProblems(
        await hotTakeryWorkspace(10),
        "Trades close [Nov 26]{ev=platform.trade_deadline}, or [Wed Nov 26]{ev=platform.trade_deadline}, not [Nov 27]{ev=platform.trade_deadline}.",
      ),
    ).toEqual([["Nov 27", "wrong"]]);
  });
});

describe("the deadline reminder", () => {
  inNewYork();

  test("Sleeper's deadline week and the two weeks before carry it", async () => {
    const text = await publishedText(await sleeperAt(10));
    expect(text.split("\n\n")[1]).toBe("Trade deadline: week 11");
    for (const week of [9, 8, 14]) {
      const other = await publishedText(await sleeperAt(week));
      if (week === 9) expect(other).toContain("Trade deadline: week 11");
      else expect(other).not.toContain("Trade deadline");
    }
  });

  test("a Sleeper league with deadline 0 has none", async () => {
    const text = await publishedText(
      await sleeperAt(10, (league) => {
        league.settings.trade_deadline = 0;
      }),
    );
    expect(text).not.toContain("Trade deadline");
    // Read as week 0, it would be reminded of before the first week is scored.
    const preseason = await publishedText(
      await sleeperAt(1, (league) => {
        league.settings.trade_deadline = 0;
        league.settings.last_scored_leg = 0;
      }),
    );
    expect(preseason).toContain("Preseason");
    expect(preseason).not.toContain("Trade deadline");
  });

  test("ESPN's carries the deadline's day while it's less than 21 days after the data as of", async () => {
    const text = await publishedText(await hotTakeryWorkspace(10));
    expect(text.split("\n\n")[1]).toBe("Trade deadline: Wed Nov 26");
    for (const week of [9, 14]) {
      const other = await publishedText(await hotTakeryWorkspace(week));
      expect(other).not.toContain("Trade deadline");
    }
  });
});
