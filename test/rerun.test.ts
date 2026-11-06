import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { configPath, loadCredentials, readConfig } from "../src/config.ts";
import {
  COMMON_HOUSE_RULES,
  checkLeague,
  type Deps,
  type HandEdit,
  linkedHandles,
  proposedHandles,
  proposedNicknames,
  rerunLeague,
  rerunPreselections,
  rerunStep,
  rerunStop,
  SetupRefusal,
  type StepRerun,
  setUpWorkspace,
  setupChecklist,
  spendCapNote,
} from "../src/index.ts";
import { leagueFilePath, loadLeagueFile } from "../src/league-file.ts";
import { loadLore } from "../src/lore.ts";
import { personaPath } from "../src/persona.ts";
import {
  loadPunditSettings,
  punditSettingsPath,
} from "../src/pundit-settings.ts";
import { UNRECORDED } from "../src/stakes.ts";
import { readWorkspace } from "../src/workspace.ts";
import { atWeek, FEAR_THE_TURTLE_ID, operator } from "./support/workspace.ts";

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

test("setup lore after a hand edit shows the diff and only overwrites on confirm", async () => {
  const { deps, dir, league, ws } = await setUp();
  const lorePath = join(dir, "lore.md");
  const first = {
    type: "friends" as const,
    nicknames: proposedNicknames(league, []),
  };
  await rerun(deps, dir, { step: "lore", league, lore: first });
  const edited = `${await readFile(lorePath, "utf8")}\n## Running jokes\n\n- The trade that never was.\n`;
  await writeFile(lorePath, edited);
  const again = { type: "family" as const, nicknames: first.nicknames };

  const declined = await rerun(
    deps,
    dir,
    { step: "lore", league, lore: again },
    false,
  );

  expect(declined.written).toBe(false);
  expect(declined.shown).toHaveLength(1);
  expect(declined.shown[0]?.file).toBe(lorePath);
  expect(declined.shown[0]?.diff).toMatch(/^-## Running jokes$/m);
  expect(declined.shown[0]?.diff).toMatch(/^-type: friends$/m);
  expect(declined.shown[0]?.diff).toMatch(/^\+type: family$/m);
  expect(await readFile(lorePath, "utf8")).toBe(edited);

  const confirmed = await rerun(deps, dir, {
    step: "lore",
    league,
    lore: again,
  });

  expect(confirmed.written).toBe(true);
  expect((await loadLore(ws)).type).toBe("family");
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
  expect(rerunStop("espn")).toMatch(/later release/);
  expect(rerunStop("pundit name")).toMatch(/init/);
  expect(rerunStop("league")).toMatch(
    /handles, lore, stakes, method, key, cap, persona/,
  );
});
