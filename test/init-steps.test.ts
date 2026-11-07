import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";
import { loadCredentials } from "../src/config.ts";
import {
  buyInProblem,
  COMMON_HOUSE_RULES,
  checkKey,
  checkLeague,
  type Deps,
  draft,
  familyLeagueDefault,
  familyLeagueLowers,
  handleProblem,
  KEY_CHECK_WAIT_MS,
  METHOD_CHOICES,
  nicknamesOf,
  nicknamesProblem,
  operatorSteps,
  outcomeProblem,
  payoutsProblem,
  personaDefault,
  proposedHandles,
  proposedNicknames,
  SetupRefusal,
  setUpWorkspace,
  setupChecklist,
  spendCapProblem,
  spendCapWarning,
} from "../src/index.ts";
import {
  familyLeague,
  leagueFilePath,
  loadLeagueFile,
} from "../src/league-file.ts";
import { loadLore, refuseLocal } from "../src/lore.ts";
import { loadPersona, personaPath } from "../src/persona.ts";
import { powerScoreMethodSchema } from "../src/power-score.ts";
import {
  DEFAULT_SETTINGS,
  loadPunditSettings,
  punditSettingsPath,
} from "../src/pundit-settings.ts";
import { readWorkspace } from "../src/workspace.ts";
import { scriptedLlm } from "./support/llm.ts";
import {
  atWeek,
  committed,
  FEAR_THE_TURTLE_ID,
  frontMatter,
  operator,
} from "./support/workspace.ts";

async function setUp(
  extra: Partial<Parameters<typeof setUpWorkspace>[1]> = {},
  given?: Deps,
) {
  const deps = given ?? atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const { dir, slug } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league,
    ...extra,
  });
  return { deps, dir, slug, league, ws: await readWorkspace(dir) };
}

test("the method step offers every method, with the ramped blend first for one key", () => {
  expect(METHOD_CHOICES[0]?.value).toBe("ramped-blend");
  expect(METHOD_CHOICES.map((c) => c.value).sort()).toEqual(
    [...powerScoreMethodSchema.options].sort(),
  );
});

test("a chosen method is written to the pundit settings", async () => {
  const { ws } = await setUp({ method: "standings" });
  expect((await loadPunditSettings(ws)).method).toBe("standings");
});

test("an accepted or skipped method still writes a settings file that reads as the default", async () => {
  for (const extra of [{ method: "ramped-blend" as const }, {}]) {
    const { ws } = await setUp(extra);
    expect(await readFile(punditSettingsPath(ws), "utf8")).toMatch(
      /^---\nformat: 1\n/,
    );
    expect(await loadPunditSettings(ws)).toEqual(DEFAULT_SETTINGS);
  }
});

test("the lore, stakes and persona placeholders load as nothing written yet", async () => {
  const { ws } = await setUp();
  const lore = await loadLore(ws);
  expect(lore).toEqual({ sections: [], localLines: [], warnings: [] });
  expect(() => refuseLocal(lore)).not.toThrow();
  expect(await familyLeague(ws)).toBe(false);
  expect(await readFile(personaPath(ws), "utf8")).toMatch(/preset: broadcast/);
});

test("a listing that fails leaves a chosen empty folder empty", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const dir = join(dirname(deps.workspacesDir), "chosen");
  await mkdir(dir);
  await mkdir(deps.configDir, { recursive: true });
  await writeFile(join(deps.configDir, "config.yaml"), "format: 1\n");
  await chmod(deps.configDir, 0o500);
  try {
    await expect(
      setUpWorkspace(deps, { punditName: "Rikhin", league, dir }),
    ).rejects.toThrow();
  } finally {
    await chmod(deps.configDir, 0o700);
  }
  expect(await readdir(dir)).toEqual([]);
});

test("the handles step proposes a slug for each manager, from their display name and with their account", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);

  const handles = proposedHandles(league);

  expect(handles).toHaveLength(12);
  expect(handles[2]).toEqual({
    handle: "benchwarmer-bo",
    displayName: "benchwarmer_bo",
    account: "sleeper:800000000000000003",
  });
});

