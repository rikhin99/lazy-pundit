import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";
import { dropWorkspaces } from "../src/config.ts";
import {
  checkLeague,
  type Deps,
  defaultPunditName,
  draft,
  FetchError,
  findWorkspace,
  PLATFORM_WAIT_MS,
  platformStop,
  punditNameProblem,
  refuseLeagueSetUp,
  SetupRefusal,
  setUpWorkspace,
  sleeperLeagues,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import {
  atWeek,
  FEAR_THE_TURTLE_ID,
  fixedClock,
  type Json,
  operator,
  patchingTransport,
  rankingsDir,
  silentOn,
} from "./support/workspace.ts";

/** No workspace folder and no config: a refusal leaves nothing behind. */
async function expectNothingWritten(deps: Deps) {
  const listing = (dir: string) => readdir(dir).catch(() => []);
  expect(await listing(deps.workspacesDir)).toEqual([]);
  expect(await listing(deps.configDir)).toEqual([]);
}

test("a typed league ID sets up a workspace that --league finds and draft runs in", async () => {
  const deps = atWeek(await operator(), 8);

  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  expect(league).toMatchObject({
    leagueId: FEAR_THE_TURTLE_ID,
    name: "Fear The Turtle",
    season: "2025",
    warnings: [],
  });

  const { slug, dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league,
  });
  expect(slug).toBe("fear-the-turtle");
  expect(dir).toBe(join(deps.workspacesDir, "fear-the-turtle"));

  expect(await readFile(join(dir, "workspace.md"), "utf8")).toContain(
    `format: 1
pundit: rikhin
seasons:
  2025:
    platform: sleeper
    league_id: "${FEAR_THE_TURTLE_ID}"
`,
  );
  expect(await readFile(join(dir, ".snapshots/.gitignore"), "utf8")).toBe(
    "*\n",
  );
  expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(
    // The snapshot folder's own `*` ignores itself, so a clone needs this line.
    ".snapshots/\ntranscripts/\n",
  );
  expect(await findWorkspace(deps, { cwd: "/", league: slug })).toBe(dir);

  await draft(dir, deps);
  expect(
    await readFile(join(rankingsDir(dir), "week-08.md"), "utf8"),
  ).toContain("## Pylon Patrol {team=sleeper:6}");
});

