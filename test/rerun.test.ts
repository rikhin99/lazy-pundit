import { chmod, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { configPath } from "../src/config.ts";
import {
  COMMON_HOUSE_RULES,
  checkLeague,
  type Deps,
  draft,
  type HandEdit,
  type LeagueCheck,
  linkedHandles,
  loadCredentials,
  loadPunditSettings,
  proposedHandles,
  proposedNicknames,
  publish,
  readConfig,
  refuseUneditableWorkspace,
  rerunLeague,
  rerunNicknames,
  rerunPreselections,
  rerunStep,
  rerunStop,
  SetupRefusal,
  type StepRerun,
  setUpWorkspace,
  setupChecklist,
  spendCapNote,
  type TeamNicknames,
  WorkspaceFileError,
} from "../src/index.ts";
import { leagueFilePath, loadLeagueFile } from "../src/league-file.ts";
import { loadLore } from "../src/lore.ts";
import { personaPath } from "../src/persona.ts";
import { punditSettingsPath } from "../src/pundit-settings.ts";
import { UNRECORDED } from "../src/stakes.ts";
import { readWorkspace } from "../src/workspace.ts";
import {
  atWeek,
  FEAR_THE_TURTLE_ID,
  frontMatter,
  operator,
  twoTeamLore,
  withFrontMatter,
} from "./support/workspace.ts";

async function setUp(
  extra: Partial<Parameters<typeof setUpWorkspace>[1]> = {},
) {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const { dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league,
    ...extra,
  });
  return { deps, dir, league, ws: await readWorkspace(dir) };
}

/** A confirm that records each hand edit it's shown and answers `yes`. */
function answering(yes: boolean) {
  const shown: HandEdit[] = [];
  return {
    shown,
    confirm: async (edit: HandEdit) => {
      shown.push(edit);
      return yes;
    },
  };
}

async function rerun(
  deps: Deps,
  dir: string,
  step: StepRerun,
  yes = true,
): Promise<{ shown: HandEdit[]; written: boolean; warnings: string[] }> {
  const { shown, confirm } = answering(yes);
  const result = await rerunStep(deps, dir, step, confirm);
  return { shown, ...result };
}

function statusOf(items: { step: string; status: string }[], step: string) {
  return items.find((i) => i.step === step)?.status;
}

test("setup lore over added entries asks nothing, and a change shows only its own lines and overwrites on confirm", async () => {
  const { deps, dir, league, ws } = await setUp();
  const lorePath = join(dir, "lore.md");
  const first = {
    type: "friends" as const,
    nicknames: proposedNicknames(league, []),
  };
  await rerun(deps, dir, { step: "lore", league, lore: first });
  const edited = `${await readFile(lorePath, "utf8")}\n## Running jokes\n\n- The trade that never was.\n`;
  await writeFile(lorePath, edited);

  const same = await rerun(deps, dir, { step: "lore", league, lore: first });

  expect(same).toMatchObject({ shown: [], written: false });
  const again = { type: "family" as const, nicknames: first.nicknames };
  const declined = await rerun(
    deps,
    dir,
    { step: "lore", league, lore: again },
    false,
  );

  expect(declined.written).toBe(false);
  expect(declined.shown[0]?.file).toBe(lorePath);
  expect(
    declined.shown[0]?.diff.split("\n").filter((l) => /^[-+]/.test(l)),
  ).toEqual(["+type: family", "-type: friends"]);
  expect(await readFile(lorePath, "utf8")).toBe(edited);

  const confirmed = await rerun(deps, dir, {
    step: "lore",
    league,
    lore: again,
  });

  expect(confirmed.written).toBe(true);
  const lore = await loadLore(ws);
  expect(lore.type).toBe("family");
  expect(lore.sections.at(-1)).toMatchObject({
    name: "running-jokes",
    entries: ["The trade that never was."],
  });
});