test("managers sharing a slug get their own handles, a co-manager of two teams gets one, and a name with no letters still gets one", () => {
  const managers = [
    { account: "sleeper:1", displayName: "Big Bo" },
    { account: "sleeper:2", displayName: "big_bo" },
    { account: "sleeper:1", displayName: "Big Bo" },
    { account: "sleeper:3", displayName: "拳王" },
  ];
  const handles = proposedHandles({
    platform: "sleeper",
    leagueId: "1",
    name: "L",
    season: "2025",
    teams: 3,
    warnings: [],
    managers,
    teamList: [],
  });
  expect(handles.map((h) => [h.handle, h.account])).toEqual([
    ["big-bo", "sleeper:1"],
    ["big-bo-2", "sleeper:2"],
    ["manager", "sleeper:3"],
  ]);
});

test("the lore step prefills each team's nicknames from its name and manager, under the manager's handle once the handles step linked one", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);

  const unlinked = proposedNicknames(league);
  expect(unlinked).toHaveLength(12);
  expect(unlinked[2]).toEqual({
    team: "sleeper:3",
    teamName: "Bench Mob",
    section: "{team=sleeper:3}",
    nicknames: ["Bench Mob", "benchwarmer_bo"],
  });

  const linked = proposedNicknames(league, proposedHandles(league));
  expect(linked[2]?.section).toBe("{manager=benchwarmer-bo}");
});

test("a prefilled nickname that would read as another team's is left out", () => {
  const league = {
    platform: "sleeper" as const,
    leagueId: "1",
    name: "L",
    season: "2025",
    teams: 2,
    warnings: [],
    managers: [
      { account: "sleeper:1", displayName: "bo" },
      { account: "sleeper:2", displayName: "Mob" },
    ],
    teamList: [
      {
        id: "sleeper:1" as const,
        name: "Bench Mob",
        managers: [{ account: "sleeper:1", displayName: "bo" }],
      },
      {
        id: "sleeper:2" as const,
        name: "Mob Squad",
        managers: [{ account: "sleeper:2", displayName: "Mob" }],
      },
    ],
  };
  expect(proposedNicknames(league).map((t) => t.nicknames)).toEqual([
    ["bo"],
    ["Mob Squad"],
  ]);
});

test("answered lore is written with its type and nicknames, loads with no warnings and reaches a draft", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const handles = proposedHandles(league);
  const nicknames = proposedNicknames(league, handles).map((t) =>
    t.team === "sleeper:3"
      ? { ...t, nicknames: [...t.nicknames, "Mobsters"] }
      : t,
  );
  const llm = scriptedLlm("not a usable reply");

  const { ws, dir } = await setUp(
    { handles, lore: { type: "family", nicknames }, key: "k" },
    { ...deps, llm },
  );

  const lore = await loadLore(ws);
  expect(lore.type).toBe("family");
  expect(lore.warnings).toEqual([]);
  expect(() => refuseLocal(lore)).not.toThrow();
  expect(
    lore.sections.find((s) => s.name === "manager:benchwarmer-bo"),
  ).toMatchObject({
    nicknames: ["Bench Mob", "benchwarmer_bo", "Mobsters"],
  });
  expect(await readFile(join(dir, "lore.md"), "utf8")).toMatch(
    /sent to the LLM provider[\s\S]*transcripts delete/,
  );
  expect((await readWorkspace(dir)).setup.lore).toBe("done");

  const result = await draft(dir, { ...deps, llm });
  expect(llm.requests[0]?.prompt).toContain("Mobsters");
  expect(result.warnings).toEqual([]);
});

test("a team left with no nicknames keeps its section, with a comment saying whose it is", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const nicknames = proposedNicknames(league).map((t) =>
    t.team === "sleeper:1" ? { ...t, nicknames: [] } : t,
  );
  const { ws, dir } = await setUp({ lore: { type: "work", nicknames } }, deps);
  const text = await readFile(join(dir, "lore.md"), "utf8");
  expect(text).toContain(
    "## {team=sleeper:1}\n<!-- Gus Bus, gridiron_gus -->\n",
  );
  expect(text).toContain(
    "## {team=sleeper:2}\nnicknames: Wendy's Wire, waiver_wendy\n",
  );
  const lore = await loadLore(ws);
  expect(lore.warnings).toEqual([]);
  expect(
    lore.sections.find((s) => s.name === "team:sleeper:1")?.nicknames,
  ).toEqual([]);
});

