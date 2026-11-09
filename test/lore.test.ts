import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  check,
  type Deps,
  DraftExistsError,
  draft,
  draftData,
  publish,
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
  frontMatter,
  type Json,
  operator,
  type Patch,
  patchingTransport,
  statCorrection,
  withoutReminder,
} from "./support/workspace.ts";

const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;

async function writeLore(dir: string, body: string): Promise<void> {
  await writeFile(join(dir, "lore.md"), `---\nlore: 1\n---\n${body}`);
}

/** The prompt of a week 8 LLM draft with this lore, and the draft's result. */
async function draftedByLlm(
  lore: string,
  link?: [string, string],
  reply = "## {intro}\nA quiet week.",
) {
  const ws = await fearTheTurtle(8);
  await writeLore(ws.dir, lore);
  if (link) await linkHandle(ws.dir, ...link);
  const llm = scriptedLlm(reply);
  ws.deps.llm = llm;
  ws.deps.env.anthropicApiKey = "sk-ant-test";
  const result = await draft(ws.dir, ws.deps);
  return { ...ws, result, llm, prompt: llm.requests[0]?.prompt ?? "" };
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
  return withoutReminder(problems)
    .filter((p) => p.kind !== "moved")
    .map((p) => [p.text, p.kind]);
}

const BENCH_MOB = "Bench Mob (sleeper:3)";

/** The warning for a nickname clashing with a name in week 8's draft's snapshot. */
function snapshotClash(nickname: string, section: string, team: string) {
  return `lore.md: the nickname "${nickname}" points at both ${section} and ${team} in week-08.md's snapshot, so this check counts it for ${team} only. Remove it from ${section} to clear this; \`draft\`, and \`refresh\` onto changed data, stop on it while the platform has that name`;
}

/** The warning for a nickname clashing with a name in fresh data. */
function freshClash(nickname: string, section: string, team: string) {
  return `lore.md: the nickname "${nickname}" points at both ${section} and ${team} in the fresh data. Keep it on one: \`draft\`, and \`refresh\` onto changed data, stop on it`;
}

