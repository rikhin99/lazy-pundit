import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  check,
  type Deps,
  draft,
  publish,
  WorkspaceFileError,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  atWeek,
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  fixedClock,
  patchingTransport,
  published,
  rankingsDir,
  statCorrection,
} from "./support/workspace.ts";

const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;
const GUS = "## Gus Bus {team=sleeper:1}\n";
const BEA = "## Bye Bye Bea {team=sleeper:11}\n";
const INTRO = "## Intro {intro}\n";

/** A weekly high-score rule paying `outcome`. */
function highScore(outcome = "$10", extra = ""): string {
  return `  - id: high-score
    name: Weekly high score
    trigger: high-score
    per: week
    outcome: ${outcome}
${extra}`;
}

/** The 2025 season's `league.md` with `fields` of stakes front matter. */
async function writeLeagueFile(
  dir: string,
  fields: string,
  body = "<!-- Free text rules go under a heading. -->\n",
): Promise<void> {
  const season = join(dir, "seasons", "2025");
  await mkdir(season, { recursive: true });
  await writeFile(
    join(season, "league.md"),
    `---
league: 1
season: "2025"
family-league: off
${fields}---

${body}`,
  );
}

/** Fear The Turtle at `week` with `fields` of stakes, drafted without an LLM. */
async function drafted(week: number, fields: string, deps?: (d: Deps) => Deps) {
  const ws = await fearTheTurtle(week);
  await writeLeagueFile(ws.dir, fields);
  const d = deps ? deps(ws.deps) : ws.deps;
  const result = await draft(ws.dir, d);
  const path = join(
    rankingsDir(ws.dir),
    `week-${String(week).padStart(2, "0")}.md`,
  );
  const text = await readFile(path, "utf8");
  return { ...ws, deps: d, result, path, text };
}

/** The draft's line right after `heading`. */
function lineAfter(text: string, heading: string): string {
  const at = text.indexOf(heading);
  expect(at).toBeGreaterThanOrEqual(0);
  return text.slice(at + heading.length).split("\n")[0] as string;
}

/** `check`'s problems on stakes evidence IDs, after adding `words` under `heading`. */
async function claimProblems(
  ws: { dir: string; deps: Deps; path: string },
  heading: string,
  words: string,
) {
  const text = await readFile(ws.path, "utf8");
  await writeFile(ws.path, text.replace(heading, `${heading}${words}\n`));
  const { problems } = await check(ws.dir, ws.deps);
  return problems.filter((p) =>
    /^(wk\.)?(rule|stakes|platform)\./.test(p.id ?? ""),
  );
}

/** Each handle's account in Fear The Turtle; any other handle links to no team. */
const ACCOUNTS: Record<string, string> = {
  gus: "sleeper:800000000000000001",
  wendy: "sleeper:800000000000000002",
  frank: "sleeper:800000000000000004",
  pete: "sleeper:800000000000000006",
};

/** Links each handle to its account in `workspace.md`. */
async function linkHandles(dir: string, handles: string[]): Promise<void> {
  const path = join(dir, "workspace.md");
  const text = await readFile(path, "utf8");
  const lines = handles
    .map((h) => `  ${h}: ["${ACCOUNTS[h] ?? "sleeper:no-such-account"}"]`)
    .join("\n");
  await writeFile(path, text.replace("\n---\n", `\nhandles:\n${lines}\n---\n`));
}

/**
 * Fear The Turtle drafted at `week` (default 8) with `league.md`'s `fields`
 * and `body`, `handles` linked, and with `reply` the LLM's answer, if given.
 */
async function stakesDraft(opts: {
  week?: number;
  fields?: string;
  body?: string;
  handles?: string[];
  reply?: string;
}) {
  const week = opts.week ?? 8;
  const ws = await fearTheTurtle(week);
  await writeLeagueFile(ws.dir, opts.fields ?? "", opts.body);
  if (opts.handles) await linkHandles(ws.dir, opts.handles);
  const llm = opts.reply === undefined ? undefined : scriptedLlm(opts.reply);
  if (llm) {
    ws.deps.llm = llm;
    ws.deps.env.anthropicApiKey = "sk-ant-test";
  }
  const result = await draft(ws.dir, ws.deps);
  const text = await readFile(result.path, "utf8");
  return {
    ...ws,
    result,
    path: result.path,
    text,
    requests: llm?.requests ?? [],
    prompt: llm?.requests[0]?.prompt ?? "",
    system: llm?.requests[0]?.system ?? "",
  };
}

