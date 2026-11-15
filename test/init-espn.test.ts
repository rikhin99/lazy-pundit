import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  CookieRefusal,
  changeAnswersNote,
  checkEspnLeague,
  checkWorkspace,
  draft,
  espnWorkspaceLeague,
  FetchError,
  loadCredentials,
  refuseLeagueSetUp,
  refuseUneditableWorkspace,
  rerunLeague,
  rerunStep,
  SetupRefusal,
  saveCredentials,
  setUpWorkspace,
} from "../src/index.ts";
import { HOT_TAKERY_ID, hotTakeryAt } from "./support/espn.ts";
import { fixedClock, operator, withFrontMatter } from "./support/workspace.ts";

const COOKIE = "AEB%2Bprivate%2Fcookie";

/** The setup refusal the check throws, which the test expects. */
async function refusal(promise: Promise<unknown>): Promise<SetupRefusal> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SetupRefusal);
  return err as SetupRefusal;
}

test("a public ESPN league is read with no cookie and set up on ESPN", async () => {
  const deps = hotTakeryAt(await operator(), 8);

  const league = await checkEspnLeague(deps, HOT_TAKERY_ID);
  expect(league).toMatchObject({
    platform: "espn",
    leagueId: HOT_TAKERY_ID,
    name: "The Hot Takery League 2.0",
    season: "2025",
    warnings: [],
  });
  expect(league.teamList.length).toBe(league.teams);
  expect(league.managers.every((m) => m.account.startsWith("espn:"))).toBe(
    true,
  );

  const { dir } = await setUpWorkspace(deps, { punditName: "Rikhin", league });
  expect(await readFile(join(dir, "workspace.md"), "utf8")).toContain(
    `seasons:
  2025:
    platform: espn
    league_id: "${HOT_TAKERY_ID}"
`,
  );
});

test("a rejected cookie and a wrong league ID are refused with their own messages, and nothing is written", async () => {
  const deps = hotTakeryAt(await operator(), 8, { privateTo: COOKIE });
  const rejected = await refusal(
    checkEspnLeague(deps, HOT_TAKERY_ID, { cookie: "AEB%2Bstale" }),
  );
  expect(rejected).toBeInstanceOf(CookieRefusal);
  expect(rejected.message).toBe(
    `ESPN rejected that cookie for league ${HOT_TAKERY_ID}. Copy espn_s2 again, signed in to an ESPN account in the league, or check the league ID: a mistyped one can be someone else's private league.`,
  );

  const unknown = await refusal(
    checkEspnLeague(hotTakeryAt(deps, 8, { status: 404 }), HOT_TAKERY_ID),
  );
  expect(unknown).not.toBeInstanceOf(CookieRefusal);
  expect(unknown.message).toBe(
    `ESPN has no league ${HOT_TAKERY_ID} in 2025. Check the number after leagueId= in the league's URL.`,
  );

  const listing = (dir: string) => readdir(dir).catch(() => []);
  expect(await listing(deps.workspacesDir)).toEqual([]);
  expect(await listing(deps.configDir)).toEqual([]);
});

test("a stored cookie is used without asking, and asked for again when ESPN rejects it", async () => {
  const base = await operator();
  await saveCredentials(base, { espnS2: COOKIE });
  const league = await checkEspnLeague(
    hotTakeryAt(base, 8, { privateTo: COOKIE }),
    HOT_TAKERY_ID,
  );
  expect(league.leagueId).toBe(HOT_TAKERY_ID);

  const renewed = hotTakeryAt(base, 8, { privateTo: "AEB%2Bnewer" });
  const rejected = await refusal(checkEspnLeague(renewed, HOT_TAKERY_ID));
  expect(rejected).toBeInstanceOf(CookieRefusal);
  expect(rejected.message).toBe(
    `ESPN rejected the stored espn_s2 cookie (saved 2025-10-28) for league ${HOT_TAKERY_ID}. Copy a fresh one from your browser.`,
  );
});