/** The warnings of `check` that are nickname clashes. */
async function snapshotClashes(dir: string): Promise<string[]> {
  const { warnings } = await check(dir, await operator());
  return warnings.filter((w) => w.includes("points at both"));
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
    expect(await snapshotClashes(inside.dir)).toEqual([
      snapshotClash("Mob", "team:sleeper:9", BENCH_MOB),
    ]);
    const around = await draftedWithLore(
      "## {team=sleeper:9}\nnicknames: Bench Mob Rules\n",
    );
    expect(await snapshotClashes(around.dir)).toEqual([
      snapshotClash("Bench Mob Rules", "team:sleeper:9", BENCH_MOB),
    ]);
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

  test("refresh stops on a clash with fresh names, writing nothing", async () => {
    const ws = await fearTheTurtle(8);
    const { path } = await draft(ws.dir, ws.deps);
    await writeLore(ws.dir, "## {team=sleeper:1}\nnicknames: Karna\n");
    const before = await readFile(path, "utf8");
    const snapshots = await readdir(join(ws.dir, ".snapshots"));
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
    expect(await readdir(join(ws.dir, ".snapshots"))).toEqual(snapshots);
  });

  const twoTeams =
    "## {team=sleeper:3}\nnicknames: Karna\n\n## {team=sleeper:1}\nnicknames: karna\n";

  test("two sections naming it, with both named", async () => {
    const { dir } = await draftedWithLore(twoTeams);
    await expect(claimProblems(dir)).rejects.toThrow(
      /lore\.md: the nickname "karna".*team:sleeper:3.*team:sleeper:1/,
    );
  });

  test("another team's name or manager's display name, which check only warns of", async () => {
    const taken = await draftedWithLore(
      "## {team=sleeper:1}\nnicknames: Bench Mob\n",
    );
    expect(await snapshotClashes(taken.dir)).toEqual([
      snapshotClash("Bench Mob", "team:sleeper:1", BENCH_MOB),
    ]);
    const manager = await draftedWithLore(
      "## {team=sleeper:1}\nnicknames: benchwarmer_bo\n",
    );
    expect(await snapshotClashes(manager.dir)).toEqual([
      snapshotClash("benchwarmer_bo", "team:sleeper:1", BENCH_MOB),
    ]);
  });

  test("check leaves a nickname that clashes with a team's name out, so the name counts only for that team", async () => {
    const { dir, gusSays } = await draftedWithLore(
      "## {team=sleeper:1}\nnicknames: Bench Mob\n",
    );
    await gusSays("Bench Mob is 7-1.");
    expect(await claimProblems(dir)).toEqual([]);
  });

  test("draft stops on a clash with a team's name before it writes a snapshot", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## {team=sleeper:1}\nnicknames: Bench Mob\n");
    await expect(draft(ws.dir, ws.deps)).rejects.toThrow(
      /"Bench Mob".*team:sleeper:1.*Bench Mob/,
    );
    expect(existsSync(join(ws.dir, ".snapshots"))).toBe(false);
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

describe("a clash with names only one version of the league holds", () => {
  const BO_AS_KARNA = {
    [`${LEAGUE}/users`]: (users: Json) => {
      const bo = users.find((u: Json) => u.display_name === "benchwarmer_bo");
      bo.display_name = "Karna";
    },
  };
  const KARNA_LORE = "## {team=sleeper:1}\nnicknames: Karna\n";
  /** 1.8 more for Gus Bus in week 8 makes the draft's "55" margins false. */
  const GUS_CORRECTED = { [`${LEAGUE}/matchups/8`]: statCorrection(1, 1.8) };
  const withPatches = (deps: Deps, patches: Record<string, Patch>) => ({
    ...deps,
    transport: patchingTransport(deps.transport, patches),
  });

  /** Week 8 drafted while bo was called Karna, then lore giving Karna to another team. */
  async function draftedAsKarna() {
    const ws = await fearTheTurtle(8);
    const { path } = await draft(ws.dir, withPatches(ws.deps, BO_AS_KARNA));
    await writeLore(ws.dir, KARNA_LORE);
    return { ...ws, path };
  }
  const clash = snapshotClash("Karna", "team:sleeper:1", BENCH_MOB);

  test("check warns of a name only the draft's snapshot holds, and carries on", async () => {
    const { dir } = await draftedAsKarna();
    expect(await snapshotClashes(dir)).toEqual([clash]);
  });

  test("refresh with no data change carries on with the warning", async () => {
    const { dir, deps } = await draftedAsKarna();
    const { changes, warnings } = await refresh(dir, deps);
    expect(changes).toEqual([]);
    expect(warnings).toContain(clash);
  });

  test("refresh onto data without that name moves the draft, and the warning goes", async () => {
    const { dir, deps, path } = await draftedAsKarna();
    const before = frontMatter(await readFile(path, "utf8")).snapshot;
    const { changes, warnings } = await refresh(
      dir,
      withPatches(deps, GUS_CORRECTED),
    );
    expect(changes).not.toEqual([]);
    expect(frontMatter(await readFile(path, "utf8")).snapshot).not.toBe(before);
    expect(warnings.filter((w) => w.includes("points at both"))).toEqual([]);
  });

  test("a second draft says what clashes before it's refused as already there", async () => {
    const { dir, deps } = await draftedAsKarna();
    const told: string[] = [];
    await expect(
      draft(dir, deps, { onWarnings: (w) => told.push(...w) }),
    ).rejects.toThrow(DraftExistsError);
    expect(told).toContain(clash);
  });

  test("publish gives the stale count with a clash in the fresh names", async () => {
    const ws = await fearTheTurtle(8);
    await draft(ws.dir, ws.deps);
    await writeLore(ws.dir, KARNA_LORE);
    const corrected = await publish(
      ws.dir,
      withPatches(ws.deps, GUS_CORRECTED),
    );
    const stale = corrected.warnings.find((w) => w.startsWith("data changed"));
    expect(stale).toMatch(/: \d+ claims would go stale/);

    const renamed = await publish(
      ws.dir,
      withPatches(ws.deps, { ...GUS_CORRECTED, ...BO_AS_KARNA }),
    );
    expect(renamed.warnings).toEqual([
      ...corrected.warnings,
      freshClash("Karna", "team:sleeper:1", BENCH_MOB),
    ]);
  });

  test("refresh with no data change warns of a clash in the fresh names", async () => {
    const ws = await fearTheTurtle(8);
    await draft(ws.dir, ws.deps);
    await writeLore(ws.dir, KARNA_LORE);
    const { changes, warnings } = await refresh(
      ws.dir,
      withPatches(ws.deps, BO_AS_KARNA),
    );
    expect(changes).toEqual([]);
    expect(warnings).toContain(
      freshClash("Karna", "team:sleeper:1", BENCH_MOB),
    );
  });

  test("publish says it for both the snapshot and fresh data when both have the clash", async () => {
    const { dir, deps } = await draftedAsKarna();
    const { warnings } = await publish(dir, withPatches(deps, BO_AS_KARNA));
    expect(warnings.filter((w) => w.includes("points at both"))).toEqual([
      clash,
      freshClash("Karna", "team:sleeper:1", BENCH_MOB),
    ]);
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
    await linkHandle(ws.dir, "bo", await accountOf("sleeper:3"));
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

describe("lore in the prompt", () => {
  test("every section reaches the prompt under the name a tag cites, with the league type, nicknames and which team", async () => {
    const { prompt, llm } = await draftedByLlm(
      `## League
type: friends
- Founded in a pub.

## {manager=bo}
nicknames: Bobcat
- Bo is a dentist.
<!-- never send this comment -->

## {team=sleeper:4}
- Named after a bus.

## Running jokes
- The Toilet Bowl trophy.

## Empty one
`,
      ["bo", await accountOf("sleeper:3")],
    );
    expect(prompt).toContain("League type: friends");
    expect(prompt).toContain("- Founded in a pub.");
    expect(prompt).toMatch(
      /### manager:bo \(manages Bench Mob\)\nNicknames: Bobcat\n- Bo is a dentist\./,
    );
    expect(prompt).toMatch(
      /### team:sleeper:4 \([^)]+\)\n- Named after a bus\./,
    );
    expect(prompt).toMatch(/### running-jokes\n- The Toilet Bowl trophy\./);
    expect(prompt).not.toContain("empty-one");
    expect(prompt).not.toContain("never send");
    expect(llm.requests[0]?.system).toContain("{lore=<section>}");
  });

  test("with no lore the prompt has no lore block", async () => {
    const { prompt } = await draftedByLlm("");
    expect(prompt).not.toContain("## Lore");
  });

  test("a {lore=…} tag the LLM writes passes the LLM gate", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## Running jokes\n- The Toilet Bowl trophy.\n");
    const llm = scriptedLlm(
      "## {intro}\nThe [Toilet Bowl trophy]{lore=running-jokes} looms.",
    );
    ws.deps.llm = llm;
    ws.deps.env.anthropicApiKey = "sk-ant-test";
    await draft(ws.dir, ws.deps);
    expect(llm.requests).toHaveLength(1);
  });
});

describe("lore that isn't sent", () => {
  test("a departed manager's section is absent from the prompt, kept in the file and still citable, with no warning", async () => {
    const { prompt, result, dir } = await draftedByLlm(
      "## {manager=gone}\nnicknames: Ghosty\n- Moved to Lisbon.\n",
      ["gone", "sleeper:no-such-account"],
    );
    expect(prompt).not.toContain("Lisbon");
    expect(prompt).not.toContain("Ghosty");
    expect(prompt).not.toContain("manager:gone");
    expect(result.warnings.filter((w) => w.includes("lore"))).toEqual([]);
    expect(await readFile(join(dir, "lore.md"), "utf8")).toContain("Lisbon");
    await setGusBlurb(
      result.path,
      "Still missing [Lisbon]{lore=manager:gone}.",
    );
    expect(await claimProblems(dir)).toEqual([]);
  });

  test("a handle with no link isn't sent, and the draft says so with its line", async () => {
    const { prompt, result } = await draftedByLlm(
      "## {manager=bo}\n- Bo is a dentist.\n",
    );
    expect(prompt).not.toContain("dentist");
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/^lore\.md line 4: manager:bo isn't sent/),
    );
  });

  test("with no Anthropic key nothing is sent, so an unlinked handle draws no warning", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## {manager=bo}\n- Bo is a dentist.\n");
    const { warnings } = await draft(ws.dir, ws.deps);
    expect(warnings).toEqual([]);
  });

  test("text above the first heading is in no section, so it's named in a warning and not sent", async () => {
    const { prompt, result } = await draftedByLlm(
      "- Floating fact.\n\n## Running jokes\n- A joke.\n",
    );
    expect(prompt).not.toContain("Floating fact");
    expect(result.warnings).toContainEqual(
      "lore.md line 4 is above the first ## heading, so it isn't sent. Move it under a heading.",
    );
  });
});

describe("the personal-data warning", () => {
  const warned = async (line: string) => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, `## Running jokes\n- A joke.\n- ${line}\n`);
    const { warnings } = await draft(ws.dir, ws.deps);
    return warnings.join("\n");
  };

  test.each([
    ["phone number", "Call Bo on 555-123-4567."],
    ["phone number", "Call Bo on (555) 123-4567."],
    ["phone number", "Call Bo on +44 20 7946 0958."],
    ["phone number", "Call Bo on 555-1234."],
    ["email", "Write to bo.smith+ff@example.co.uk any time."],
    ["street address", "Bo lives at 42 Elm Street."],
    ["street address", "The draft party is at 1600 North Oak Ave."],
    ["long digit run", "His card ends 4111111111111111."],
    ["long digit run", "SSN 078-05-1120."],
    ["date of birth", "Bo was born on 3/14/1990."],
    ["date of birth", "Her birthday is March 3."],
    ["date of birth", "DOB: 1990-03-14"],
    ["date of birth", "Born 14 March 1990."],
  ])("names a %s with its line: %s", async (kind, line) => {
    const text = await warned(line);
    expect(text).toContain(`line 6 (${kind})`);
  });

  test.each([
    "Bo beat Kim 132.4-98.7 in the 2023 final.",
    "Won by 12.5 in week 3, 110.5 - 98.2.",
    "Finished 7-1 then 2-6.",
    "Won 3 straight on the road.",
    "Took the title on 2023-12-24.",
    "Born to lose, 4-10 three years running.",
    "Paid $1,000,000 in fake money.",
  ])("lets this be: %s", async (line) => {
    expect(await warned(line)).not.toContain("line 6");
  });

  test("the warning reaches the pundit before the LLM is called", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## Running jokes\n- Bo: 555-123-4567\n");
    const llm = scriptedLlm("## {intro}\nA quiet week.");
    ws.deps.llm = llm;
    ws.deps.env.anthropicApiKey = "sk-ant-test";
    const seen: { warning: string; calls: number }[] = [];
    const result = await draft(ws.dir, ws.deps, {
      onWarnings: (warnings) => {
        for (const warning of warnings) {
          seen.push({ warning, calls: llm.requests.length });
        }
      },
    });
    expect(llm.requests).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.calls).toBe(0);
    expect(seen[0]?.warning).toMatch(/line 5 \(phone number\)/);
    expect(seen[0]?.warning).toMatch(/LLM provider/);
    expect(seen[0]?.warning).toMatch(/transcripts delete/);
    expect(result.warnings).toEqual(seen.map((s) => s.warning));
  });

  test("a comment, the front matter and a section's own ID aren't checked", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(
      ws.dir,
      "<!-- e.g. 555-123-4567 -->\n## {team=sleeper:123456789012}\n- Fine.\n",
    );
    const { warnings } = await draft(ws.dir, ws.deps);
    expect(warnings).toEqual([]);
  });

  test("check, refresh and publish warn on their load of the lore too", async () => {
    const { dir, deps } = await draftedWithLore(
      "## Running jokes\n- Bo: 555-123-4567\n",
    );
    const expected = expect.stringMatching(/line 5 \(phone number\)/);
    expect((await check(dir, deps)).warnings).toContainEqual(expected);
    expect((await refresh(dir, deps)).warnings).toContainEqual(expected);
    const seen: string[] = [];
    const published = await publish(dir, deps, {
      yes: true,
      onWarnings: (warnings) => seen.push(...warnings),
    });
    expect(seen).toContainEqual(expected);
    expect(published.warnings).toContainEqual(expected);
  });
});