/** `check`'s problems of `kind` after adding `words` under `heading`, as [text, kind]. */
async function problemsOf(
  ws: { dir: string; deps: Deps; path: string },
  heading: string,
  words: string,
  kind: string,
) {
  const text = await readFile(ws.path, "utf8");
  await writeFile(ws.path, text.replace(heading, `${heading}${words}\n`));
  const { problems } = await check(ws.dir, ws.deps);
  return problems
    .filter((p) => p.kind === kind)
    .map((p) => [p.text, p.severity]);
}

/** Bye Bye Bea's week-8 score raised by `points`, as a stat correction. */
function beaCorrected(points: number) {
  return (d: Deps): Deps => ({
    ...d,
    transport: patchingTransport(d.transport, {
      [`${LEAGUE}/matchups/8`]: statCorrection(11, points),
    }),
  });
}

describe("house-rule triggers", () => {
  test("a weekly high-score rule gives the week's winner, counts and winnings to date", async () => {
    const ws = await drafted(8, `house-rules:\n${highScore()}`);

    // Week 8's high: Gus Bus, 133.22. Earlier: weeks 1 (Gus), 2 and 6 (Bench Mob),
    // 3, 4 and 7 (Bye Bye Bea), 5 (Red Zone Rascals).
    expect(lineAfter(ws.text, GUS)).toContain(
      "[Weekly high score]{ev=wk.rule.high-score} ([2]{ev=rule.high-score.count} this season) · [$20]{ev=rule.high-score.winnings} to date",
    );
    expect(lineAfter(ws.text, INTRO)).toContain(
      "[Weekly high score: Gus Bus]{ev=wk.rule.high-score}",
    );
    expect(lineAfter(ws.text, BEA)).not.toContain("rule.");
    expect(ws.result.problems.filter((p) => /rule\./.test(p.id ?? ""))).toEqual(
      [],
    );

    expect(
      await claimProblems(
        ws,
        BEA,
        "Bea has [3]{ev=rule.high-score.count} high scores and [$30]{ev=rule.high-score.winnings} in prizes. They didn't take [the high score]{ev=wk.rule.high-score} this week.",
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "hard",
        kind: "wrong",
        id: "wk.rule.high-score",
      }),
    ]);
  });

  test("a team that never triggered a rule has a count of 0", async () => {
    const ws = await drafted(8, `house-rules:\n${highScore()}`);
    const PYLON = "## Pylon Patrol {team=sleeper:6}\n";
    expect(
      await claimProblems(
        ws,
        PYLON,
        "Pylon have [0]{ev=rule.high-score.count} high scores, [$0]{ev=rule.high-score.winnings} won.",
      ),
    ).toEqual([]);
  });

  test("every tied team triggers, tied with the others", async () => {
    // 130.03 + 3.19 levels Bye Bye Bea with Gus Bus's 133.22.
    const ws = await drafted(
      8,
      `house-rules:\n${highScore()}`,
      beaCorrected(3.19),
    );

    expect(lineAfter(ws.text, GUS)).toContain(
      "[Weekly high score, tied with Bye Bye Bea]{ev=wk.rule.high-score} ([2]{ev=rule.high-score.count} this season) · [$20]{ev=rule.high-score.winnings} to date",
    );
    expect(lineAfter(ws.text, BEA)).toContain(
      "[Weekly high score, tied with Gus Bus]{ev=wk.rule.high-score} ([4]{ev=rule.high-score.count} this season) · [$40]{ev=rule.high-score.winnings} to date",
    );
    expect(lineAfter(ws.text, INTRO)).toContain(
      "[Weekly high score: Gus Bus and Bye Bye Bea]{ev=wk.rule.high-score}",
    );
    expect(ws.result.problems.filter((p) => /rule\./.test(p.id ?? ""))).toEqual(
      [],
    );
  });

  test("a FAAB or text outcome: FAAB counts as winnings, text gives none", async () => {
    const ws = await drafted(
      8,
      `house-rules:
${highScore("5 FAAB")}  - id: low-score
    name: Weekly low score
    trigger: low-score
    per: week
    outcome: wears the jersey
`,
    );
    expect(lineAfter(ws.text, GUS)).toContain(
      "· [10 FAAB]{ev=rule.high-score.winnings} to date",
    );
    // Week 8's low: Hail Mary Hustle, 70.32, their first.
    const HAL = "## Hail Mary Hustle {team=sleeper:9}\n";
    expect(lineAfter(ws.text, HAL)).toContain(
      "[Weekly low score]{ev=wk.rule.low-score} ([1]{ev=rule.low-score.count} this season)",
    );
    expect(lineAfter(ws.text, HAL)).not.toContain("rule.low-score.winnings");
  });

  test("from: and until: split a rule, keeping the old amount for earlier weeks", async () => {
    const ws = await drafted(
      8,
      `house-rules:
  - id: high-score-early
    name: Weekly high score
    trigger: high-score
    per: week
    outcome: $10
    until: 4
${highScore("$20", "    from: 5\n")}`,
    );
    // Bye Bye Bea: weeks 3 and 4 at $10, week 7 at $20. Gus Bus: week 1 at $10, week 8 at $20.
    expect(lineAfter(ws.text, GUS)).toContain(
      "[Weekly high score]{ev=wk.rule.high-score} ([1]{ev=rule.high-score.count} since week 5) · [$20]{ev=rule.high-score.winnings} to date",
    );
    expect(lineAfter(ws.text, GUS)).not.toContain("wk.rule.high-score-early");
    expect(
      await claimProblems(
        ws,
        BEA,
        "Bea: [2]{ev=rule.high-score-early.count} early, [$20]{ev=rule.high-score-early.winnings}, then [1]{ev=rule.high-score.count} more for [$20]{ev=rule.high-score.winnings}.",
      ),
    ).toEqual([]);
  });

  test("a last-place rule per season goes to the last team once the regular season is over", async () => {
    const LAST = `house-rules:
  - id: last-place
    name: Last place
    trigger: last-place
    per: season
    outcome: writes the recap
`;
    const before = await drafted(8, LAST);
    expect(before.text).not.toContain("wk.rule.last-place");

    // Week 14 is the last regular-season week: Pylon Patrol, 5-9, is 12th.
    const ws = await drafted(14, LAST);
    const PYLON = "## Pylon Patrol {team=sleeper:6}\n";
    expect(lineAfter(ws.text, PYLON)).toContain(
      "[Last place]{ev=wk.rule.last-place} ([1]{ev=rule.last-place.count} this season)",
    );
    expect(lineAfter(ws.text, INTRO)).toContain(
      "[Last place: Pylon Patrol]{ev=wk.rule.last-place}",
    );
  });

  test("a most-left-on-bench rule per season goes to the season's total, not its worst week", async () => {
    // Through week 14: Wendy's Wire left 276.80 on the bench in all; Kim
    // Possible Kicks left the most in one week, 60.75.
    const ws = await drafted(
      14,
      `house-rules:
  - id: bench-season
    name: Season's most left on the bench
    trigger: most-left-on-bench
    per: season
    outcome: $25
`,
    );
    expect(lineAfter(ws.text, INTRO)).toContain(
      "[Season's most left on the bench: Wendy's Wire]{ev=wk.rule.bench-season}",
    );
  });

  test("a trigger the platform can't work out warns to log it by hand and has no winner", async () => {
    const ws = await drafted(
      14,
      `last-place: losers-bracket
house-rules:
  - id: last-place
    name: Last place
    trigger: last-place
    per: season
    outcome: $50
`,
    );
    expect(ws.result.warnings).toContainEqual(
      expect.stringMatching(
        /^league\.md: Last place \(last-place\).*log it by hand/,
      ),
    );
    expect(ws.text).not.toContain("rule.last-place");
  });
});

