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
async function writeLeagueFile(dir: string, fields: string): Promise<void> {
  const season = join(dir, "seasons", "2025");
  await mkdir(season, { recursive: true });
  await writeFile(
    join(season, "league.md"),
    `---
league: 1
season: "2025"
family-league: off
${fields}---

Free text rules.
`,
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
  return problems.filter((p) => /^(wk\.)?(rule|stakes)\./.test(p.id ?? ""));
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