describe("the lore size warning", () => {
  /** Lore of about `tokens` tokens at 3 characters a token. */
  const loreOf = (tokens: number) =>
    `## Running jokes\n- ${"x".repeat(tokens * 3)}\n`;
  const priced = async (lore: string, input: number, output: number) => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, lore);
    await mkdir(ws.deps.configDir, { recursive: true });
    await writeFile(
      join(ws.deps.configDir, "config.yaml"),
      `format: 1\nmodel: claude-sonnet-5-5\nspend_cap_usd: 7\nprices:\n  claude-sonnet-5-5:\n    input_per_mtok: ${input}\n    output_per_mtok: ${output}\n`,
    );
    ws.deps.llm = scriptedLlm("## {intro}\nA quiet week.");
    ws.deps.env.anthropicApiKey = "sk-ant-test";
    return (await draft(ws.dir, ws.deps)).warnings.join("\n");
  };

  test("past about 2,000 tokens it gives the draft's estimated cost and lore's share against the cap", async () => {
    // Output alone: 16,000 tokens at $10 a million is $0.16 a call, 3 calls at most.
    const output = await priced(loreOf(2100), 0, 10);
    expect(output).toMatch(/lore\.md sends about 2,1\d\d tokens/);
    expect(output).toContain("up to $0.48");
    expect(output).toContain("$7.00 spend cap");
    // Input alone: 2,1xx tokens at $100 a million is $0.21 a call, 3 calls at most.
    const input = await priced(loreOf(2100), 100, 0);
    expect(input).toMatch(/\$0\.6\d of it for lore/);
  });

  test("under about 2,000 tokens it says nothing", async () => {
    expect(await priced(loreOf(1900), 3, 15)).not.toContain("tokens");
  });

  test("a model with no price gets the size and no cost", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, loreOf(2100));
    await mkdir(ws.deps.configDir, { recursive: true });
    await writeFile(
      join(ws.deps.configDir, "config.yaml"),
      "format: 1\nmodel: claude-mystery-1\n",
    );
    ws.deps.llm = scriptedLlm("unused");
    ws.deps.env.anthropicApiKey = "sk-ant-test";
    const { warnings } = await draft(ws.dir, ws.deps);
    const size = warnings.find((w) => w.includes("tokens"));
    expect(size).toMatch(/lore\.md sends about 2,1\d\d tokens/);
    expect(size).not.toContain("$");
  });

  test("with no key it says nothing, since nothing is sent", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, loreOf(2100));
    const { warnings } = await draft(ws.dir, ws.deps);
    expect(warnings).toEqual([]);
  });

  test("a departed manager's lore doesn't count", async () => {
    const lore = `## {manager=gone}\n- ${"x".repeat(9000)}\n`;
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, lore);
    await linkHandle(ws.dir, "gone", "sleeper:no-such-account");
    ws.deps.llm = scriptedLlm("## {intro}\nA quiet week.");
    ws.deps.env.anthropicApiKey = "sk-ant-test";
    const { warnings } = await draft(ws.dir, ws.deps);
    expect(warnings).toEqual([]);
  });
});