test("typed nicknames are split on commas, trimmed, with blanks dropped", () => {
  expect(nicknamesOf(" Mob, Bo ,, The Boss ")).toEqual([
    "Mob",
    "Bo",
    "The Boss",
  ]);
  expect(nicknamesOf("  ")).toEqual([]);
});

test("a typed nickname that clashes with another team's is a problem, and setUpWorkspace refuses it before writing", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const nicknames = proposedNicknames(league).map((t) =>
    t.team === "sleeper:1" ? { ...t, nicknames: ["Bench Mob"] } : t,
  );
  expect(nicknamesProblem(league, [], nicknames)).toMatch(/Bench Mob/);
  expect(
    nicknamesProblem(league, [], proposedNicknames(league)),
  ).toBeUndefined();
  await expect(
    setUpWorkspace(deps, {
      punditName: "Rikhin",
      league,
      lore: { type: "friends", nicknames },
    }),
  ).rejects.toThrow(SetupRefusal);
  expect(await readdir(deps.workspacesDir).catch(() => [])).toEqual([]);
});

test("a No at the stakes question writes stakes: none, and a skipped stakes step writes no stakes record", async () => {
  const { ws } = await setUp({
    stakes: { stakes: "none", familyLeague: false },
  });
  const answered = frontMatter(await readFile(leagueFilePath(ws), "utf8"));
  expect(answered).toMatchObject({ league: 1, season: "2025", stakes: "none" });
  expect((await readWorkspace(ws.dir)).setup.stakes).toBe("done");

  const skipped = await setUp();
  const unrecorded = frontMatter(
    await readFile(leagueFilePath(skipped.ws), "utf8"),
  );
  expect(Object.keys(unrecorded).sort()).toEqual([
    "family-league",
    "league",
    "season",
  ]);
  expect(skipped.ws.setup.stakes).toBe("skipped");
  expect((await loadLeagueFile(skipped.ws)).stakes).toEqual({
    kind: "unrecorded",
  });
});

test("money at stake writes the buy-in, payouts by place and each picked house rule with its outcome", async () => {
  const [high, , , last] = COMMON_HOUSE_RULES;
  if (!high || !last) throw new Error("four common house rules");
  const { ws } = await setUp({
    stakes: {
      familyLeague: false,
      stakes: {
        buyIn: 50,
        payouts: ["70%", "$100"],
        houseRules: [
          { rule: high, outcome: "$10" },
          { rule: last, outcome: "Wears the jersey" },
        ],
      },
    },
  });
  const data = frontMatter(await readFile(leagueFilePath(ws), "utf8"));
  expect(data).toMatchObject({
    "buy-in": "$50",
    payouts: ["70%", "$100"],
    "house-rules": [
      {
        id: "high-score",
        name: "Weekly high score",
        trigger: "high-score",
        per: "week",
        outcome: "$10",
      },
      {
        id: "last-place",
        name: "Last place",
        trigger: "last-place",
        per: "season",
        outcome: "Wears the jersey",
      },
    ],
  });
  expect(data.stakes).toBeUndefined();
  expect(await familyLeague(ws)).toBe(false);
  // What init writes loads under league.md's full schema.
  expect((await loadLeagueFile(ws)).stakes).toMatchObject({
    kind: "recorded",
    buyIn: 50,
    payouts: [{ share: 70 }, { dollars: 100 }],
    lastPlace: "standings",
    houseRules: [
      {
        id: "high-score",
        trigger: { kind: "high-score", per: "week" },
        outcome: { kind: "dollars", amount: 10 },
      },
      {
        id: "last-place",
        trigger: { kind: "last-place", per: "season" },
        outcome: { kind: "text", text: "Wears the jersey" },
      },
    ],
  });
});

test("the family league is preselected on for a family league type, and an answer of on is written", async () => {
  expect(familyLeagueDefault("family")).toBe(true);
  for (const type of ["friends", "work", "other", undefined] as const) {
    expect(familyLeagueDefault(type)).toBe(false);
  }
  const { ws } = await setUp({
    stakes: { stakes: "none", familyLeague: true },
  });
  expect(await familyLeague(ws)).toBe(true);
});

