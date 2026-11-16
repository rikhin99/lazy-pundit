import { chmod, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CaptureError, captureEspn } from "../scripts/capture-espn.ts";
import { readRaw, scrubEspnFixtures } from "../scripts/scrub-espn.ts";
import { ESPN_VIEWS, espnLeagueUrl, espnViewUrl } from "../src/espn/api.ts";
import { type Deps, fetchEspn, saveCredentials } from "../src/index.ts";
import { HOT_TAKERY_ID, hotTakeryAt } from "./support/espn.ts";
import { failingOn, type Json, operator } from "./support/workspace.ts";

const COOKIE = "AEB%2Fcapture-cookie";

/** Hot Takery's week-15 replay, with every request it's asked counted. */
async function replay(
  opts: { privateTo?: string; stored?: string; env?: string } = {},
) {
  const base = await operator();
  if (opts.stored) await saveCredentials(base, { espnS2: opts.stored });
  if (opts.env) base.env.espnS2 = opts.env;
  const deps = hotTakeryAt(
    base,
    15,
    opts.privateTo ? { privateTo: opts.privateTo } : {},
  );
  const asked: string[] = [];
  const transport = deps.transport;
  deps.transport = {
    request(req) {
      asked.push(req.url);
      return transport.request(req);
    },
  };
  return { deps, asked };
}

async function capture(
  deps: Deps,
  extra: Partial<Parameters<typeof captureEspn>[0]> = {},
) {
  const rawDir =
    extra.rawDir ?? join(await mkdtemp(join(tmpdir(), "capture-")), "raw");
  const lines: string[] = [];
  let error: unknown;
  try {
    await captureEspn({
      deps,
      leagueId: HOT_TAKERY_ID,
      season: "2025",
      rawDir,
      log: (line) => lines.push(line),
      ...extra,
    });
  } catch (err) {
    error = err;
  }
  return { rawDir, lines, error };
}

/** Every file under `dir`, by its path inside it. */
async function filesUnder(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
      .sort();
  } catch {
    return [];
  }
}

test("a full fetch's payloads land in the files the scrub reads", async () => {
  const { deps } = await replay({ privateTo: COOKIE, stored: COOKIE });

  const { rawDir, error } = await capture(deps);

  expect(error).toBeUndefined();
  expect(await filesUnder(rawDir)).toEqual([
    "boxscores/week-01.json",
    "boxscores/week-02.json",
    "boxscores/week-03.json",
    "boxscores/week-04.json",
    "boxscores/week-05.json",
    "boxscores/week-06.json",
    "boxscores/week-07.json",
    "boxscores/week-08.json",
    "boxscores/week-09.json",
    "boxscores/week-10.json",
    "boxscores/week-11.json",
    "boxscores/week-12.json",
    "boxscores/week-13.json",
    "boxscores/week-14.json",
    "boxscores/week-15.json",
    "league.json",
    "rosters.json",
    "schedule.json",
    "transactions/week-01.json",
    "transactions/week-02.json",
    "transactions/week-03.json",
    "transactions/week-04.json",
    "transactions/week-05.json",
    "transactions/week-06.json",
    "transactions/week-07.json",
    "transactions/week-08.json",
    "transactions/week-09.json",
    "transactions/week-10.json",
    "transactions/week-11.json",
    "transactions/week-12.json",
    "transactions/week-13.json",
    "transactions/week-14.json",
    "transactions/week-15.json",
  ]);
  const raw = await readRaw(rawDir);
  expect(raw.league.members).toHaveLength(13);
  expect(raw.schedule.schedule).toHaveLength(96);
  expect(raw.rosters.teams).toHaveLength(12);
  const weeks = Array.from({ length: 15 }, (_, i) => i + 1);
  expect([...raw.boxscores.keys()]).toEqual(weeks);
  expect([...raw.transactions.keys()]).toEqual(weeks);
  for (const week of weeks) {
    expect(raw.boxscores.get(week)?.scoringPeriodId).toBe(week);
    expect(raw.transactions.get(week)?.scoringPeriodId).toBe(week);
  }
});