describe("pot and payouts", () => {
  test("the pot is the buy-in times the teams, and each place's payout is evidence", async () => {
    const ws = await drafted(
      8,
      `buy-in: $50\npayouts: ["70%", "$100", "$80"]\n`,
    );
    expect(
      await claimProblems(
        ws,
        INTRO,
        "Playing for [$600]{ev=stakes.pot}: [$420]{ev=stakes.payout_1} to the winner, [$100]{ev=stakes.payout_2} for second and [$80]{ev=stakes.payout_3} for third.",
      ),
    ).toEqual([]);
  });

  test("a wrong pot is a wrong claim", async () => {
    const ws = await drafted(8, `buy-in: $50\npayouts: ["100%"]\n`);
    expect(
      await claimProblems(ws, INTRO, "Playing for [$500]{ev=stakes.pot}."),
    ).toEqual([expect.objectContaining({ kind: "wrong", id: "stakes.pot" })]);
  });
});

describe("league.md", () => {
  test.each([
    ["an unknown key", "buy-ins: $50\n", /buy-ins/],
    [
      "stakes: none beside stakes fields",
      "stakes: none\nbuy-in: $50\n",
      /stakes: none/,
    ],
    [
      "a per-week champion",
      "house-rules:\n  - id: champ\n    name: Champion\n    trigger: champion\n    per: week\n    outcome: $100\n",
      /champion.*season/,
    ],
    [
      "two rules with one id",
      `house-rules:\n${highScore()}${highScore()}`,
      /high-score.*twice.*its own id/,
    ],
    ["a malformed payout", `payouts: ["half"]\n`, /half/],
    [
      "until: before from:",
      `house-rules:\n${highScore("$10", "    from: 6\n    until: 3\n")}`,
      /until/,
    ],
    [
      "a spirit that isn't serious or joke",
      `house-rules:\n${highScore("$10", "    spirit: silly\n")}`,
      /spirit/,
    ],
    [
      "a rivalry pair of one handle",
      "rivalry-weeks:\n  - week: 8\n    pairs: [[gus, gus]]\n",
      /gus.*itself/,
    ],
    [
      "a handle in two rivalry pairs of one week",
      "rivalry-weeks:\n  - week: 8\n    pairs: [[gus, pete], [gus, wendy]]\n",
      /gus in two pairs/,
    ],
    [
      "a rivalry week given twice",
      "rivalry-weeks:\n  - week: 8\n    pairs: [[gus, pete]]\n  - week: 8\n    pairs: [[gus, wendy]]\n",
      /week 8.*twice/,
    ],
  ])("%s stops the draft", async (_, fields, message) => {
    const ws = await fearTheTurtle(8);
    await writeLeagueFile(ws.dir, fields);
    const failed = draft(ws.dir, ws.deps);
    await expect(failed).rejects.toThrow(WorkspaceFileError);
    await expect(failed).rejects.toThrow(message);
  });

  test("a file with no stakes fields, or stakes: none, drafts with no stakes evidence", async () => {
    for (const fields of ["", "stakes: none\n"]) {
      const ws = await drafted(8, fields);
      expect(ws.text).not.toMatch(/rule\.|stakes\./);
    }
  });
});