/** The fixture league, with its league payload changed as a real fetch could see it. */
async function leaguePatched(patch: (league: Json) => void): Promise<Deps> {
  const deps = atWeek(await operator(), 8);
  return {
    ...deps,
    transport: patchingTransport(deps.transport, {
      [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`]: patch,
    }),
  };
}

test.each([
  ["median scoring", { league_average_match: 1 }, /median/i],
  ["divisions", { divisions: 2 }, /divisions/i],
])(
  "a league with %s is accepted, warned it gets no playoff status",
  async (_kind, settings, named) => {
    const deps = await leaguePatched((l) =>
      Object.assign(l.settings, settings),
    );
    const { warnings } = await checkLeague(deps, FEAR_THE_TURTLE_ID);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(named);
    expect(warnings[0]).toMatch(/no playoff status/);
  },
);

test.each([
  [1, /keeper/],
  [2, /dynasty/],
])(
  "a league of type %i is accepted with a warning naming its rules",
  async (type, named) => {
    const deps = await leaguePatched((l) => {
      l.settings.type = type;
    });
    const { warnings } = await checkLeague(deps, FEAR_THE_TURTLE_ID);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(named);
    expect(warnings[0]).not.toMatch(/playoff status/);
  },
);

test("a league with no point values, as a categories league would be, is refused", async () => {
  const deps = await leaguePatched((l) => {
    l.scoring_settings = {};
  });
  await expect(checkLeague(deps, FEAR_THE_TURTLE_ID)).rejects.toThrow(
    SetupRefusal,
  );
  await expect(checkLeague(deps, FEAR_THE_TURTLE_ID)).rejects.toThrow(
    /categories or roto/,
  );
  await expectNothingWritten(deps);
});

test("another sport is refused", async () => {
  const deps = await leaguePatched((l) => {
    l.sport = "nba";
  });
  await expect(checkLeague(deps, FEAR_THE_TURTLE_ID)).rejects.toThrow(
    "This league's sport is nba, and Lazy Pundit ranks football leagues only.",
  );
});

test.each([
  ["a 404", async () => ({ status: 404, body: new Uint8Array() })],
  [
    "Sleeper's null",
    async () => ({ status: 200, body: new TextEncoder().encode("null") }),
  ],
])("an unknown league ID (%s) is refused by name", async (_kind, request) => {
  const deps = { ...(await operator()), transport: { request } };
  await expect(checkLeague(deps, "123")).rejects.toThrow(SetupRefusal);
  await expect(checkLeague(deps, "123")).rejects.toThrow(
    /no league with the ID 123/,
  );
});

test("a Sleeper outage isn't reported as a wrong league ID", async () => {
  const deps = {
    ...(await operator()),
    transport: {
      request: async () => ({ status: 503, body: new Uint8Array() }),
    },
  };
  await expect(checkLeague(deps, "123")).rejects.toThrow(FetchError);
});

test("a league check that never gets an answer fails as a fetch after 30 seconds, with the request aborted", async () => {
  const base = await operator();
  const { transport, asked } = silentOn(base.transport);
  const deps = { ...base, transport };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const checked = checkLeague(deps, "123");
    checked.catch(() => {});
    const signal = await asked();
    await vi.advanceTimersByTimeAsync(PLATFORM_WAIT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(checked).rejects.toThrow(FetchError);
    await expect(checked).rejects.toThrow(
      `GET ${SLEEPER_API}/league/123 got no answer in 30 seconds`,
    );
    expect(signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

/** Sleeper answering for one account with these leagues in 2025, then `inner`. */
function sleeperAccount(
  inner: Deps["transport"],
  username: string,
  leagues: unknown[],
): Deps["transport"] {
  const json = (value: unknown) => ({
    status: 200,
    body: new TextEncoder().encode(JSON.stringify(value)),
  });
  return {
    async request(req) {
      if (req.url === `${SLEEPER_API}/user/${username}`) {
        return json({ username, user_id: "42", display_name: username });
      }
      if (req.url === `${SLEEPER_API}/user/42/leagues/nfl/2025`) {
        return json(leagues);
      }
      return inner.request(req);
    },
  };
}

test("a Sleeper username lists this season's leagues to pick from", async () => {
  const base = await operator();
  const deps = {
    ...base,
    transport: sleeperAccount(base.transport, "rikhin", [
      {
        league_id: "1",
        name: "Work League",
        season: "2025",
        total_rosters: 10,
      },
      { league_id: "2", name: "Family", season: "2025", total_rosters: 8 },
    ]),
  };
  expect(await sleeperLeagues(deps, "rikhin")).toEqual([
    { leagueId: "1", name: "Work League", season: "2025", teams: 10 },
    { leagueId: "2", name: "Family", season: "2025", teams: 8 },
  ]);
});

test("in February the season is still last year's", async () => {
  const base = await operator();
  const deps = {
    ...base,
    clock: fixedClock("2026-02-10T12:00:00.000Z"),
    transport: sleeperAccount(base.transport, "rikhin", [
      {
        league_id: "1",
        name: "Work League",
        season: "2025",
        total_rosters: 10,
      },
    ]),
  };
  expect(await sleeperLeagues(deps, "rikhin")).toHaveLength(1);
});

test("an unknown Sleeper username is refused by name", async () => {
  await expect(sleeperLeagues(await operator(), "nobody")).rejects.toThrow(
    /no account named nobody/,
  );
});

test("the pick list marks a league a listed workspace already holds", async () => {
  const fixture = atWeek(await operator(), 8);
  const league = await checkLeague(fixture, FEAR_THE_TURTLE_ID);
  const { dir } = await setUpWorkspace(fixture, {
    punditName: "Rikhin",
    league,
  });
  const deps = {
    ...fixture,
    transport: sleeperAccount(fixture.transport, "rikhin", [
      {
        league_id: FEAR_THE_TURTLE_ID,
        name: "Fear The Turtle",
        season: "2025",
        total_rosters: 12,
      },
      { league_id: "2", name: "Family", season: "2025", total_rosters: 8 },
    ]),
  };
  expect(await sleeperLeagues(deps, "rikhin")).toEqual([
    {
      leagueId: FEAR_THE_TURTLE_ID,
      name: "Fear The Turtle",
      season: "2025",
      teams: 12,
      setUpIn: dir,
    },
    { leagueId: "2", name: "Family", season: "2025", teams: 8 },
  ]);
});

test("a league set up only for an earlier season isn't marked", async () => {
  const fixture = atWeek(await operator(), 8);
  const league = await checkLeague(fixture, FEAR_THE_TURTLE_ID);
  // Sleeper gives each season's league its own ID.
  await setUpWorkspace(fixture, {
    punditName: "Rikhin",
    league: { ...league, leagueId: "700", season: "2024" },
  });
  const deps = {
    ...fixture,
    transport: sleeperAccount(fixture.transport, "rikhin", [
      {
        league_id: FEAR_THE_TURTLE_ID,
        name: "Fear The Turtle",
        season: "2025",
        total_rosters: 12,
      },
    ]),
  };
  const [choice] = await sleeperLeagues(deps, "rikhin");
  expect(choice).not.toHaveProperty("setUpIn");
});

test("a league already set up is refused before the live fetch", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const { dir } = await setUpWorkspace(deps, { punditName: "Rikhin", league });

  await expect(
    refuseLeagueSetUp(deps, {
      punditName: " Rikhin ",
      leagueId: FEAR_THE_TURTLE_ID,
    }),
  ).rejects.toThrow(`This league is already set up in ${dir}.`);
  await expect(
    refuseLeagueSetUp(deps, { punditName: "Bo", leagueId: FEAR_THE_TURTLE_ID }),
  ).rejects.toThrow(
    `This league's workspace in ${dir} belongs to rikhin, and multi-pundit is a later stage.`,
  );
  await expect(
    refuseLeagueSetUp(deps, { punditName: "Rikhin", leagueId: "2" }),
  ).resolves.toBeUndefined();
});

test("a pundit's name defaults from config.yaml", async () => {
  const deps = atWeek(await operator(), 8);
  expect(await defaultPunditName(deps)).toBeUndefined();
  await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league: await checkLeague(deps, FEAR_THE_TURTLE_ID),
  });
  expect(await defaultPunditName(deps)).toBe("Rikhin");
});

