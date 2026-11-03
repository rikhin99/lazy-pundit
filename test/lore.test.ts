import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  check,
  draft,
  draftData,
  refresh,
  WorkspaceFileError,
} from "../src/index.ts";
import { loadLore } from "../src/lore.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { readWorkspace } from "../src/workspace.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  committed,
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  type Json,
  operator,
  patchingTransport,
  statCorrection,
} from "./support/workspace.ts";

const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;

async function writeLore(dir: string, body: string): Promise<void> {
  await writeFile(join(dir, "lore.md"), `---\nlore: 1\n---\n${body}`);
}

/** A team's first manager's account, from the committed week 8. */
async function accountOf(team: string): Promise<string> {
  const league = await committed(8);
  const account = league.teams.find((t) => t.id === team)?.managers[0];
  return `sleeper:${account?.accountId}`;
}

/** Links a manager handle to an account in `workspace.md`. */
async function linkHandle(dir: string, handle: string, account: string) {
  const path = join(dir, "workspace.md");
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    text.replace("\n---\n", `\nhandles:\n  ${handle}: ["${account}"]\n---\n`),
  );
}

/** Replaces Gus Bus's blurb in a draft. */
async function setGusBlurb(path: string, blurb: string): Promise<void> {
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    text.replace(
      /(## Gus Bus \{team=sleeper:1\}\n)[\s\S]*?(\n## )/,
      `$1${blurb}\n$2`,
    ),
  );
}

/** Week 8 drafted, with `lore.md` written after, and Gus Bus's blurb editable. */
async function draftedWithLore(lore: string) {
  const ws = await fearTheTurtle(8);
  const { path } = await draft(ws.dir, ws.deps);
  await writeLore(ws.dir, lore);
  const gusSays = (blurb: string) => setGusBlurb(path, blurb);
  return { ...ws, path, gusSays };
}

/** Each problem in the blurb as its words and kind. */
async function claimProblems(dir: string) {
  const { problems } = await check(dir, await operator());
  return problems
    .filter((p) => p.kind !== "moved")
    .map((p) => [p.text, p.kind]);
}

describe("nicknames reach the validator", () => {
  test("a team's nickname makes that team's stats count", async () => {
    const { dir, gusSays } = await draftedWithLore(
      "## {team=sleeper:3}\nnicknames: Karna, The Mob\n",
    );
    // Bench Mob is 7-1 at week 8; the section's own team, Gus Bus, is 4-4.
    await gusSays("Karna is 7-1 and The Mob knows it.");
    expect(await claimProblems(dir)).toEqual([]);

    await gusSays("Karna is 6-2.");
    expect(await claimProblems(dir)).toEqual([["6-2", "wrong"]]);
  });

  test("a manager's nickname counts for their current team through the handle's link", async () => {
    const { dir, gusSays } = await draftedWithLore(
      "## {manager=bo}\nnicknames: Karna\n",
    );
    await linkHandle(dir, "bo", await accountOf("sleeper:3"));
    await gusSays("Karna is 7-1.");
    expect(await claimProblems(dir)).toEqual([]);
  });

  test("a manager section with no link counts for no team", async () => {
    const { dir, gusSays } = await draftedWithLore(
      "## {manager=bo}\nnicknames: Karna\n",
    );
    await gusSays("Karna is 7-1.");
    expect(await claimProblems(dir)).toEqual([["7-1", "wrong"]]);
  });

  test("with no lore.md, the same sentence is read as the section's team", async () => {
    const ws = await fearTheTurtle(8);
    const { path } = await draft(ws.dir, ws.deps);
    await setGusBlurb(path, "Karna is 7-1.");
    expect(await claimProblems(ws.dir)).toEqual([["7-1", "wrong"]]);
  });

  test("a nickname in a line comment or list form still counts, in any case", async () => {
    const { dir, gusSays } = await draftedWithLore(
      "## {team=sleeper:3}\n<!-- nicknames: Not Used -->\n- nicknames: Karna’s Crew\n",
    );
    await gusSays("karna's crew is 7-1.");
    expect(await claimProblems(dir)).toEqual([]);
  });
});