test("the scrub rebuilds the committed snapshots from a captured week", async () => {
  const { deps } = await replay();
  const { rawDir } = await capture(deps);

  const ids = await scrubEspnFixtures({
    rawDir,
    outDir: join(rawDir, "..", "out"),
    leagueId: HOT_TAKERY_ID,
    weeks: [1, 7, 15],
  });

  expect(ids).toEqual({
    1: "20250909T120000Z-d7aa61d2",
    7: "20251021T120000Z-8aa6e916",
    15: "20251216T120000Z-5243140d",
  });
});

test("the output is a count per file, with no league ID, name or cookie", async () => {
  const { deps } = await replay({ privateTo: COOKIE, stored: COOKIE });

  const { rawDir, lines } = await capture(deps);

  expect(lines).toContain("boxscores/week-07.json     6 matchups");
  expect(lines).toContain("league.json                12 teams");
  expect(lines).toContain("rosters.json               12 teams");
  expect(lines).toContain("schedule.json              96 matchups");
  expect(lines).toContain("transactions/week-07.json  35 transactions");
  expect(lines.at(-1)).toBe("Wrote 33 files.");
  const { league } = await readRaw(rawDir);
  const names = [
    HOT_TAKERY_ID,
    COOKIE,
    ...(league.teams as Json[]).flatMap((t) => [t.name, t.abbrev, t.id]),
    ...(league.members as Json[]).flatMap((m) => [
      m.displayName,
      m.firstName,
      m.lastName,
      m.id,
    ]),
  ]
    .filter((n) => n !== undefined && String(n).length > 2)
    .map(String);
  const output = lines.join("\n");
  for (const name of names) expect(output).not.toContain(name);
});

test("a credentials file others can read gets its warning once", async () => {
  const { deps } = await replay({ privateTo: COOKIE, stored: COOKIE });
  const path = join(deps.configDir, "credentials.yaml");
  await chmod(path, 0o644);

  const { lines } = await capture(deps);

  const warning = `${path} can be read by other users on this machine (mode 0644). Run: chmod 600 ${path}`;
  expect(lines.filter((l) => l === warning)).toHaveLength(1);
});

test("a request the capture can't map fails it, naming its views, and writes nothing", async () => {
  const { deps } = await replay();
  const base = espnLeagueUrl("2025", HOT_TAKERY_ID);

  const { rawDir, error } = await capture(deps, {
    fetch: async (opts) => {
      const fetched = await fetchEspn(opts);
      await opts.transport.request({
        url: espnViewUrl(base, ["mPendingTransactions", "mRoster"]),
        params: { scoringPeriodId: "3" },
      });
      return fetched;
    },
  });

  expect(error).toBeInstanceOf(CaptureError);
  expect((error as Error).message).toContain("mPendingTransactions+mRoster@3");
  expect(await filesUnder(rawDir)).toEqual([]);
});