test("a buy-in is dollars, a payout is dollars or a share of the pot, and an outcome is written down", () => {
  expect(buyInProblem("50")).toBeUndefined();
  for (const bad of ["", "-5", "$50", "fifty"]) {
    expect(buyInProblem(bad)).toMatch(/dollars/);
  }
  expect(payoutsProblem("100%")).toBeUndefined();
  expect(payoutsProblem("60%, $100, 20%")).toBeUndefined();
  expect(payoutsProblem("60%, abc")).toMatch(/abc/);
  expect(payoutsProblem("80%, 30%")).toMatch(/100%/);
  expect(payoutsProblem("")).toMatch(/place/);
  expect(outcomeProblem("$10")).toBeUndefined();
  expect(outcomeProblem("5 FAAB")).toBeUndefined();
  expect(outcomeProblem("Buys the beer")).toBeUndefined();
  expect(outcomeProblem(" ")).toMatch(/outcome/);
  expect(outcomeProblem("a {local} fine")).toMatch(/brace/);
});

test("the persona step preselects Family for a family league, Banter for friends and Broadcast otherwise", () => {
  expect(personaDefault("family")).toBe("family");
  expect(personaDefault("friends")).toBe("banter");
  for (const type of ["work", "other", undefined] as const) {
    expect(personaDefault(type)).toBe("broadcast");
  }
});

test("the persona step says what a family league lowers in a preset, and nothing for one it leaves be", () => {
  expect(familyLeagueLowers("roast", true)).toMatch(/Roast.*swearing.*teasing/);
  expect(familyLeagueLowers("banter", true)).toMatch(/Banter.*swearing/);
  expect(familyLeagueLowers("banter", true)).not.toMatch(/teasing/);
  expect(familyLeagueLowers("family", true)).toBeUndefined();
  expect(familyLeagueLowers("broadcast", true)).toBeUndefined();
  expect(familyLeagueLowers("roast", false)).toBeUndefined();
});

test("a family league type, then accepting the preselections, gives a family league with the Family persona", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const type = "family";
  const { ws } = await setUp(
    {
      lore: { type, nicknames: proposedNicknames(league) },
      stakes: { stakes: "none", familyLeague: familyLeagueDefault(type) },
      persona: personaDefault(type),
    },
    deps,
  );
  const lore = await loadLore(ws);
  const loaded = await loadPersona(ws, await committed(8), lore);
  expect(await familyLeague(ws)).toBe(true);
  expect(loaded.persona.preset).toBe("family");
  expect(loaded.warnings).toEqual([]);
  expect(ws.setup.persona).toBe("done");
});

test("a picked persona loads with its preset and no style note, and its file explains the overrides in comments", async () => {
  const { ws } = await setUp({ persona: "roast" });
  const text = await readFile(personaPath(ws), "utf8");
  expect(text).toMatch(/^# .*swearing/m);
  const loaded = await loadPersona(ws, await committed(8), await loadLore(ws));
  expect(loaded.persona).toMatchObject({ preset: "roast", styleNote: "" });
  expect(loaded.warnings).toEqual([]);
});

test("a skipped persona step writes a placeholder that loads as Broadcast with no warnings", async () => {
  const { ws } = await setUp();
  const loaded = await loadPersona(ws, await committed(8), await loadLore(ws));
  expect(loaded.persona).toMatchObject({ preset: "broadcast", styleNote: "" });
  expect(loaded.warnings).toEqual([]);
  expect(ws.setup.persona).toBe("skipped");
});

test("a renamed handle has to fit a lore heading and be free", () => {
  expect(handleProblem("bo", ["rita"])).toBeUndefined();
  expect(handleProblem("Big Bo", [])).toMatch(/lowercase letters/);
  expect(handleProblem("bo=1", [])).toMatch(/lowercase letters/);
  expect(handleProblem("rita", ["rita"])).toMatch(/already/);
});

test("accepted handles are written to workspace.md with their accounts", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const [first, second] = proposedHandles(league);
  if (!first || !second) throw new Error("the fixture has managers");

  const { dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league,
    handles: [{ ...first, handle: "null" }, second],
  });

  expect((await readWorkspace(dir)).handles).toEqual({
    null: ["sleeper:800000000000000001"],
    "waiver-wendy": ["sleeper:800000000000000002"],
  });
});