describe("a nickname that reads as two holders' is a load error", () => {
  test("a word in another team's name, or holding that name", async () => {
    const inside = await draftedWithLore(
      "## {team=sleeper:9}\nnicknames: Mob\n",
    );
    await expect(claimProblems(inside.dir)).rejects.toThrow(
      /"Mob".*team:sleeper:9.*Bench Mob/,
    );
    const around = await draftedWithLore(
      "## {team=sleeper:9}\nnicknames: Bench Mob Rules\n",
    );
    await expect(claimProblems(around.dir)).rejects.toThrow(/Bench Mob Rules/);
    const nested = await draftedWithLore(
      "## {team=sleeper:9}\nnicknames: Karna\n\n## {team=sleeper:1}\nnicknames: Big Karna\n",
    );
    await expect(claimProblems(nested.dir)).rejects.toThrow(
      /"Big Karna".*team:sleeper:9.*team:sleeper:1/,
    );
  });

  test("not one section saying it twice, with no team to count for", async () => {
    const { dir } = await draftedWithLore(
      "## {manager=gone}\nnicknames: Karna, karna\n",
    );
    expect(await claimProblems(dir)).toEqual([]);
  });

  test("refresh stops on a clash with fresh names, leaving the draft alone", async () => {
    const ws = await fearTheTurtle(8);
    const { path } = await draft(ws.dir, ws.deps);
    await writeLore(ws.dir, "## {team=sleeper:1}\nnicknames: Karna\n");
    const before = await readFile(path, "utf8");
    const renamed = {
      ...ws.deps,
      transport: patchingTransport(ws.deps.transport, {
        [`${LEAGUE}/matchups/8`]: statCorrection(1, 5),
        [`${LEAGUE}/users`]: (users: Json) => {
          const bo = users.find(
            (u: Json) => u.display_name === "benchwarmer_bo",
          );
          bo.display_name = "Karna";
        },
      }),
    };
    await expect(refresh(ws.dir, renamed)).rejects.toThrow(/"Karna"/);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  const twoTeams =
    "## {team=sleeper:3}\nnicknames: Karna\n\n## {team=sleeper:1}\nnicknames: karna\n";

  test("two sections naming it, with both named", async () => {
    const { dir } = await draftedWithLore(twoTeams);
    await expect(claimProblems(dir)).rejects.toThrow(
      /lore\.md: the nickname "karna".*team:sleeper:3.*team:sleeper:1/,
    );
  });

  test("another team's name or manager's display name", async () => {
    const taken = await draftedWithLore(
      "## {team=sleeper:1}\nnicknames: Bench Mob\n",
    );
    await expect(claimProblems(taken.dir)).rejects.toThrow(
      /"Bench Mob".*team:sleeper:1.*Bench Mob/,
    );
    const manager = await draftedWithLore(
      "## {team=sleeper:1}\nnicknames: benchwarmer_bo\n",
    );
    await expect(claimProblems(manager.dir)).rejects.toThrow(
      /"benchwarmer_bo".*team:sleeper:1.*Bench Mob/,
    );
  });

  test("a departed manager still holds their nickname", async () => {
    const { dir } = await draftedWithLore(
      "## {manager=gone}\nnicknames: Karna\n\n## {team=sleeper:3}\nnicknames: Karna\n",
    );
    await expect(claimProblems(dir)).rejects.toThrow(
      /manager:gone.*team:sleeper:3/,
    );
  });

  test("not when both sections mean the same team, as setup's prefill does", async () => {
    const { dir, gusSays } = await draftedWithLore(
      "## {manager=bo}\nnicknames: Karna, benchwarmer_bo\n\n## {team=sleeper:3}\nnicknames: Karna, Bench Mob, benchwarmer_bo\n",
    );
    await linkHandle(dir, "bo", await accountOf("sleeper:3"));
    await gusSays("Karna is 7-1.");
    expect(await claimProblems(dir)).toEqual([]);
  });

  test("draft stops on it before it writes a snapshot", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, twoTeams);
    await expect(draft(ws.dir, ws.deps)).rejects.toThrow(/"karna"/);
    expect(existsSync(join(ws.dir, ".snapshots"))).toBe(false);
  });
});

describe("the file's shape", () => {
  test.each([
    [
      "an unknown tag",
      "## League\n- {private} a secret\n",
      /line 5: \{private\}/,
    ],
    [
      "a tag beside heading text",
      "## Bo {manager=bo}\n",
      /line 4: \{manager=bo\}/,
    ],
    [
      "a team tag that isn't platform:id",
      "## {team=3}\n",
      /line 4: \{team=3\}/,
    ],
    ["a section tag in an entry", "## League\n- see {manager=bo}\n", /line 5/],
    [
      "a second nicknames line",
      "## {team=sleeper:3}\nnicknames: A\nnicknames: B\n",
      /line 6.*one nicknames: line/,
    ],
    [
      "nicknames outside a manager or team",
      "## League\nnicknames: A\n",
      /line 5.*manager or team section/,
    ],
    [
      "a type off the list",
      "## League\ntype: coworkers\n",
      /line 5.*work, family, friends or other/,
    ],
    [
      "two sections with one name",
      "## Running jokes\n\n## running jokes\n",
      /running-jokes.*lines 4 and 6/,
    ],
    ["a heading with no name", "## !!!\n", /line 4/],
  ])("%s is a load error", async (_case, lore, message) => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, lore);
    const stopped = draft(ws.dir, ws.deps);
    await expect(stopped).rejects.toThrow(WorkspaceFileError);
    await expect(stopped).rejects.toThrow(message);
  });

  test("a handle's link that isn't platform:id is an error in workspace.md", async () => {
    const { dir } = await draftedWithLore("## League\n");
    await linkHandle(dir, "bo", "3");
    await expect(claimProblems(dir)).rejects.toThrow(/<platform>:<account id>/);
  });

  test("the wrong lore version is a load error", async () => {
    const ws = await fearTheTurtle(8);
    await writeFile(join(ws.dir, "lore.md"), "---\nlore: 2\n---\n");
    await expect(draft(ws.dir, ws.deps)).rejects.toThrow("lore.md is lore 2");
  });

  test("sections, entries and the league type come out, comments and reserved lines left out", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(
      ws.dir,
      `<!-- Don't write {anything} private. -->
# Our league

## League
type: friends
- Founded in a pub

## {manager=bo}
nicknames: Karna
- Lives in Leeds <!-- or was it York? -->
* Hates kickers

## {team=sleeper:3}
## Running jokes
The 2019 trade

## Draft-day traditions!
type: not reserved here
`,
    );
    const lore = await loadLore(await readWorkspace(ws.dir));
    expect(lore.type).toBe("friends");
    expect(lore.sections.map((s) => [s.name, s.nicknames, s.entries])).toEqual([
      ["league", [], ["Founded in a pub"]],
      ["manager:bo", ["Karna"], ["Lives in Leeds", "Hates kickers"]],
      ["team:sleeper:3", [], []],
      ["running-jokes", [], ["The 2019 trade"]],
      ["draft-day-traditions", [], ["type: not reserved here"]],
    ]);
  });
});

