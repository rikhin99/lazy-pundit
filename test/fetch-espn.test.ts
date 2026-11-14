import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FAMILY_LEAGUE_ID, HOT_TAKERY_ID } from "../scripts/scrub-espn.ts";
import { ESPN_VIEWS, espnLeagueUrl, espnViewUrl } from "../src/espn/api.ts";
import {
  type Clock,
  FetchError,
  fetchEspn,
  fetchEspnSnapshot,
  fileTransport,
  readManifest,
  type Transport,
  type TransportRequest,
} from "../src/index.ts";
import { type Patch, patchingTransport } from "./support/workspace.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "espn");

/** The committed sets: Hot Takery 2025, and The Family League 2025 with its week-15 byes. */
const SETS = {
  hotTakery: { dir: join(FIXTURES, "hot-takery-2025"), id: HOT_TAKERY_ID },
  family: { dir: join(FIXTURES, "family-league-2025"), id: FAMILY_LEAGUE_ID },
};
type SetName = keyof typeof SETS;
const urls = (set: SetName) => {
  const base = espnLeagueUrl("2025", SETS[set].id);
  return {
    league: espnViewUrl(base, ESPN_VIEWS.league),
    schedule: espnViewUrl(base, ESPN_VIEWS.schedule),
  };
};
const LEAGUE_URL = urls("hotTakery").league;
const STORED = {
  value: "AEB%2Bcookie",
  from: "file",
  savedAt: "2026-01-02",
} as const;

/**
 * Replays a set's committed snapshot for `week` (Hot Takery's unless `set`
 * says), recording every request. `status` answers the league request with
 * that status and no payload; `league` and `schedule` patch those payloads.
 */
function replay(
  week: number,
  opts: {
    set?: SetName;
    status?: number;
    league?: Patch;
    schedule?: Patch;
  } = {},
): Transport & { requests: TransportRequest[] } {
  const set = opts.set ?? "hotTakery";
  const weeks = JSON.parse(
    readFileSync(join(SETS[set].dir, "weeks.json"), "utf8"),
  );
  const url = urls(set);
  const patches: Record<string, Patch> = {};
  if (opts.league) patches[url.league] = opts.league;
  if (opts.schedule) patches[url.schedule] = opts.schedule;
  const inner = patchingTransport(
    fileTransport(SETS[set].dir, weeks[String(week)] ?? ""),
    patches,
  );
  const requests: TransportRequest[] = [];
  return {
    requests,
    async request(req) {
      requests.push(req);
      if (req.url === url.league && opts.status !== undefined) {
        return { status: opts.status, body: new Uint8Array() };
      }
      return inner.request(req);
    },
  };
}

/** The snapshot folders in `dir`, skipping the shared blobs and the `.gitignore`. */
async function snapshotIds(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter(
    (f) => f !== "blobs" && !f.startsWith("."),
  );
}

const at = (iso: string): Clock => ({ now: () => new Date(iso) });

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "lazy-pundit-espn-"));
}

/** The fetch's error, which the test expects it to throw. */
async function failure(promise: Promise<unknown>): Promise<FetchError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(FetchError);
  return err as FetchError;
}

const options = (transport: Transport, dir: string) => ({
  transport,
  clock: at("2025-10-28T12:00:00.000Z"),
  snapshotsDir: dir,
  leagueId: HOT_TAKERY_ID,
  season: "2025",
});

describe("fetching an ESPN league season", () => {
  test("asks for the league, schedule, rosters, transactions and each week's box scores", async () => {
    const transport = replay(8);
    const { snapshot } = await fetchEspn(options(transport, await tempDir()));
    const views = transport.requests.map((r) =>
      [
        new URL(r.url).searchParams.getAll("view").join("+"),
        r.params?.scoringPeriodId,
      ]
        .filter(Boolean)
        .join(" "),
    );
    expect(views.slice(0, 2)).toEqual([
      "mSettings+mTeam+mStatus+mNav",
      "mMatchup",
    ]);
    expect(views.slice(2).sort()).toEqual(
      [
        "mRoster",
        "mTransactions2",
        ...[1, 2, 3, 4, 5, 6, 7, 8].map(
          (w) => `mMatchupScore+mScoreboard ${w}`,
        ),
      ].sort(),
    );
    expect(snapshot.manifest).toMatchObject({
      platform: "espn",
      league_id: HOT_TAKERY_ID,
      season: "2025",
    });
  });

  test("sends the cookie with every request, and records it nowhere", async () => {
    const transport = replay(8);
    const dir = await tempDir();
    const { id } = await fetchEspnSnapshot({
      ...options(transport, dir),
      cookie: STORED,
    });
    expect(
      transport.requests.every(
        (r) => r.headers?.Cookie === "espn_s2=AEB%2Bcookie",
      ),
    ).toBe(true);
    const manifest = await readFile(join(dir, id, "manifest.json"), "utf8");
    expect(manifest).not.toContain("cookie");
    expect(manifest).not.toContain("espn_s2");
  });

  test("a rejected stored cookie (401) stops with its saved date and the setup espn fix, writing nothing", async () => {
    const dir = await tempDir();
    const err = await failure(
      fetchEspnSnapshot({
        ...options(replay(8, { status: 401 }), dir),
        cookie: STORED,
      }),
    );
    expect(err.message).toBe("ESPN cookie rejected (saved 2026-01-02)");
    expect(err.fix).toBe("setup_espn");
    expect(await snapshotIds(dir)).toEqual([]);
  });

  test("a rejected cookie from the environment (401) names the variable, whose fix is the variable's, since it overrides a stored one", async () => {
    const err = await failure(
      fetchEspn({
        ...options(replay(8, { status: 401 }), await tempDir()),
        cookie: { value: "x", from: "env" },
      }),
    );
    expect(err.message).toBe("ESPN cookie rejected (from LAZY_PUNDIT_ESPN_S2)");
    expect(err.fix).toBe("espn_env");
  });

  test("a private league with no cookie (401) says one is needed", async () => {
    const err = await failure(
      fetchEspn(options(replay(8, { status: 401 }), await tempDir())),
    );
    expect(err.message).toBe(
      "ESPN refused league 900000001 without a cookie: it's a private league",
    );
    expect(err.fix).toBe("setup_espn");
  });

  test("a league ESPN doesn't know (404) stops with the league_id fix", async () => {
    const err = await failure(
      fetchEspn({
        ...options(replay(8, { status: 404 }), await tempDir()),
        cookie: STORED,
      }),
    );
    expect(err.message).toBe("ESPN has no league 900000001 in 2025");
    expect(err.fix).toBe("league_id");
  });

  test("another failing status stops with the refresh fix", async () => {
    const err = await failure(
      fetchEspn(options(replay(8, { status: 503 }), await tempDir())),
    );
    expect(err.message).toBe(`GET ${LEAGUE_URL} returned 503`);
    expect(err.fix).toBe("refresh");
  });

  test("a league payload this version can't read stops with the update fix", async () => {
    const err = await failure(
      fetchEspn(
        options(
          replay(8, { league: { replaceWith: { messages: ["changed"] } } }),
          await tempDir(),
        ),
      ),
    );
    expect(err.message).toBe("ESPN league 900000001 is not a league payload");
    expect(err.fix).toBe("update");
  });
});