describe("drastic corrections", () => {
  test("a stat correction that changes a trigger winner shows on its own line in the data-changed warning", async () => {
    const ws = await drafted(8, `house-rules:\n${highScore()}`);
    const later = beaCorrected(10)({
      ...ws.deps,
      clock: fixedClock("2025-10-30T09:00:00.000Z"),
    });

    const result = await publish(ws.dir, later);

    expect(result.warnings[0]).toMatch(
      /^data changed since .*: \d+ claims? would go stale, run `refresh`\n1 trigger winner changed: Weekly high score in week 8, Gus Bus → Bye Bye Bea$/,
    );
  });

  test("a stat correction that leaves every trigger winner has no trigger line", async () => {
    const ws = await drafted(8, `house-rules:\n${highScore()}`);
    const later = beaCorrected(1)({
      ...ws.deps,
      clock: fixedClock("2025-10-30T09:00:00.000Z"),
    });

    const result = await publish(ws.dir, later);

    expect(result.warnings[0]).toMatch(/^data changed since /);
    expect(result.warnings[0]).not.toContain("trigger winner");
  });
});

describe("a changed outcome", () => {
  test("recomputes winnings to date as if it always applied, with a warning", async () => {
    const ws = await drafted(7, `house-rules:\n${highScore("$10")}`);
    await published(ws.dir, ws.deps);
    await writeLeagueFile(ws.dir, `house-rules:\n${highScore("$20")}`);
    const deps = atWeek(ws.deps, 8);

    const result = await draft(ws.dir, deps);

    expect(result.warnings).toContainEqual(
      "league.md: Weekly high score (high-score) pays $20, not the $10 it paid at week 7: winnings to date count $20 for every week. To keep $10 for earlier weeks, split the rule with until: and from:.",
    );
    const text = await readFile(result.path, "utf8");
    expect(lineAfter(text, GUS)).toContain(
      "[$40]{ev=rule.high-score.winnings}",
    );
  });

  test("a rule split with from: and until: isn't a change in place", async () => {
    const ws = await drafted(7, `house-rules:\n${highScore("$10")}`);
    await published(ws.dir, ws.deps);
    await writeLeagueFile(
      ws.dir,
      `house-rules:
  - id: high-score-early
    name: Weekly high score
    trigger: high-score
    per: week
    outcome: $10
    until: 7
${highScore("$20", "    from: 8\n")}`,
    );

    const result = await draft(ws.dir, atWeek(ws.deps, 8));

    expect(result.warnings.filter((w) => /pays/.test(w))).toEqual([]);
  });
});