describe("{lore=…} tags cite sections that exist", () => {
  test("a missing section is an unknown ID, and one that exists passes", async () => {
    const { dir, gusSays } = await draftedWithLore(
      "## {manager=bo}\n- Hates kickers\n\n## Running jokes\n- The trade\n",
    );
    await gusSays(
      "[Bo hates kickers]{lore=manager:bo}, [the trade]{lore=running-jokes} and [a bet]{lore=manager:nobody}.",
    );
    expect(await claimProblems(dir)).toEqual([["a bet", "unknown-id"]]);
  });

  test("the LLM gate accepts a section lore has and rejects one it hasn't", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## {manager=bo}\n- Hates kickers\n");
    const data = draftData(await committed(8), 8);
    const reply = (section: string) =>
      [
        `## {intro}\n${data.intro}`,
        ...Object.entries(data.teams).map(
          ([id, t]) =>
            `## {team=${id}}\n[Hates kickers]{lore=${section}}. ${t.statLine}`,
        ),
      ].join("\n\n");
    const llm = scriptedLlm(reply("manager:bo"));
    ws.deps.llm = llm;
    ws.deps.env.anthropicApiKey = "sk-ant-api03-test-key";
    const passed = await draft(ws.dir, ws.deps);
    expect(passed.problems.filter((p) => p.kind === "unknown-id")).toEqual([]);
    expect(llm.requests).toHaveLength(1);

    const missing = await fearTheTurtle(8);
    await writeLore(missing.dir, "## {manager=bo}\n- Hates kickers\n");
    const failing = scriptedLlm(reply("manager:nobody"));
    missing.deps.llm = failing;
    missing.deps.env.anthropicApiKey = "sk-ant-api03-test-key";
    await draft(missing.dir, missing.deps);
    expect(failing.requests).toHaveLength(3);
  });
});

describe("{local} stops a draft", () => {
  const MESSAGE =
    "local-only isn't supported yet; remove the entry or the marker";

  test("with the agreed message, before any snapshot or LLM call", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## League\n- A secret {local}\n");
    const llm = scriptedLlm();
    ws.deps.llm = llm;
    ws.deps.env.anthropicApiKey = "sk-ant-api03-test-key";
    await expect(draft(ws.dir, ws.deps)).rejects.toThrow(
      `lore.md line 5: ${MESSAGE}`,
    );
    expect(llm.requests).toEqual([]);
    expect(existsSync(join(ws.dir, ".snapshots"))).toBe(false);
  });

  test("and with no key too, since the next run with one would send it", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## League\n- A secret {local}\n");
    await expect(draft(ws.dir, ws.deps)).rejects.toThrow(MESSAGE);
  });

  test("check still reads the file, since nothing is sent", async () => {
    const { dir, gusSays } = await draftedWithLore(
      "## {team=sleeper:3}\nnicknames: Karna\n- A secret {local}\n",
    );
    await gusSays("Karna is 7-1.");
    expect(await claimProblems(dir)).toEqual([]);
  });

  test("a {local} in a comment beside an entry stops it too, failing closed", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## League\n- A secret <!-- {local} -->\n");
    await expect(draft(ws.dir, ws.deps)).rejects.toThrow(MESSAGE);
  });
});

describe("a nickname that's a word in the league stat line's clinch label", () => {
  test("doesn't turn the stat line's own tag wrong", async () => {
    const ws = await fearTheTurtle(14);
    await writeLore(ws.dir, "## {team=sleeper:9}\nnicknames: Week\n");
    const { problems } = await draft(ws.dir, ws.deps);
    expect(problems.filter((p) => p.severity === "hard")).toEqual([]);
  });
});