describe("which weeks an ESPN fetch asks for", () => {
  /** Fetches the committed `week` into `dir` at `iso`, returning the box-score weeks asked for. */
  async function boxScoreWeeks(
    dir: string,
    week: number,
    iso: string,
    opts: Parameters<typeof replay>[1] & { full?: boolean } = {},
  ): Promise<number[]> {
    const { full = false, ...replayOpts } = opts;
    const transport = replay(week, replayOpts);
    await fetchEspnSnapshot({
      ...options(transport, dir),
      leagueId: SETS[opts.set ?? "hotTakery"].id,
      clock: at(iso),
      full,
    });
    return transport.requests
      .map((r) => Number(r.params?.scoringPeriodId))
      .filter((w) => w > 0)
      .sort((a, b) => a - b);
  }

  test("the first fetch asks for every week", async () => {
    expect(
      await boxScoreWeeks(await tempDir(), 7, "2025-10-21T12:00:00.000Z"),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("a routine fetch asks for the last 2 scored weeks and keeps the rest from the last snapshot", async () => {
    const dir = await tempDir();
    await boxScoreWeeks(dir, 7, "2025-10-21T12:00:00.000Z");
    expect(await boxScoreWeeks(dir, 8, "2025-10-28T12:00:00.000Z")).toEqual([
      7, 8,
    ]);
    // The snapshot still holds every week.
    const latest = (await snapshotIds(dir)).sort().at(-1) ?? "";
    const manifest = await readManifest(dir, latest);
    expect(
      manifest.requests.filter((r) => r.params.scoringPeriodId),
    ).toHaveLength(8);
  });

  test("`full` asks for every week", async () => {
    const dir = await tempDir();
    await boxScoreWeeks(dir, 7, "2025-10-21T12:00:00.000Z");
    expect(
      await boxScoreWeeks(dir, 8, "2025-10-28T12:00:00.000Z", { full: true }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("a fetch more than 2 weeks after the last snapshot asks for every week", async () => {
    const dir = await tempDir();
    await boxScoreWeeks(dir, 7, "2025-10-21T12:00:00.000Z");
    expect(await boxScoreWeeks(dir, 8, "2025-11-04T12:00:00.001Z")).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  test("a week the last snapshot didn't hold is asked for", async () => {
    const dir = await tempDir();
    await boxScoreWeeks(dir, 7, "2025-10-21T12:00:00.000Z");
    expect(await boxScoreWeeks(dir, 10, "2025-10-28T12:00:00.000Z")).toEqual([
      8, 9, 10,
    ]);
  });

  test("a week the last snapshot held but not as scored is asked for again", async () => {
    const dir = await tempDir();
    // Week 6 still had no winners when the last snapshot was fetched.
    await boxScoreWeeks(dir, 7, "2025-10-21T12:00:00.000Z", {
      schedule: (p) => {
        for (const m of p.schedule) {
          if (m.matchupPeriodId === 6) m.winner = "UNDECIDED";
        }
      },
    });
    expect(await boxScoreWeeks(dir, 8, "2025-10-28T12:00:00.000Z")).toEqual([
      6, 7, 8,
    ]);
  });

  test("a bye, home only with no winner, doesn't keep its week from counting as scored", async () => {
    const dir = await tempDir();
    await boxScoreWeeks(dir, 14, "2025-12-09T12:00:00.000Z", { set: "family" });
    expect(
      await boxScoreWeeks(dir, 15, "2025-12-16T12:00:00.000Z", {
        set: "family",
      }),
    ).toEqual([14, 15]);
  });

  test("another season's snapshot is never reused", async () => {
    const dir = await tempDir();
    await boxScoreWeeks(dir, 7, "2025-10-21T12:00:00.000Z", {
      league: (p) => {
        p.seasonId = 2024;
      },
    });
    expect(await boxScoreWeeks(dir, 8, "2025-10-28T12:00:00.000Z")).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
});