test("a skipped handles step links nobody", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const { dir } = await setUpWorkspace(deps, { punditName: "Rikhin", league });
  expect((await readWorkspace(dir)).handles).toEqual({});
});

test("a handle that wouldn't fit a lore heading is refused before anything is written", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const [first] = proposedHandles(league);
  if (!first) throw new Error("the fixture has managers");
  await expect(
    setUpWorkspace(deps, {
      punditName: "Rikhin",
      league,
      handles: [{ ...first, handle: "Big Bo" }],
    }),
  ).rejects.toThrow(SetupRefusal);
});

test("the key and cap are asked on a first league, and a second league that has them skips both", async () => {
  const deps = atWeek(await operator(), 8);
  expect(await operatorSteps(deps)).toEqual({
    askKey: true,
    askCap: true,
    spendCap: 5,
  });

  await setUp({ key: "sk-ant-mine", spendCap: 20 }, deps);

  expect(await operatorSteps(deps)).toEqual({
    askKey: false,
    askCap: false,
    spendCap: 20,
  });
  expect((await loadCredentials(deps)).anthropicApiKey?.value).toBe(
    "sk-ant-mine",
  );
  expect(await readFile(join(deps.configDir, "config.yaml"), "utf8")).toMatch(
    /spend_cap_usd: 20/,
  );
});

test("a skipped key is asked again on the next league, with the cap as it stands", async () => {
  const deps = atWeek(await operator(), 8);
  await setUp({}, deps);
  expect(await operatorSteps(deps)).toEqual({
    askKey: true,
    askCap: true,
    spendCap: 5,
  });
});

test("an ANTHROPIC_API_KEY override counts as a key, so only a missing config asks for the cap", async () => {
  const base = atWeek(await operator(), 8);
  const deps = { ...base, env: { ...base.env, anthropicApiKey: "sk-env" } };
  expect(await operatorSteps(deps)).toMatchObject({
    askKey: false,
    askCap: true,
  });
  await setUp({}, deps);
  expect(await operatorSteps(deps)).toMatchObject({
    askKey: false,
    askCap: false,
  });
});