test("a second pundit for a listed league is refused, with nothing changed", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  await setUpWorkspace(deps, { punditName: "Rikhin", league });
  const config = await readFile(join(deps.configDir, "config.yaml"), "utf8");

  await expect(
    setUpWorkspace(deps, { punditName: "Bo", league }),
  ).rejects.toThrow(/multi-pundit is a later stage/);
  await expect(
    setUpWorkspace(deps, { punditName: "Rikhin", league }),
  ).rejects.toThrow(/already set up/);

  expect(await readFile(join(deps.configDir, "config.yaml"), "utf8")).toBe(
    config,
  );
  expect(await readdir(deps.workspacesDir)).toEqual(["fear-the-turtle"]);
});

test("a different league with the same name gets its own slug", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  await setUpWorkspace(deps, { punditName: "Rikhin", league });
  const { slug, dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league: { ...league, leagueId: "555" },
  });
  expect(slug).toBe("fear-the-turtle-2");
  expect(dir).toBe(join(deps.workspacesDir, "fear-the-turtle-2"));
});

test("listing a workspace keeps an existing config.yaml's comments and name", async () => {
  const deps = atWeek(await operator(), 8);
  await mkdir(deps.configDir, { recursive: true });
  const before = `# my settings
format: 1
name: Rik # short for Rikhin
spend_cap_usd: 2
`;
  await writeFile(join(deps.configDir, "config.yaml"), before);
  const { slug, dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league: await checkLeague(deps, FEAR_THE_TURTLE_ID),
  });
  expect(await readFile(join(deps.configDir, "config.yaml"), "utf8")).toBe(
    `${before}workspaces:\n  ${slug}: ${dir}\n`,
  );
});