test("a rejected cookie from LAZY_PUNDIT_ESPN_S2 ends setup, since no typed cookie replaces it", async () => {
  const base = await operator();
  const deps = hotTakeryAt(
    { ...base, env: { ...base.env, espnS2: "AEB%2Benv" } },
    8,
    { privateTo: COOKIE },
  );
  const err = await checkEspnLeague(deps, HOT_TAKERY_ID).catch(
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(FetchError);
  expect(err).not.toBeInstanceOf(SetupRefusal);
  expect((err as Error).message).toMatch(/LAZY_PUNDIT_ESPN_S2.*unset it/);
});

test.each(["H2H_CATEGORY", "ROTO"])(
  "an ESPN league scored by %s is refused, since only points leagues are ranked",
  async (scoringType) => {
    const deps = hotTakeryAt(await operator(), 8, {
      league: (json) => {
        json.settings.scoringSettings.scoringType = scoringType;
      },
    });
    const refused = await refusal(checkEspnLeague(deps, HOT_TAKERY_ID));
    expect(refused.message).toMatch(
      new RegExp(
        `^Can't read ESPN league ${HOT_TAKERY_ID}: .*it's scored by ${scoringType}, and Lazy Pundit ranks only head-to-head points leagues$`,
      ),
    );
  },
);

test("a Sleeper workspace with the same league ID doesn't hold the ESPN league", async () => {
  const deps = hotTakeryAt(await operator(), 8);
  const espn = await checkEspnLeague(deps, HOT_TAKERY_ID);
  await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league: { ...espn, platform: "sleeper", name: "Sleeper Twin" },
  });

  const answers = { punditName: "Rikhin", leagueId: HOT_TAKERY_ID };
  await expect(
    refuseLeagueSetUp(deps, { ...answers, platform: "sleeper" }),
  ).rejects.toThrow(/already set up/);
  await refuseLeagueSetUp(deps, { ...answers, platform: "espn" });
  const { dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league: espn,
  });
  expect(dir).toBe(join(deps.workspacesDir, "the-hot-takery-league-2-0"));
});

test("init's note names setup espn among the steps for an ESPN league", async () => {
  const deps = hotTakeryAt(await operator(), 8);
  const league = await checkEspnLeague(deps, HOT_TAKERY_ID);
  const { slug, dir } = await checkWorkspace(deps, {
    punditName: "Rikhin",
    league,
  });
  expect(changeAnswersNote(deps, { slug, dir, platform: "espn" })).toMatch(
    /with <step> one of: espn, handles, lore, stakes, method, key, cap, persona\.\n/,
  );
});

/** An ESPN workspace set up with a stored cookie, its deps reading it as private to that cookie. */
async function espnWorkspace() {
  const base = await operator();
  await saveCredentials(base, { espnS2: COOKIE });
  const deps = hotTakeryAt(base, 8, { privateTo: COOKIE });
  const league = await checkEspnLeague(deps, HOT_TAKERY_ID);
  const { dir } = await setUpWorkspace(deps, { punditName: "Rikhin", league });
  return { deps, dir };
}

const noConfirm = async () => {
  throw new Error("setup espn edits no workspace file");
};

test("setup espn saves a new cookie dated today, leaving workspace.md as it was", async () => {
  const { deps, dir } = await espnWorkspace();
  const before = await readFile(join(dir, "workspace.md"), "utf8");
  const later = { ...deps, clock: fixedClock("2026-09-30T12:00:00.000Z") };

  // The workspace's own season, not the clock's.
  expect(await espnWorkspaceLeague(dir)).toEqual({
    leagueId: HOT_TAKERY_ID,
    season: "2025",
  });
  await checkEspnLeague(
    hotTakeryAt(later, 8, { privateTo: "AEB%2Bnew" }),
    HOT_TAKERY_ID,
    {
      cookie: "AEB%2Bnew",
      season: "2025",
    },
  );
  expect(
    await rerunStep(
      later,
      dir,
      { step: "espn", cookie: "AEB%2Bnew" },
      noConfirm,
    ),
  ).toEqual({ written: true, warnings: [] });

  expect((await loadCredentials(deps)).espnS2).toEqual({
    value: "AEB%2Bnew",
    from: "file",
    savedAt: "2026-09-30",
  });
  expect(await readFile(join(dir, "workspace.md"), "utf8")).toBe(before);
});