test("setup lore over a lore.md that doesn't load offers the step's own text", async () => {
  const { deps, dir, league } = await setUp();
  const lorePath = join(dir, "lore.md");
  const lore = {
    type: "friends" as const,
    nicknames: proposedNicknames(league, []),
  };
  await writeFile(lorePath, "---\nlore: 1\n---\n\n## Jokes\n\n## Jokes\n");

  const { shown, written } = await rerun(deps, dir, {
    step: "lore",
    league,
    lore,
  });

  expect(shown[0]?.diff).toMatch(/^-## Jokes$/m);
  expect(written).toBe(true);
  expect(await readFile(lorePath, "utf8")).not.toMatch(/Jokes/);
});

test("setup lore keeps each entry under its section and every other section after the step's, a stale handle's too", async () => {
  const { deps, dir, league, nicknames, lorePath, top, writeBody } =
    await twoTeamLore();
  await writeBody(`## League
type: friends
- Founded in 2015.

## {manager=gone-guy}
nicknames: Old Guy
- Left in 2023.

## {manager=gridiron-gus}
nicknames: Gus Bus, gridiron_gus
- Won it all in 2021.

## Running jokes

- The trade that never was.
<!-- more to come -->

## {manager=waiver-wendy}
nicknames: Wendy's Wire, waiver_wendy
`);
  const renamed = nicknames.map((t, i) =>
    i === 0 ? { ...t, nicknames: ["The Bus", "gridiron_gus"] } : t,
  );

  const { written } = await rerun(deps, dir, {
    step: "lore",
    league,
    lore: { type: "friends", nicknames: renamed },
  });

  expect(written).toBe(true);
  expect(await readFile(lorePath, "utf8")).toBe(`${top}## League
type: friends
- Founded in 2015.

## {manager=gridiron-gus}
nicknames: The Bus, gridiron_gus
- Won it all in 2021.

## {manager=waiver-wendy}
nicknames: Wendy's Wire, waiver_wendy

## {manager=gone-guy}
nicknames: Old Guy
- Left in 2023.

## Running jokes

- The trade that never was.
<!-- more to come -->
`);
});

test("setup lore keeps entries under a heading written another way that names the same section", async () => {
  const { deps, dir, league, nicknames, lorePath, top, writeBody } =
    await twoTeamLore();
  await writeBody(`## league
type: work
- Founded in 2015.
`);

  await rerun(deps, dir, {
    step: "lore",
    league,
    lore: { type: "friends", nicknames },
  });

  expect(await readFile(lorePath, "utf8")).toBe(`${top}## League
type: friends
- Founded in 2015.

## {manager=gridiron-gus}
nicknames: Gus Bus, gridiron_gus

## {manager=waiver-wendy}
nicknames: Wendy's Wire, waiver_wendy
`);
});

test("setup lore keeps a section's blank lines and comments as written, so the same answers ask nothing", async () => {
  const { deps, dir, league, nicknames, lorePath, writeBody } =
    await twoTeamLore();
  await writeBody(`## League
type: friends
- Founded in 2015. <!-- a note
  that runs on -->

- Moved online in 2020.

## {manager=gridiron-gus}
nicknames: Gus Bus, gridiron_gus

## {manager=waiver-wendy}
nicknames: Wendy's Wire, waiver_wendy
`);
  const before = await readFile(lorePath, "utf8");

  const same = await rerun(deps, dir, {
    step: "lore",
    league,
    lore: { type: "friends", nicknames },
  });

  expect(same).toMatchObject({ shown: [], written: false });
  expect(await readFile(lorePath, "utf8")).toBe(before);
});

test("setup lore over a lore.md with CRLF line endings keeps them, so the same answers ask nothing", async () => {
  const { deps, dir, league, nicknames, lorePath } = await twoTeamLore();
  const crlf = `${(await readFile(lorePath, "utf8")).replaceAll("\n", "\r\n")}\r\n## Running jokes\r\n- The trade that never was.\r\n`;
  await writeFile(lorePath, crlf);

  const same = await rerun(deps, dir, {
    step: "lore",
    league,
    lore: { type: "friends", nicknames },
  });

  expect(same).toMatchObject({ shown: [], written: false });
});

test("setup lore swaps the step's comment for a team's new nicknames, and keeps the entries under it", async () => {
  const { deps, dir, league, nicknames, lorePath, top } = await twoTeamLore();
  const none = nicknames.map((t, i) => (i === 0 ? { ...t, nicknames: [] } : t));
  await rerun(deps, dir, {
    step: "lore",
    league,
    lore: { type: "friends", nicknames: none },
  });
  const written = await readFile(lorePath, "utf8");
  await writeFile(
    lorePath,
    written.replace(
      "\n\n## {manager=waiver-wendy}",
      "\n- Won it all in 2021.\n\n## {manager=waiver-wendy}",
    ),
  );
  expect(
    await rerun(deps, dir, {
      step: "lore",
      league,
      lore: { type: "friends", nicknames: none },
    }),
  ).toMatchObject({ shown: [], written: false });

  await rerun(deps, dir, {
    step: "lore",
    league,
    lore: { type: "friends", nicknames },
  });

  expect(await readFile(lorePath, "utf8")).toBe(`${top}## League
type: friends

## {manager=gridiron-gus}
nicknames: Gus Bus, gridiron_gus
- Won it all in 2021.

## {manager=waiver-wendy}
nicknames: Wendy's Wire, waiver_wendy
`);
});

test("setup lore refuses entries that wouldn't load once kept, naming the line in lore.md, and writes nothing", async () => {
  const { deps, dir, league, nicknames, lorePath, writeBody } =
    await twoTeamLore();
  // The comment opens on the step's nicknames line, which isn't kept, so the
  // tag on its closing line reads as lore.
  await writeBody(`## {manager=gridiron-gus}
nicknames: Gus Bus, gridiron_gus <!-- a note
{oops} -->

## League
type: friends
`);
  const before = await readFile(lorePath, "utf8");

  const refused = rerun(deps, dir, {
    step: "lore",
    league,
    lore: { type: "work", nicknames },
  });

  await expect(refused).rejects.toThrow(SetupRefusal);
  await expect(refused).rejects.toThrow(
    "These nicknames can't be written over lore.md's entries: lore.md has tags this version doesn't know, so remove each one (a {manager=<handle>} or {team=<platform>:<id>} is a whole heading): line 36: {oops}",
  );
  expect(await readFile(lorePath, "utf8")).toBe(before);
});

test("setup lore refuses a nickname that clashes with a kept section's", async () => {
  const { deps, dir, league, nicknames, lorePath, writeBody } =
    await twoTeamLore();
  await writeBody(`## League
type: friends

## {team=sleeper:3}
nicknames: The Mob
`);
  const before = await readFile(lorePath, "utf8");
  const clashing = nicknames.map((t, i) =>
    i === 0 ? { ...t, nicknames: ["The Mob"] } : t,
  );

  const refused = rerun(deps, dir, {
    step: "lore",
    league,
    lore: { type: "friends", nicknames: clashing },
  });

  await expect(refused).rejects.toThrow(
    `These nicknames can't be written over lore.md's entries: the nickname "The Mob" points at both manager:gridiron-gus and team:sleeper:3; keep it on one`,
  );
  expect(await readFile(lorePath, "utf8")).toBe(before);
});

test("a re-run over a placeholder, a missing file or the same text asks nothing, and sets the step in workspace.md", async () => {
  const { deps, dir, league } = await setUp();
  const lore = {
    type: "work" as const,
    nicknames: proposedNicknames(league, []),
  };

  const overPlaceholder = await rerun(deps, dir, {
    step: "lore",
    league,
    lore,
  });
  const same = await rerun(deps, dir, { step: "lore", league, lore });

  expect(overPlaceholder).toMatchObject({ shown: [], written: true });
  expect(same).toMatchObject({ shown: [], written: false });
  expect(statusOf(await setupChecklist(deps, dir), "lore")).toBe("done");
});

test("a status that can't be written takes back the step's file", async () => {
  const { deps, dir, league } = await setUp();
  const lore = {
    type: "work" as const,
    nicknames: proposedNicknames(league, []),
  };
  await rerun(deps, dir, { step: "lore", league, lore });
  const before = await readFile(join(dir, "lore.md"), "utf8");
  await chmod(join(dir, "workspace.md"), 0o444);
  try {
    await expect(rerun(deps, dir, { step: "lore", league })).rejects.toThrow();
  } finally {
    await chmod(join(dir, "workspace.md"), 0o644);
  }
  expect(await readFile(join(dir, "lore.md"), "utf8")).toBe(before);
  await rm(personaPath(await readWorkspace(dir)));
  await chmod(join(dir, "workspace.md"), 0o444);
  try {
    await expect(
      rerun(deps, dir, { step: "persona", persona: "roast" }),
    ).rejects.toThrow();
  } finally {
    await chmod(join(dir, "workspace.md"), 0o644);
  }
  await expect(readFile(personaPath(await readWorkspace(dir)))).rejects.toThrow(
    /ENOENT/,
  );
});

test("a skipped setup stakes leaves the stakes unrecorded and keeps the family league", async () => {
  const { deps, dir, ws } = await setUp({
    stakes: { familyLeague: true, stakes: "none" },
  });

  await rerun(deps, dir, { step: "stakes" });

  const file = await loadLeagueFile(ws);
  expect(file.familyLeague).toBe(true);
  expect(file.stakes).toEqual(UNRECORDED);
  expect(statusOf(await setupChecklist(deps, dir), "stakes")).toBe("skipped");
});

test("a declined overwrite leaves the step's status as it was", async () => {
  const { deps, dir, league } = await setUp();
  await writeFile(
    join(dir, "lore.md"),
    "---\nlore: 1\n---\n\n## Hand written\n\n- Kept.\n",
  );
  const lore = {
    type: "work" as const,
    nicknames: proposedNicknames(league, []),
  };

  await rerun(deps, dir, { step: "lore", league, lore }, false);

  expect(statusOf(await setupChecklist(deps, dir), "lore")).toBe("skipped");
});

test("a skipped re-run writes the step's placeholder and records it skipped", async () => {
  const { deps, dir, league, ws } = await setUp({ persona: "roast" });

  const { shown } = await rerun(deps, dir, { step: "persona" });

  expect(shown).toHaveLength(1);
  expect(await readFile(personaPath(ws), "utf8")).toMatch(/preset: broadcast/);
  expect(statusOf(await setupChecklist(deps, dir), "persona")).toBe("skipped");
  await rerun(deps, dir, { step: "lore", league });
  expect((await loadLore(ws)).sections).toEqual([]);
});

test("setup persona and setup method write their files and status", async () => {
  const { deps, dir, ws } = await setUp();

  await rerun(deps, dir, { step: "persona", persona: "banter" });
  await rerun(deps, dir, { step: "method", method: "standings" });

  expect((await loadPunditSettings(ws)).method).toBe("standings");
  const items = await setupChecklist(deps, dir);
  expect(statusOf(items, "persona")).toBe("done");
  expect(statusOf(items, "method")).toBe("done");
  expect(await readFile(punditSettingsPath(ws), "utf8")).toMatch(
    /^---\nformat: 1\n/,
  );
  expect(await readFile(personaPath(ws), "utf8")).toMatch(/preset: banter/);
});

test("setup stakes keeps league.md's body, and the diff shows the hand edits the answers drop", async () => {
  const rule = COMMON_HOUSE_RULES[0];
  if (!rule) throw new Error("no common house rule");
  const { deps, dir, ws } = await setUp({
    stakes: {
      familyLeague: false,
      stakes: {
        buyIn: 50,
        payouts: ["100%"],
        houseRules: [{ rule, outcome: "$10" }],
      },
    },
  });
  const path = leagueFilePath(ws);
  const text = await readFile(path, "utf8");
  const edited = `${text.replace(`outcome: $10`, `outcome: $10\n    spirit: joke`)}\n## Log\n\n- {week=3}{rule=${rule.id}} Bo paid up.\n`;
  await writeFile(path, edited);
  expect((await loadLeagueFile(ws)).warnings).toEqual([]);

  const { shown } = await rerun(deps, dir, {
    step: "stakes",
    stakes: {
      familyLeague: true,
      stakes: {
        buyIn: 60,
        payouts: ["100%"],
        houseRules: [{ rule, outcome: "$10" }],
      },
    },
  });

  expect(shown[0]?.diff).toMatch(/^- +spirit: joke$/m);
  expect(shown[0]?.diff).toMatch(/^\+buy-in: \$60$/m);
  expect(shown[0]?.diff).not.toMatch(/Bo paid up/);
  const after = await readFile(path, "utf8");
  expect(after).toMatch(/Bo paid up\.\n$/);
  expect((await loadLeagueFile(ws)).familyLeague).toBe(true);
});

test("setup stakes gives the changed-outcome warning for an outcome changed since the last published week, with the diff it confirms", async () => {
  const rule = COMMON_HOUSE_RULES[0];
  if (!rule) throw new Error("no common house rule");
  const paying = (outcome: string) => ({
    familyLeague: false,
    stakes: { buyIn: 50, payouts: ["100%"], houseRules: [{ rule, outcome }] },
  });
  const { deps, dir } = await setUp({ stakes: paying("$10") });
  await draft(dir, deps);
  await publish(dir, deps, { yes: true });
  const warning = `league.md: ${rule.name} (${rule.id}) pays $20, not the $10 it paid at week 8: winnings to date count $20 for every week. To keep $10 for earlier weeks, split the rule with until: and from:.`;
  const step: StepRerun = { step: "stakes", stakes: paying("$20") };

  // Declined, the file keeps $10, so nothing's said once the confirm is done.
  const declined = await rerun(deps, dir, step, false);
  expect(declined.shown.map((s) => s.warnings)).toEqual([[warning]]);
  expect(declined.warnings).toEqual([]);

  const confirmed = await rerun(deps, dir, step);
  expect(confirmed.shown.map((s) => s.warnings)).toEqual([[warning]]);
  expect(confirmed.warnings).toEqual([warning]);

  // league.md already holds these answers, so no confirm is asked.
  const again = await rerun(deps, dir, step);
  expect(again).toMatchObject({ shown: [], written: false });
  expect(again.warnings).toEqual([warning]);
});

test("setup stakes refuses answers whose league.md wouldn't load, writing nothing", async () => {
  const rule = COMMON_HOUSE_RULES[0];
  if (!rule) throw new Error("no common house rule");
  const { deps, dir, ws } = await setUp({
    stakes: {
      familyLeague: false,
      stakes: {
        buyIn: 50,
        payouts: ["100%"],
        houseRules: [{ rule, outcome: "$10" }],
      },
    },
  });
  const path = leagueFilePath(ws);
  const edited = `${await readFile(path, "utf8")}\n## Log\n\n- {week=3}{rule=${rule.id}} Bo paid up.\n`;
  await writeFile(path, edited);

  // Bragging rights only has no rule for the Log entry to name.
  await expect(
    rerun(deps, dir, {
      step: "stakes",
      stakes: { familyLeague: false, stakes: "none" },
    }),
  ).rejects.toThrow(
    /^These stakes can't be written over league\.md's body: .*\{rule=/,
  );
  expect(await readFile(path, "utf8")).toBe(edited);
});

test("setup handles links the new handles, and says which lore sections name a handle with no link now", async () => {
  const { deps, dir, league } = await setUp();
  const handles = proposedHandles(league);
  await rerun(deps, dir, { step: "handles", league, handles });
  const lore = {
    type: "friends" as const,
    nicknames: proposedNicknames(league, handles),
  };
  await rerun(deps, dir, { step: "lore", league, lore });
  const managerSection = lore.nicknames.find((t) =>
    t.section.startsWith("{manager="),
  );
  if (!managerSection) throw new Error("no manager section in the prefill");
  const old = /\{manager=(.+)\}/.exec(managerSection.section)?.[1] ?? "";
  const renamed = handles.map((h) =>
    h.handle === old ? { ...h, handle: "the-renamed" } : h,
  );

  const { shown, warnings } = await rerun(deps, dir, {
    step: "handles",
    league,
    handles: renamed,
  });

  expect(shown[0]?.file).toBe(join(dir, "workspace.md"));
  expect(shown[0]?.diff).toMatch(/the-renamed/);
  const ws = await readWorkspace(dir);
  const account = handles.find((h) => h.handle === old)?.account;
  expect(ws.handles["the-renamed"]).toEqual([account]);
  expect(ws.handles[old]).toBeUndefined();
  expect(ws.pundit).toBe("rikhin");
  expect(ws.setup.handles).toBe("done");
  expect(warnings.join("\n")).toContain(`{manager=${old}}`);
  expect(linkedHandles(ws, league).map((h) => h.handle)).toContain(
    "the-renamed",
  );
  const again = await rerunLeague(deps, dir);
  expect(again.proposed).toHaveLength(handles.length);
  expect(again.proposed.find((h) => h.account === account)?.handle).toBe(
    "the-renamed",
  );
  expect(again.linked.map((h) => h.handle)).toContain("the-renamed");
});

test("a re-run is preselected from the lore's league type and the family league", async () => {
  const { deps, dir, league } = await setUp({
    stakes: { familyLeague: true, stakes: "none" },
  });
  expect(await rerunPreselections(dir)).toEqual({ familyLeague: true });
  const lore = {
    type: "family" as const,
    nicknames: proposedNicknames(league, []),
  };
  await rerun(deps, dir, { step: "lore", league, lore });

  expect(await rerunPreselections(dir)).toEqual({
    type: "family",
    familyLeague: true,
  });
});

test("setup handles skipped links nobody", async () => {
  const fetched = await checkLeague(
    atWeek(await operator(), 8),
    FEAR_THE_TURTLE_ID,
  );
  const { deps, dir, league } = await setUp({
    handles: proposedHandles(fetched),
  });
  await rerun(deps, dir, { step: "handles", league });
  const ws = await readWorkspace(dir);
  expect(ws.handles).toEqual({});
  expect(ws.setup.handles).toBe("skipped");
});

test("setup key saves the key with the operator's credentials", async () => {
  const { deps, dir } = await setUp();

  await rerun(deps, dir, { step: "key", key: "sk-ant-new" });

  expect((await loadCredentials(deps)).anthropicApiKey?.value).toBe(
    "sk-ant-new",
  );
  expect(statusOf(await setupChecklist(deps, dir), "key")).toBe("done");
});

test("setup cap changes spend_cap_usd in config.yaml, keeping its comments", async () => {
  const { deps, dir } = await setUp();
  const path = configPath(deps);
  await writeFile(path, `# kept\n${await readFile(path, "utf8")}`);

  await rerun(deps, dir, { step: "cap", spendCap: 12 });

  expect((await readConfig(deps))?.spend_cap_usd).toBe(12);
  expect(await readFile(path, "utf8")).toMatch(/^# kept\n/);
  expect(statusOf(await setupChecklist(deps, dir), "cap")).toBe("done");
});

test("setup cap refuses a cap that isn't a dollar amount", async () => {
  const { deps, dir } = await setUp();
  await expect(rerun(deps, dir, { step: "cap", spendCap: -1 })).rejects.toThrow(
    SetupRefusal,
  );
});

test("the cap step says this month's spend, the cap and one draft's ceiling", async () => {
  const { deps } = await setUp();

  // The whole 16,000-token reply at $10/M, before any prompt: $0.16.
  expect(await spendCapNote(deps)).toMatch(
    /^This month's spend is \$0\.00 of a \$5\.00 spend cap\. One LLM call on claude-sonnet-5-5 can cost more than \$0\.16, and a draft makes up to 3\.$/,
  );
});

test("setup stops at steps it can't re-run, and at a name that's no step", () => {
  expect(rerunStop("lore")).toBeUndefined();
  expect(rerunStop("cap")).toBeUndefined();
  expect(rerunStop("espn")).toBeUndefined();
  expect(rerunStop("pundit name")).toMatch(/init/);
  expect(rerunStop("league")).toMatch(
    /espn, handles, lore, stakes, method, key, cap, persona/,
  );
});

describe("a workspace.md whose front matter setup can't edit", () => {
  const MESSAGE =
    "workspace.md: put each front-matter key at the start of its line, with no indent and no braces around the keys";

  const SHAPES = [
    [
      "every key indented",
      (text: string) =>
        withFrontMatter(text, (lines) => lines.map((line) => `  ${line}`)),
    ],
    [
      "a flow map",
      (text: string) =>
        withFrontMatter(text, () => [JSON.stringify(frontMatter(text))]),
    ],
  ] as const;

  /** Every file under `dir`, by its path, with its text. */
  async function filesIn(dir: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    for (const entry of await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      files[path] = await readFile(path, "utf8");
    }
    return files;
  }

  async function reshaped(shape: (text: string) => string) {
    const setUpOnce = await setUp();
    const path = join(setUpOnce.dir, "workspace.md");
    await writeFile(path, shape(await readFile(path, "utf8")));
    return setUpOnce;
  }

  describe.each(SHAPES)("as %s", (_, shape) => {
    const STEPS: [string, (league: LeagueCheck) => StepRerun][] = [
      [
        "handles",
        (league) => ({
          step: "handles",
          league,
          handles: proposedHandles(league),
        }),
      ],
      [
        "lore",
        (league) => ({
          step: "lore",
          league,
          lore: { type: "work", nicknames: proposedNicknames(league, []) },
        }),
      ],
      [
        "stakes",
        () => ({
          step: "stakes",
          stakes: { familyLeague: false, stakes: "none" },
        }),
      ],
      ["method", () => ({ step: "method", method: "standings" })],
      ["persona", () => ({ step: "persona", persona: "roast" })],
    ];

    test.each(STEPS)(
      "setup %s refuses it by name, writing no file",
      async (_step, answers) => {
        const { deps, dir, league } = await reshaped(shape);
        const before = await filesIn(dir);

        await expect(rerun(deps, dir, answers(league))).rejects.toThrow(
          new WorkspaceFileError(MESSAGE),
        );

        expect(await filesIn(dir)).toEqual(before);
      },
    );

    test("setup key and setup cap still work", async () => {
      const { deps, dir } = await reshaped(shape);

      await rerun(deps, dir, { step: "key", key: "sk-ant-new" });
      await rerun(deps, dir, { step: "cap", spendCap: 12 });

      expect((await loadCredentials(deps)).anthropicApiKey?.value).toBe(
        "sk-ant-new",
      );
      expect((await readConfig(deps))?.spend_cap_usd).toBe(12);
    });
  });

  test("the refusal holds for a workspace.md with no handles key, where linking one used to say it isn't valid YAML", async () => {
    const { dir } = await reshaped(SHAPES[0][1]);
    const text = await readFile(join(dir, "workspace.md"), "utf8");

    // `handles` only as the setup step's status, a level deeper.
    expect(text).not.toMatch(/^ {2}handles:/m);
    expect(text).toMatch(/^ {2}setup:/m);
    await expect(refuseUneditableWorkspace(dir, "handles")).rejects.toThrow(
      MESSAGE,
    );
    await expect(
      refuseUneditableWorkspace(dir, "key"),
    ).resolves.toBeUndefined();
  });

  test("front matter that isn't valid YAML keeps its own refusal, with the indent fix", async () => {
    const { dir } = await reshaped((text) =>
      withFrontMatter(text, (lines) =>
        lines.map((line) => (line.startsWith("pundit:") ? `  ${line}` : line)),
      ),
    );

    // As the CLI calls it, before reading the workspace for the questions.
    await expect(refuseUneditableWorkspace(dir, "method")).rejects.toThrow(
      /isn't valid YAML; check each key's indent/,
    );
  });
});

describe("setup lore's nicknames start from lore.md", () => {
  // The first three teams as the step shows them, from `fixture:show -- 8 --model`.
  const firstThree = (all: TeamNicknames[]) =>
    all.slice(0, 3).map((t) => `${t.team} ${t.section}: ${t.nicknames}`);

  test("a team's are its section's, as written and in order, and a team with no section gets the league's", async () => {
    const { dir, league, ws, writeBody } = await twoTeamLore();
    await writeBody(`## League
type: friends

## {manager=waiver-wendy}
nicknames: waiver_wendy, Wendy's Wire

## {manager=gridiron-gus}
nicknames: Big Bus, gridiron_gus
- Won it all in 2021.
`);
    const handles = linkedHandles(ws, league);

    const defaults = await rerunNicknames(dir, league, handles);

    expect(firstThree(defaults)).toEqual([
      "sleeper:1 {manager=gridiron-gus}: Big Bus,gridiron_gus",
      "sleeper:2 {manager=waiver-wendy}: waiver_wendy,Wendy's Wire",
      "sleeper:3 {manager=benchwarmer-bo}: Bench Mob,benchwarmer_bo",
    ]);
    expect(defaults).toHaveLength(12);
  });

  test("a section with no nicknames, or an empty nicknames line, has none", async () => {
    const { dir, league, ws, writeBody } = await twoTeamLore();
    await writeBody(`## League
type: friends

## {manager=gridiron-gus}
<!-- Gus Bus, gridiron_gus -->
- Won it all in 2021.

## {manager=waiver-wendy}
nicknames:
`);
    const handles = linkedHandles(ws, league);

    const defaults = await rerunNicknames(dir, league, handles);

    expect(defaults.slice(0, 2).map((t) => t.nicknames)).toEqual([[], []]);
  });

  test("accepted over sections that say none, an empty nicknames line or none at all, they write nothing", async () => {
    const { deps, dir, league, ws, lorePath, writeBody } = await twoTeamLore();
    await writeBody(`## League
type: friends

## {manager=gridiron-gus}
nicknames:
- Won it all in 2021.

## {manager=waiver-wendy}
- Always on the wire.
`);
    const before = await readFile(lorePath, "utf8");
    const handles = linkedHandles(ws, league);
    const nicknames = (await rerunNicknames(dir, league, handles)).slice(0, 2);

    const { shown, written } = await rerun(deps, dir, {
      step: "lore",
      league,
      lore: { type: "friends", nicknames },
    });

    expect(shown).toEqual([]);
    expect(written).toBe(false);
    expect(await readFile(lorePath, "utf8")).toBe(before);
  });

  test("a team with no linked manager reads its {team=<id>} section", async () => {
    const { dir, league, writeBody } = await twoTeamLore();
    await writeBody(`## League
type: friends

## {team=sleeper:3}
nicknames: The Mob
`);

    const defaults = await rerunNicknames(dir, league, []);

    expect(firstThree(defaults)[2]).toBe("sleeper:3 {team=sleeper:3}: The Mob");
  });

  test("with no lore.md, or one that doesn't load, they're the league's", async () => {
    const { dir, league, ws, lorePath, writeBody } = await twoTeamLore();
    const handles = linkedHandles(ws, league);
    const leagues = [
      "sleeper:1 {manager=gridiron-gus}: Gus Bus,gridiron_gus",
      "sleeper:2 {manager=waiver-wendy}: Wendy's Wire,waiver_wendy",
      "sleeper:3 {manager=benchwarmer-bo}: Bench Mob,benchwarmer_bo",
    ];
    await writeBody(
      "## League\ntype: friends {bogus}\n\n## {manager=gridiron-gus}\nnicknames: Big Bus\n",
    );
    expect(firstThree(await rerunNicknames(dir, league, handles))).toEqual(
      leagues,
    );
    await rm(lorePath);
    expect(firstThree(await rerunNicknames(dir, league, handles))).toEqual(
      leagues,
    );
  });
});