test("a new config.yaml starts with its format and shows the defaults", async () => {
  const deps = atWeek(await operator(), 8);
  const { slug, dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league: await checkLeague(deps, FEAR_THE_TURTLE_ID),
  });
  expect(await readFile(join(deps.configDir, "config.yaml"), "utf8")).toBe(
    `format: 1
name: Rikhin
model: claude-sonnet-5-5
spend_cap_usd: 5
workspaces:
  ${slug}: ${dir}
`,
  );
});

test("a chosen folder is used; a relative one or one in use is refused with nothing written", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const home = dirname(deps.workspacesDir);

  await expect(
    setUpWorkspace(deps, { punditName: "Rikhin", league, dir: "~/leagues/x" }),
  ).rejects.toThrow(/full path/);

  const inUse = join(home, "in-use");
  await mkdir(inUse);
  await writeFile(join(inUse, "notes.txt"), "mine");
  await expect(
    setUpWorkspace(deps, { punditName: "Rikhin", league, dir: inUse }),
  ).rejects.toThrow(/isn't empty/);
  expect(await readdir(inUse)).toEqual(["notes.txt"]);
  await expectNothingWritten(deps);

  const chosen = join(home, "chosen");
  const set = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league,
    dir: chosen,
  });
  expect(set.dir).toBe(chosen);
  expect(await findWorkspace(deps, { cwd: "/", league: set.slug })).toBe(
    chosen,
  );
});

test("a pundit name with no letter or digit is refused", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  await expect(
    setUpWorkspace(deps, { punditName: " !! ", league }),
  ).rejects.toThrow(/letter or digit/);
  await expectNothingWritten(deps);
});

test("a config.yaml that can't be listed in leaves no workspace behind", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  await mkdir(deps.configDir, { recursive: true });
  await writeFile(join(deps.configDir, "config.yaml"), "format: 1\n");
  // A read-only config folder stops the listing's temp file being written.
  await chmod(deps.configDir, 0o500);
  try {
    await expect(
      setUpWorkspace(deps, { punditName: "Rikhin", league }),
    ).rejects.toThrow();
  } finally {
    await chmod(deps.configDir, 0o700);
  }
  expect(await readdir(deps.workspacesDir).catch(() => [])).toEqual([]);
});

test("Yahoo and ESPN stop setup with a message, and Sleeper goes on", () => {
  expect(platformStop("yahoo")).toBe("Yahoo support comes in a later release.");
  expect(platformStop("espn")).toBe("ESPN support comes in a later release.");
  expect(platformStop("sleeper")).toBeUndefined();
});

test("a chosen folder holding another pundit's workspace for the league is refused as multi-pundit", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const { slug, dir } = await setUpWorkspace(deps, {
    punditName: "Rikhin",
    league,
  });
  await dropWorkspaces(deps, [slug]);
  await expect(
    setUpWorkspace(deps, { punditName: "Bo", league, dir }),
  ).rejects.toThrow(/multi-pundit is a later stage/);
});

test("a folder that can't be used is refused by name, not with a system error", async () => {
  const deps = atWeek(await operator(), 8);
  const league = await checkLeague(deps, FEAR_THE_TURTLE_ID);
  const home = dirname(deps.workspacesDir);

  const file = join(home, "a-file");
  await writeFile(file, "mine");
  await expect(
    setUpWorkspace(deps, { punditName: "Rikhin", league, dir: file }),
  ).rejects.toThrow(SetupRefusal);

  const locked = join(home, "locked");
  await mkdir(locked, { mode: 0o500 });
  await expect(
    setUpWorkspace(deps, {
      punditName: "Rikhin",
      league,
      dir: join(locked, "league"),
    }),
  ).rejects.toThrow(SetupRefusal);
  await expectNothingWritten(deps);
});

test("a league the tool can't read is refused by name, not with a stack trace", async () => {
  const base = atWeek(await operator(), 8);
  const deps = {
    ...base,
    transport: patchingTransport(base.transport, {
      [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}/rosters`]: (rosters) => {
        rosters[0].settings = null;
      },
    }),
  };
  await expect(checkLeague(deps, FEAR_THE_TURTLE_ID)).rejects.toThrow(
    SetupRefusal,
  );
});

test("a pundit name's problem is said before anything is asked of the league", () => {
  expect(punditNameProblem("Rikhin")).toBeUndefined();
  expect(punditNameProblem(" !! ")).toMatch(/letter or digit/);
});