test("setup espn skipped keeps the stored cookie", async () => {
  const { deps, dir } = await espnWorkspace();
  expect(await rerunStep(deps, dir, { step: "espn" }, noConfirm)).toEqual({
    written: false,
    warnings: [],
  });
  expect((await loadCredentials(deps)).espnS2?.value).toBe(COOKIE);
});

test("setup espn in a Sleeper league's workspace is refused before anything is asked", async () => {
  const { deps, dir } = await espnWorkspace();
  const path = join(dir, "workspace.md");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(
      "platform: espn",
      "platform: sleeper",
    ),
  );
  const message =
    "This workspace's league is on Sleeper, which needs no ESPN cookie: run lazy-pundit setup espn in an ESPN league's workspace.";
  await expect(espnWorkspaceLeague(dir)).rejects.toThrow(
    new SetupRefusal(message),
  );
  await expect(
    rerunStep(deps, dir, { step: "espn", cookie: "AEB%2Bnew" }, noConfirm),
  ).rejects.toThrow(message);
  expect((await loadCredentials(deps)).espnS2?.value).toBe(COOKIE);
});

test("setup espn works on a workspace.md whose front matter other steps can't edit", async () => {
  const { deps, dir } = await espnWorkspace();
  const path = join(dir, "workspace.md");
  await writeFile(
    path,
    withFrontMatter(await readFile(path, "utf8"), (lines) =>
      lines.map((line) => `  ${line}`),
    ),
  );
  await refuseUneditableWorkspace(dir, "espn");
  await rerunStep(deps, dir, { step: "espn", cookie: "AEB%2Bnew" }, noConfirm);
  expect((await loadCredentials(deps)).espnS2?.value).toBe("AEB%2Bnew");
});

test("setup handles and setup lore read an ESPN workspace's league from ESPN, in its own season", async () => {
  const { deps, dir } = await espnWorkspace();
  const later = { ...deps, clock: fixedClock("2026-09-30T12:00:00.000Z") };
  const { league, proposed } = await rerunLeague(later, dir);
  expect(league).toMatchObject({
    platform: "espn",
    leagueId: HOT_TAKERY_ID,
    season: "2025",
  });
  expect(proposed.length).toBe(league.managers.length);
});

/** Every file under `dir`, read as text. */
async function everyFile(dir: string): Promise<string[]> {
  const paths = await readdir(dir, { recursive: true, withFileTypes: true });
  return Promise.all(
    paths
      .filter((p) => p.isFile())
      .map((p) => readFile(join(p.parentPath, p.name), "utf8")),
  );
}

test("a private ESPN league asks for the cookie, which init saves 0600 and never in the workspace", async () => {
  const deps = hotTakeryAt(await operator(), 8, { privateTo: COOKIE });

  const asked = await refusal(checkEspnLeague(deps, HOT_TAKERY_ID));
  expect(asked).toBeInstanceOf(CookieRefusal);
  expect(asked.message).toBe(
    `ESPN league ${HOT_TAKERY_ID} is private, so reading it needs your espn_s2 cookie.`,
  );

  const league = await checkEspnLeague(deps, HOT_TAKERY_ID, {
    cookie: COOKIE,
  });
  const { dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league,
    cookie: COOKIE,
  });

  const path = join(deps.configDir, "credentials.yaml");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await loadCredentials(deps)).toMatchObject({
    espnS2: { value: COOKIE, from: "file", savedAt: "2025-10-28" },
  });

  await draft(dir, deps);
  const files = await everyFile(dir);
  // The draft's snapshot manifest is among them.
  expect(files.some((f) => f.includes('"platform": "espn"'))).toBe(true);
  expect(files.filter((f) => f.includes(COOKIE))).toEqual([]);
});