test("a cap given on a later league keeps config.yaml's comments", async () => {
  const deps = atWeek(await operator(), 8);
  await mkdir(deps.configDir, { recursive: true });
  const path = join(deps.configDir, "config.yaml");
  await writeFile(path, "format: 1\n# mine\nspend_cap_usd: 5\n");
  await setUp({ spendCap: 9 }, deps);
  const text = await readFile(path, "utf8");
  expect(text).toMatch(/# mine/);
  expect(text).toMatch(/spend_cap_usd: 9/);
});

test("a cap is a number of dollars, and one too small for a call says so", async () => {
  const deps = atWeek(await operator(), 8);
  expect(spendCapProblem("5")).toBeUndefined();
  expect(spendCapProblem("0.50")).toBeUndefined();
  for (const bad of ["", "abc", "-1", "$5", "Infinity"]) {
    expect(spendCapProblem(bad)).toMatch(/dollars/);
  }
  // Sonnet 5.5's 16000-token reply at $10 per million tokens, and no prompt yet.
  expect(await spendCapWarning(deps, 0.1)).toMatch(/\$0\.16.*stat lines/);
  expect(await spendCapWarning(deps, 5)).toBeUndefined();
});

test("a key is checked live: a rejected one is asked again, and one that can't be checked is kept with a warning", async () => {
  const base = await operator();
  const answering = (status: number): Deps => ({
    ...base,
    transport: {
      request: async () => ({ status, body: new Uint8Array() }),
    },
  });
  expect(await checkKey(answering(200), "k")).toEqual({});
  expect((await checkKey(answering(401), "k")).problem).toMatch(/refused/);
  const unreachable = await checkKey(answering(500), "k");
  expect(unreachable.problem).toBeUndefined();
  expect(unreachable.warning).toMatch(/couldn't check/);
});

test("a key check that never gets an answer gives up after its bounded wait: the key is kept with a warning, and the request is aborted", async () => {
  const base = await operator();
  let signal: AbortSignal | undefined;
  const silent: Deps = {
    ...base,
    transport: {
      request: (req) => {
        signal = req.signal;
        return new Promise(() => {});
      },
    },
  };
  vi.useFakeTimers();
  try {
    const checked = checkKey(silent, "k");
    await vi.advanceTimersByTimeAsync(KEY_CHECK_WAIT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const { problem, warning } = await checked;
    expect(problem).toBeUndefined();
    expect(warning).toMatch(/couldn't check it \(no answer in 10 seconds\)/);
    expect(signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("a credentials file that can't take the key leaves no workspace behind and lists nothing", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  await mkdir(deps.configDir, { recursive: true });
  await writeFile(join(deps.configDir, "credentials.yaml"), "format: 99\n");
  await expect(
    setUpWorkspace(deps, { punditName: "Rikhin", league, key: "k" }),
  ).rejects.toThrow();
  expect(await readdir(deps.workspacesDir).catch(() => [])).toEqual([]);
  await expect(
    readFile(join(deps.configDir, "config.yaml"), "utf8"),
  ).rejects.toThrow();
});

function statuses(items: { step: string; status: string }[]) {
  return Object.fromEntries(items.map((i) => [i.step, i.status]));
}

test("the setup checklist matches what was done and skipped", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const { dir } = await setUp(
    {
      handles: proposedHandles(league),
      method: "standings",
      key: "sk-ant-mine",
      spendCap: 20,
    },
    deps,
  );
  expect(statuses(await setupChecklist(deps, dir))).toEqual({
    "pundit name": "done",
    "league data": "done",
    handles: "done",
    lore: "skipped",
    stakes: "skipped",
    method: "done",
    key: "done",
    cap: "done",
    persona: "skipped",
  });
});

test("a checklist tells the accepted default method from a skipped one, and skipped steps from done", async () => {
  const deps = atWeek(await operator(), 8);
  const { dir } = await setUp(
    { method: "ramped-blend", persona: "broadcast" },
    deps,
  );
  expect(statuses(await setupChecklist(deps, dir))).toMatchObject({
    handles: "skipped",
    method: "default",
    key: "skipped",
    cap: "default",
    persona: "default",
  });

  const other = atWeek(await operator(), 8);
  const skipped = await setUp({}, other);
  expect(statuses(await setupChecklist(other, skipped.dir))).toMatchObject({
    method: "skipped",
  });
});

test("the checklist's steps come in the order init asks them", async () => {
  const { deps, dir } = await setUp();
  expect((await setupChecklist(deps, dir)).map((i) => i.step)).toEqual([
    "pundit name",
    "league data",
    "handles",
    "lore",
    "stakes",
    "method",
    "key",
    "cap",
    "persona",
  ]);
});

test("a workspace written before the checklist existed reads every step it can't vouch for as skipped", async () => {
  const deps = atWeek(await operator(), 8);
  const { dir } = await setUp({ method: "standings" }, deps);
  const file = join(dir, "workspace.md");
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace(/^setup:\n(?: .*\n)*/m, ""));
  expect(statuses(await setupChecklist(deps, dir))).toMatchObject({
    "league data": "done",
    method: "skipped",
  });
});

test("a fresh init with every step answered, then draft, sends a manager's lore under the accepted handle", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const llm = scriptedLlm("not a usable reply");
  const { dir } = await setUp(
    { handles: proposedHandles(league), method: "standings", key: "k" },
    { ...deps, llm },
  );
  await appendFile(
    join(dir, "lore.md"),
    "\n## {manager=benchwarmer-bo}\n- Hoards kickers.\n",
  );

  const result = await draft(dir, { ...deps, llm });

  expect(llm.requests[0]?.prompt).toContain("Hoards kickers.");
  expect(result.warnings).toEqual([]);
});

test("a fresh init with every step skipped, then draft, writes stat lines", async () => {
  const { deps, dir } = await setUp();
  const result = await draft(dir, deps);
  expect(result.fallback).toMatch(/ANTHROPIC_API_KEY/);
  expect(await readFile(result.path, "utf8")).toMatch(/method: ramped-blend/);
});

test("a spend cap config.yaml couldn't read back is refused before anything is written", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  await expect(
    setUpWorkspace(deps, { punditName: "Rikhin", league, spendCap: -3 }),
  ).rejects.toThrow(SetupRefusal);
  expect(await readdir(deps.workspacesDir).catch(() => [])).toEqual([]);
});