const BODY = `## Bye fines
- A bye week costs whoever forgot to set a lineup $5.

## Log
- {week=3}{rule=high-score}{pinned} Bea took the first prize of the year.
- {week=5}{rule=high-score} The Rascals cashed in.
- {week=7} Bo was fined for a late lineup.
- {week=8}{rule=high-score} Gus collected.
`;

describe("league.md's body", () => {
  test("a blurb may cite a stakes section, a house rule or a week's Log entries, and nothing else", async () => {
    const ws = await stakesDraft({
      fields: `house-rules:\n${highScore()}`,
      body: BODY,
    });
    expect(
      await problemsOf(
        ws,
        BEA,
        "Bea [owes a bye fine]{stakes=bye-fines}, chases [the high-score prize]{stakes=high-score} and [cashed in once]{log=w5}. [A side pot]{stakes=side-pots} and [a week-4 fine]{log=w4}.",
        "unknown-id",
      ),
    ).toEqual([
      ["A side pot", "hard"],
      ["a week-4 fine", "hard"],
    ]);
  });

  test.each([
    [
      "an unknown tag in a stakes section",
      "## Fines\n- {fine} $5\n",
      /\{fine\}/,
    ],
    [
      "an unknown tag in the Log",
      "## Log\n- {week=3}{paid} Bea paid.\n",
      /\{paid\}/,
    ],
    ["a Log entry with no week", "## Log\n- Bea paid.\n", /\{week=/],
    [
      "a Log entry naming no house rule",
      "## Log\n- {week=3}{rule=nope} Bea paid.\n",
      /nope/,
    ],
    ["a heading with no words", "## ***\n- a\n", /no words/],
    [
      "two sections with one name",
      "## Fines\n- a\n\n## fines\n- b\n",
      /two sections/,
    ],
    [
      "a {local} marker",
      "## Fines\n- {local} Bo owes $5.\n",
      /local-only isn't supported yet; remove the entry or the marker/,
    ],
  ])("%s stops the draft", async (_, body, message) => {
    const ws = await fearTheTurtle(8);
    await writeLeagueFile(ws.dir, `house-rules:\n${highScore()}`, body);
    const failed = draft(ws.dir, ws.deps);
    await expect(failed).rejects.toThrow(WorkspaceFileError);
    await expect(failed).rejects.toThrow(message);
  });

  test("stakes: none beside rules in the body stops the draft", async () => {
    const ws = await fearTheTurtle(8);
    await writeLeagueFile(ws.dir, "stakes: none\n", "## Fines\n- $5 a week.\n");
    await expect(draft(ws.dir, ws.deps)).rejects.toThrow(/stakes: none/);
  });

  test("text above the first heading warns that it isn't sent", async () => {
    const ws = await stakesDraft({ body: "Loose words.\n\n## Fines\n- $5.\n" });
    expect(ws.result.warnings).toContainEqual(
      expect.stringMatching(
        /^league\.md line \d+ is above the first ## heading/,
      ),
    );
  });
});

describe("rivalry weeks", () => {
  const RIVALS = (pair: string, week = 8) =>
    `rivalry-weeks:\n  - week: ${week}\n    pairs: [[${pair}]]\n`;
  const PYLON = "## Pylon Patrol {team=sleeper:6}\n";

  test("a rivalry week the schedule pairs gives each team its rival, and the league its rivalry", async () => {
    // Week 8: Gus Bus plays Pylon Patrol.
    const ws = await stakesDraft({
      fields: RIVALS("gus, pete"),
      handles: ["gus", "pete"],
    });
    expect(lineAfter(ws.text, GUS)).toContain(
      "Rivalry: [Pylon Patrol]{ev=rival}",
    );
    expect(lineAfter(ws.text, PYLON)).toContain("Rivalry: [Gus Bus]{ev=rival}");
    // Gus Bus's 133.22 was the week's high.
    expect(lineAfter(ws.text, INTRO)).toContain(
      "[Rivalry week: Gus Bus and Pylon Patrol]{ev=wk.rivalry.1}, won by [Gus Bus]{ev=wk.rivalry.1.winner}",
    );
    expect(ws.result.warnings.filter((w) => /rivalry/i.test(w))).toEqual([]);
    expect(
      ws.result.problems.filter(
        (p) => /rival/.test(p.id ?? "") || p.section === "Intro",
      ),
    ).toEqual([]);
  });

  test("each rivalry pair is its own league item, so a claim mixing two pairs is wrong", async () => {
    // Week 8: Gus Bus plays Pylon Patrol, Wendy's Wire plays Frank's FAAB Fund.
    const ws = await stakesDraft({
      fields:
        "rivalry-weeks:\n  - week: 8\n    pairs: [[gus, pete], [wendy, frank]]\n",
      handles: ["gus", "pete", "wendy", "frank"],
    });
    expect(lineAfter(ws.text, INTRO)).toContain(
      "[Rivalry week: Wendy's Wire and Frank's FAAB Fund]{ev=wk.rivalry.2}",
    );
    expect(
      await problemsOf(
        ws,
        INTRO,
        "[Gus Bus and Wendy's Wire]{ev=wk.rivalry.1} met.",
        "wrong",
      ),
    ).toEqual([["Gus Bus and Wendy's Wire", "hard"]]);
  });

  test("a rivalry week whose handles the schedule doesn't pair warns, and gives no rival", async () => {
    const ws = await stakesDraft({
      fields: RIVALS("gus, wendy"),
      handles: ["gus", "wendy"],
    });
    expect(ws.result.warnings).toContainEqual(
      "league.md: rivalry week 8 pairs gus and wendy, but the schedule doesn't: Gus Bus plays Pylon Patrol that week.",
    );
    expect(ws.text).not.toContain("rival");
  });

  test("a rivalry handle linked to no team in the league warns", async () => {
    const ws = await stakesDraft({
      fields: RIVALS("gus, nobody"),
      handles: ["gus"],
    });
    expect(ws.result.warnings).toContainEqual(
      expect.stringMatching(
        /^league\.md: rivalry week 8 names nobody, .*no team/,
      ),
    );
    expect(ws.text).not.toContain("rival");
  });

  test("next week's rivalry shows as upcoming", async () => {
    const ws = await stakesDraft({
      fields: RIVALS("gus, pete", 9),
      handles: ["gus", "pete"],
    });
    expect(lineAfter(ws.text, GUS)).toContain(
      "Rivalry next week: [Pylon Patrol]{ev=next_rival}",
    );
  });
});

describe("platform settings", () => {
  test("are league evidence, read fresh and never written to league.md", async () => {
    const ws = await drafted(8, "");
    const before = await readFile(
      join(ws.dir, "seasons", "2025", "league.md"),
      "utf8",
    );
    expect(
      await claimProblems(
        ws,
        INTRO,
        "[6]{ev=platform.playoff_spots} teams make it from week [15]{ev=platform.playoff_start}, not [8]{ev=platform.playoff_spots}, with [100]{ev=platform.faab_budget} FAAB.",
      ),
    ).toEqual([
      expect.objectContaining({ kind: "wrong", text: "8" }),
      // Fear The Turtle has no FAAB.
      expect.objectContaining({ kind: "unknown-id", text: "100" }),
    ]);
    expect(
      await readFile(join(ws.dir, "seasons", "2025", "league.md"), "utf8"),
    ).toBe(before);
  });
});

describe("the no-stakes flag", () => {
  test("stakes: none flags a prize mention in a blurb; unrecorded stakes don't", async () => {
    const words = "Bea is chasing the prize.";
    const none = await drafted(8, "stakes: none\n");
    expect(await problemsOf(none, BEA, words, "no-stakes")).toEqual([
      ["prize", "hard"],
    ]);
    const unrecorded = await drafted(8, "");
    expect(await problemsOf(unrecorded, BEA, words, "no-stakes")).toEqual([]);
  });
});

describe("stakes sent to the LLM", () => {
  const REPLY = "## {intro}\nA quiet week.";

  test("only this and last week's Log entries, plus pinned ones, reach the prompt", async () => {
    const ws = await stakesDraft({
      fields: `house-rules:\n${highScore()}`,
      body: BODY,
      reply: REPLY,
    });
    expect(ws.prompt).toContain("Gus collected.");
    expect(ws.prompt).toContain("Bo was fined for a late lineup.");
    expect(ws.prompt).toContain("Bea took the first prize of the year.");
    expect(ws.prompt).not.toContain("The Rascals cashed in.");
    expect(ws.prompt).toContain(
      "A bye week costs whoever forgot to set a lineup $5.",
    );
  });

  test("recorded stakes reach the prompt, with the rules for using them", async () => {
    const ws = await stakesDraft({
      fields: `buy-in: $50\nhouse-rules:\n${highScore()}  - id: sacko
    name: The Sacko
    outcome: wears the jersey
    spirit: joke
`,
      reply: REPLY,
    });
    expect(ws.prompt).toContain("## Stakes");
    expect(ws.prompt).toContain("Buy-in: $50 per team");
    expect(ws.prompt).toContain("high-score: Weekly high score, $10");
    expect(ws.prompt).toContain("sacko: The Sacko, wears the jersey (a joke)");
    expect(ws.system).not.toContain(
      "Don't mention money, prizes or punishments.",
    );
    expect(ws.system).toContain("{stakes=<section>}");
    expect(ws.system).toContain("wk.rule.<id>");
  });

  test("stakes: none tells the LLM it's bragging rights only; unrecorded stakes say nothing", async () => {
    const none = await stakesDraft({ fields: "stakes: none\n", reply: REPLY });
    expect(none.prompt).toMatch(/## Stakes\n.*bragging rights only/);
    const unrecorded = await stakesDraft({ reply: REPLY });
    expect(unrecorded.prompt).not.toContain("## Stakes");
  });

  test("{stakes=…} and a sent {log=w<N>} pass the LLM gate; an unsent Log week fails it", async () => {
    const fields = `house-rules:\n${highScore()}`;
    const passed = await stakesDraft({
      fields,
      body: BODY,
      reply:
        "## {intro}\nGus [collected again]{log=w8}, and [bye fines]{stakes=bye-fines} loom.",
    });
    expect(passed.requests).toHaveLength(1);
    const failed = await stakesDraft({
      fields,
      body: BODY,
      reply: "## {intro}\nThe Rascals [cashed in]{log=w5}.",
    });
    expect(failed.requests).toHaveLength(3);
    // `check` accepts any Log week, so only the draft can say it wasn't sent.
    expect(failed.result.warnings).toContainEqual(
      'The LLM cited lore or stakes it wasn\'t sent, so it may have made this up: "cashed in".',
    );
  });

  test("under stakes: none, LLM prose mentioning a prize fails the LLM gate", async () => {
    const ws = await stakesDraft({
      fields: "stakes: none\n",
      reply: "## {intro}\nEveryone wants the prize.",
    });
    expect(ws.requests).toHaveLength(3);
  });
});