test("a raw folder that already holds files is refused before any request", async () => {
  const { deps, asked } = await replay();
  const rawDir = await mkdtemp(join(tmpdir(), "capture-"));
  await writeFile(join(rawDir, "league.json"), "{}");

  const { error } = await capture(deps, { rawDir });

  expect(error).toBeInstanceOf(CaptureError);
  expect((error as Error).message).toMatch(/isn't empty/);
  expect(asked).toEqual([]);
  expect(await filesUnder(rawDir)).toEqual(["league.json"]);
});

test("a raw folder that's a file is refused before any request", async () => {
  const { deps, asked } = await replay();
  const rawDir = join(await mkdtemp(join(tmpdir(), "capture-")), "raw");
  await writeFile(rawDir, "{}");

  const { error } = await capture(deps, { rawDir });

  expect(error).toBeInstanceOf(CaptureError);
  expect((error as Error).message).toMatch(/^The raw folder can't be read/);
  expect(asked).toEqual([]);
});

test("an empty raw folder is captured into", async () => {
  const { deps } = await replay();
  const rawDir = await mkdtemp(join(tmpdir(), "capture-"));

  const { error } = await capture(deps, { rawDir });

  expect(error).toBeUndefined();
  expect(await filesUnder(rawDir)).toHaveLength(33);
});

test.each([
  {
    state: "a rejected stored cookie",
    creds: { stored: "AEB%2Fstale-cookie" },
    line: "ESPN cookie rejected (saved 2025-10-28). Copy a fresh espn_s2 from your browser, then run: lazy-pundit setup espn (or set LAZY_PUNDIT_ESPN_S2)",
    cookie: "AEB%2Fstale-cookie",
  },
  {
    state: "a rejected LAZY_PUNDIT_ESPN_S2",
    creds: { env: "AEB%2Fstale-env" },
    line: "ESPN cookie rejected (from LAZY_PUNDIT_ESPN_S2). Set LAZY_PUNDIT_ESPN_S2 to a fresh espn_s2 from your browser, or unset it to use the stored cookie.",
    cookie: "AEB%2Fstale-env",
  },
  {
    state: "no cookie on a private league",
    creds: {},
    line: "ESPN refused the league without a cookie: it's a private league. Run lazy-pundit setup espn in its workspace, or set LAZY_PUNDIT_ESPN_S2.",
    cookie: COOKIE,
  },
])("$state ends with the cookie's fix and writes nothing", async (c) => {
  const { deps, asked } = await replay({ privateTo: COOKIE, ...c.creds });

  const { rawDir, lines, error } = await capture(deps);

  expect(error).toBeInstanceOf(CaptureError);
  expect((error as Error).message).toBe(c.line);
  expect(asked).toEqual([
    espnViewUrl(espnLeagueUrl("2025", HOT_TAKERY_ID), ESPN_VIEWS.league),
  ]);
  expect([...lines, (error as Error).message].join("\n")).not.toContain(
    c.cookie,
  );
  expect(await filesUnder(rawDir)).toEqual([]);
});

test("a cookie check that can't reach ESPN ends with its fix and writes nothing", async () => {
  const base = await operator();
  const deps = hotTakeryAt(base, 15, { status: 503 });

  const { rawDir, error } = await capture(deps);

  expect((error as Error).message).toBe(
    "Couldn't check the cookie: GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/<league ID>?view=mSettings&view=mTeam&view=mStatus&view=mNav returned 503. Check your connection, then run it again.",
  );
  expect(await filesUnder(rawDir)).toEqual([]);
});

test("a league ESPN doesn't know ends without naming its ID", async () => {
  const base = await operator();
  const deps = hotTakeryAt(base, 15, { status: 404 });

  const { rawDir, lines, error } = await capture(deps);

  expect((error as Error).message).toBe(
    "ESPN has no such league in 2025: check the league ID.",
  );
  expect(lines).toEqual([]);
  expect(await filesUnder(rawDir)).toEqual([]);
});

test.each([
  {
    failure: "week 9's box scores answering 500",
    views: ESPN_VIEWS.boxscores,
    params: { scoringPeriodId: "9" },
    answer: { status: 500, body: new Uint8Array() },
    message:
      "GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/<league ID>?view=mMatchupScore&view=mScoreboard&scoringPeriodId=9 returned 500. Nothing was written: run it again.",
  },
  {
    failure: "a schedule this version can't read",
    views: ESPN_VIEWS.schedule,
    params: {},
    answer: { status: 200, body: new TextEncoder().encode("{}") },
    message:
      "ESPN league <league ID> sent a schedule this version can't read. Nothing was written: the fetcher needs updating for ESPN's answer before a capture.",
  },
])(
  "$failure after the cookie check writes nothing, and names no league ID",
  async (c) => {
    const { deps } = await replay();
    const url = espnViewUrl(espnLeagueUrl("2025", HOT_TAKERY_ID), c.views);

    const { rawDir, error } = await capture(
      failingOn(deps, url, { params: c.params, answer: c.answer }),
    );

    expect(error).toBeInstanceOf(CaptureError);
    expect((error as Error).message).toBe(c.message);
    expect(await filesUnder(rawDir)).toEqual([]);
  },
);