describe("the style note and lore's names", () => {
  test("a style note using a manager's handle or nickname warns, as a display name does", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## {manager=bo}\nnicknames: Bobcat\n");
    const dir = join(ws.dir, "pundits", "rikhin");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "persona.md"),
      "---\nformat: 1\npreset: broadcast\n---\nGo easy on Bobcat.\n",
    );
    const { warnings } = await draft(ws.dir, ws.deps);
    expect(warnings).toContainEqual(expect.stringContaining("names Bobcat"));
  });
});

describe("the personal-data warning, on what a review tried", () => {
  const warned = async (line: string) => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, `## Running jokes\n- ${line}\n`);
    return (await draft(ws.dir, ws.deps)).warnings.join("\n");
  };

  test.each([
    ["date of birth", "Born Jan 5th, 1990."],
    ["date of birth", "birthday: March 14th"],
    ["date of birth", "born in March 1985"],
    ["date of birth", "b. 3/14/85"],
    ["date of birth", "March 14, 1985 is Bo's birthday."],
    ["street address", "Lives at 221B Baker Street."],
    ["street address", "Party at 12 Oak Way."],
    ["street address", "Lives at 12 elm street."],
    ["long digit run", "Card 4111-1111-1111-1111."],
    ["phone number", "Ring 07700 900123."],
  ])("names a %s: %s", async (kind, line) => {
    expect(await warned(line)).toContain(`line 5 (${kind})`);
  });

  test.each([
    "Lost 4 straight road games.",
    "A 12 play drive won it.",
    "Got 7 Amon-Ra St. Brown targets.",
    "2021 2022 2023 champs.",
    "Week 3 scores: 120 88 104.",
    "Scored 120-110-105.",
    "Traded on 10-14-2024.",
    "Born for the market 12 years ago.",
  ])("lets this be: %s", async (line) => {
    expect(await warned(line)).not.toContain("line 5");
  });
});

describe("what the LLM may cite and is told", () => {
  test("the LLM citing a section it was never sent fails the gate, though a pundit may cite it", async () => {
    const { llm, result } = await draftedByLlm(
      "## {manager=gone}\n- Moved to Lisbon.\n",
      ["gone", "sleeper:no-such-account"],
      "## {intro}\nThey [left for Perth]{lore=manager:gone}.",
    );
    expect(llm.requests.length).toBeGreaterThan(1);
    expect(result.warnings).toContainEqual(
      expect.stringMatching(
        /cited lore or stakes it wasn't sent.*left for Perth/,
      ),
    );
  });

  test("the rule about evidence leaves room for a personal fact from lore", async () => {
    const { llm, prompt } = await draftedByLlm("## Running jokes\n- A joke.\n");
    expect(llm.requests[0]?.system).toContain(
      "never state a fact that isn't in the evidence or, for a personal fact, in the lore",
    );
    expect(prompt).not.toContain("isn't evidence");
  });

  test("a title or a rule above the first heading isn't lost lore, and a rule is no entry", async () => {
    const { result, prompt } = await draftedByLlm(
      "# Our league\n---\n\n## Running jokes\n- A joke.\n---\n",
    );
    expect(result.warnings).toEqual([]);
    expect(prompt).not.toContain("- ---");
  });

  test("the style note's warning holds for a departed manager's handle", async () => {
    const ws = await fearTheTurtle(8);
    await writeLore(ws.dir, "## {manager=gone}\n- Moved away.\n");
    await linkHandle(ws.dir, "gone", "sleeper:no-such-account");
    const dir = join(ws.dir, "pundits", "rikhin");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "persona.md"),
      "---\nformat: 1\npreset: broadcast\n---\nMiss gone badly.\n",
    );
    const { warnings } = await draft(ws.dir, ws.deps);
    expect(warnings).toContainEqual(
      "persona.md's style note names gone, a manager in the league or its lore. It's sent to the LLM provider with every draft.",
    );
  });
});

test("an uncited stat that check auto-tags draws no warning about lore", async () => {
  const { result, llm } = await draftedByLlm(
    "## Running jokes\n- A joke.\n",
    undefined,
    "## {team=sleeper:1}\nThey are 4-4, which says a lot.",
  );
  expect(llm.requests.length).toBeGreaterThan(1);
  expect(result.warnings.filter((w) => w.includes("cited lore"))).toEqual([]);
});
