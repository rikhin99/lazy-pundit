import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test, vi } from "vitest";
import {
  type Clock,
  FetchError,
  fetchSleeperSnapshot,
  fileTransport,
  PLATFORM_WAIT_MS,
  type Transport,
  type TransportRequest,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import {
  FEAR_THE_TURTLE_ID,
  FIXTURES,
  type Json,
  type Patch,
  patchingTransport,
  silentOn,
  statCorrection,
  WEEKS,
} from "./support/workspace.ts";

const SLEEPER = SLEEPER_API;
const fixedClock: Clock = { now: () => new Date("2025-10-28T12:00:00.000Z") };

const PLAYERS_URL = `${SLEEPER}/players/nfl`;
const LEAGUE = `${SLEEPER}/league/${FEAR_THE_TURTLE_ID}`;
const WEEK_8 = WEEKS["8"] ?? "";

/** A player id that no team in the league has rostered. */
const UNROSTERED = "99999999";

/** A players file patch that adds a player under `id`. */
const withPlayer = (id: string) => (players: Json) => {
  players[id] = { player_id: id, position: "K", fantasy_positions: ["K"] };
};

/**
 * Replays the committed week-8 snapshot with `patches`, answers 500 to the
 * `failOn` URL, and records every request it receives.
 */
function replay(
  patches: Record<string, Patch> = {},
  failOn?: string,
): Transport & { requests: TransportRequest[] } {
  const inner = patchingTransport(fileTransport(FIXTURES, WEEK_8), patches);
  const requests: TransportRequest[] = [];
  return {
    requests,
    async request(req) {
      requests.push(req);
      if (req.url === failOn) return { status: 500, body: new Uint8Array() };
      return inner.request(req);
    },
  };
}

/** A blob of a snapshot folder, unzipped. */
async function rawBlob(dir: string, sha256: string): Promise<Buffer> {
  return gunzipSync(await readFile(join(dir, "blobs", `${sha256}.json.gz`)));
}

/** A blob of a snapshot folder, parsed. */
async function blob(dir: string, sha256: string): Promise<Json> {
  return JSON.parse((await rawBlob(dir, sha256)).toString("utf8"));
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "lazy-pundit-"));
}

describe("fetchSleeperSnapshot", () => {
  test("writes a complete snapshot: manifest plus gzip blobs named by SHA-256", async () => {
    const dir = await tempDir();
    // The players file as Sleeper serves it names players nobody rostered.
    const { id } = await fetchSleeperSnapshot({
      transport: replay({ [PLAYERS_URL]: withPlayer(UNROSTERED) }),
      clock: fixedClock,
      snapshotsDir: dir,
      cacheDir: await tempDir(),
      leagueId: FEAR_THE_TURTLE_ID,
    });

    expect(id).toMatch(/^20251028T120000Z-[0-9a-f]{8}$/);
    const manifest = JSON.parse(
      await readFile(join(dir, id, "manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      platform: "sleeper",
      league_id: FEAR_THE_TURTLE_ID,
      season: "2025",
      fetched_at: "2025-10-28T12:00:00.000Z",
    });
    const committed = JSON.parse(
      await readFile(join(FIXTURES, WEEK_8, "manifest.json"), "utf8"),
    );
    const urls = (m: { requests: { url: string }[] }) =>
      m.requests.map((r) => r.url).sort();
    expect(urls(manifest)).toEqual(urls(committed));

    // Each blob is the payload served, and the players file drops the
    // player nobody rostered.
    for (const r of manifest.requests) {
      const raw = await rawBlob(dir, r.sha256);
      expect(createHash("sha256").update(raw).digest("hex")).toBe(r.sha256);
      const served = committed.requests.find(
        (q: { url: string }) => q.url === r.url,
      );
      expect(JSON.parse(raw.toString("utf8"))).toEqual(
        await blob(FIXTURES, served.sha256),
      );
    }
    const players = manifest.requests.find(
      (r: { url: string }) => r.url === PLAYERS_URL,
    );
    expect(await blob(dir, players.sha256)).not.toHaveProperty(UNROSTERED);
  });

  test("the manifest holds no cookies or headers", async () => {
    const dir = await tempDir();
    const { id } = await fetchSleeperSnapshot({
      transport: replay(),
      clock: fixedClock,
      snapshotsDir: dir,
      cacheDir: await tempDir(),
      leagueId: FEAR_THE_TURTLE_ID,
      headers: { cookie: "espn_s2=secret-cookie" },
    });
    const text = await readFile(join(dir, id, "manifest.json"), "utf8");
    expect(text).not.toMatch(/secret-cookie|cookie|header/i);
  });

  test("a fetch where one request fails leaves no snapshot behind", async () => {
    const dir = await tempDir();
    await expect(
      fetchSleeperSnapshot({
        transport: replay({}, `${LEAGUE}/matchups/2`),
        clock: fixedClock,
        snapshotsDir: dir,
        cacheDir: await tempDir(),
        leagueId: FEAR_THE_TURTLE_ID,
      }),
    ).rejects.toThrow(/matchups\/2.*500/);
    expect(await readdir(dir)).toEqual([]);
  });

  test("a request that never gets an answer fails the fetch after 30 seconds, with the request aborted", async () => {
    const dir = await tempDir();
    const { transport, asked } = silentOn(replay(), `${LEAGUE}/matchups/2`);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const fetched = fetchSleeperSnapshot({
        transport,
        clock: fixedClock,
        snapshotsDir: dir,
        cacheDir: await tempDir(),
        leagueId: FEAR_THE_TURTLE_ID,
      });
      fetched.catch(() => {});
      const signal = await asked();
      await vi.advanceTimersByTimeAsync(PLATFORM_WAIT_MS - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(fetched).rejects.toThrow(FetchError);
      await expect(fetched).rejects.toThrow(
        `GET ${LEAGUE}/matchups/2 got no answer in 30 seconds`,
      );
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(await readdir(dir)).toEqual([]);
  });

  test("a refetch through the file transport produces an identical snapshot", async () => {
    const first = await tempDir();
    const original = await fetchSleeperSnapshot({
      transport: replay(),
      clock: fixedClock,
      snapshotsDir: first,
      cacheDir: await tempDir(),
      leagueId: FEAR_THE_TURTLE_ID,
    });

    const second = await tempDir();
    const replayed = await fetchSleeperSnapshot({
      transport: fileTransport(first, original.id),
      clock: fixedClock,
      snapshotsDir: second,
      cacheDir: await tempDir(),
      leagueId: FEAR_THE_TURTLE_ID,
    });

    expect(replayed.id).toBe(original.id);
    expect(
      await readFile(join(second, replayed.id, "manifest.json"), "utf8"),
    ).toBe(await readFile(join(first, original.id, "manifest.json"), "utf8"));
    expect((await readdir(join(second, "blobs"))).sort()).toEqual(
      (await readdir(join(first, "blobs"))).sort(),
    );
  });
});

describe("Sleeper's players file", () => {
  const at = (iso: string): Clock => ({ now: () => new Date(iso) });

  /** Fetches the week-8 replay at `iso` and says how often the players file was requested. */
  async function fetchAt(
    iso: string,
    cacheDir: string,
    patches: Record<string, Patch> = {},
  ): Promise<number> {
    const transport = replay(patches);
    await fetchSleeperSnapshot({
      transport,
      clock: at(iso),
      snapshotsDir: await tempDir(),
      cacheDir,
      leagueId: FEAR_THE_TURTLE_ID,
    });
    return transport.requests.filter((r) => r.url === PLAYERS_URL).length;
  }

  test("is fetched once, then read from the cache for 7 days", async () => {
    const cache = await tempDir();
    expect(await fetchAt("2025-10-28T12:00:00.000Z", cache)).toBe(1);
    expect(await fetchAt("2025-10-30T12:00:00.000Z", cache)).toBe(0);
    expect(await fetchAt("2025-11-04T11:59:59.000Z", cache)).toBe(0);
  });

  test("is refetched once the cached copy is more than 7 days old", async () => {
    const cache = await tempDir();
    await fetchAt("2025-10-28T12:00:00.000Z", cache);
    expect(await fetchAt("2025-11-04T12:00:01.000Z", cache)).toBe(1);
    // The refetch restarts the 7 days.
    expect(await fetchAt("2025-11-05T12:00:00.000Z", cache)).toBe(0);
  });

  test("is refetched when a matchup names a player the cache doesn't have", async () => {
    const cache = await tempDir();
    await fetchAt("2025-10-28T12:00:00.000Z", cache);

    // A player the cached file doesn't have joins team 1's week-2 lineup.
    const patches = {
      [`${LEAGUE}/matchups/2`]: (payload: Json) => {
        payload.find((side: Json) => side.roster_id === 1).players.push("11");
      },
      [PLAYERS_URL]: withPlayer("11"),
    };
    expect(await fetchAt("2025-10-29T12:00:00.000Z", cache, patches)).toBe(1);
    expect(await fetchAt("2025-10-30T12:00:00.000Z", cache, patches)).toBe(0);
  });
});

describe("the fetch window", () => {
  const L = LEAGUE;
  const at = (iso: string): Clock => ({ now: () => new Date(iso) });

  /**
   * The committed week-10 replay as Sleeper showed it earlier in the season:
   * `leg` the current week and weeks through `scored` scored. `bump` is a
   * stat correction to week 1 for roster 1.
   */
  function season(
    scored: number,
    leg: number,
    opts: { season?: string; bump?: number } = {},
  ): Transport {
    return patchingTransport(fileTransport(FIXTURES, WEEKS["10"] ?? ""), {
      [L]: (league) => {
        league.settings.leg = leg;
        league.settings.last_scored_leg = scored;
        if (opts.season) league.season = opts.season;
      },
      ...(opts.bump && { [`${L}/matchups/1`]: statCorrection(1, opts.bump) }),
    });
  }

  /** Roster 1's points in a matchups payload. */
  const roster1 = (payload: Json) =>
    payload.find((side: Json) => side.roster_id === 1).points;

  /** Fetches into `dir` and lists the weeks whose matchups were requested. */
  async function fetchWeeks(
    dir: string,
    iso: string,
    inner: Transport,
    opts: { full?: boolean } = {},
  ) {
    const requested: string[] = [];
    const written = await fetchSleeperSnapshot({
      transport: {
        request: (req) => {
          requested.push(req.url);
          return inner.request(req);
        },
      },
      clock: at(iso),
      snapshotsDir: dir,
      cacheDir: await tempDir(),
      leagueId: FEAR_THE_TURTLE_ID,
      ...opts,
    });
    /** The week each request for a `kind` payload named, in order. */
    const weeks = (kind: string) =>
      requested
        .map((url) => url.match(new RegExp(`/${kind}/(\\d+)$`))?.[1])
        .filter((week) => week !== undefined)
        .map(Number)
        .sort((a, b) => a - b);
    const manifest = JSON.parse(
      await readFile(join(dir, written.id, "manifest.json"), "utf8"),
    );
    return {
      matchups: weeks("matchups"),
      transactions: weeks("transactions"),
      manifest,
      payload: async (url: string) => {
        const r = manifest.requests.find((q: { url: string }) => q.url === url);
        return JSON.parse(
          gunzipSync(
            await readFile(join(dir, "blobs", `${r.sha256}.json.gz`)),
          ).toString("utf8"),
        );
      },
    };
  }

  test("the first fetch asks for every week", async () => {
    const dir = await tempDir();
    const first = await fetchWeeks(
      dir,
      "2025-10-07T12:00:00.000Z",
      season(4, 5),
    );
    expect(first.matchups).toEqual([1, 2, 3, 4, 5]);
    expect(first.transactions).toEqual([1, 2, 3, 4, 5]);
  });

  test("a routine fetch asks for the last 2 scored weeks and the in-progress week, and keeps the rest from the last snapshot", async () => {
    const dir = await tempDir();
    const first = await fetchWeeks(
      dir,
      "2025-10-07T12:00:00.000Z",
      season(4, 5),
    );
    // A correction to week 1 that the routine fetch doesn't ask about.
    const later = await fetchWeeks(
      dir,
      "2025-10-14T12:00:00.000Z",
      season(5, 6, { bump: 5 }),
    );

    expect(later.matchups).toEqual([4, 5, 6]);
    expect(later.transactions).toEqual([4, 5, 6]);
    // The snapshot still holds every week, the older ones as last fetched.
    expect(
      later.manifest.requests
        .map((r: { url: string }) => r.url)
        .filter((u: string) => u.includes("/matchups/")).length,
    ).toBe(6);
    expect(roster1(await later.payload(`${L}/matchups/1`))).toBe(
      roster1(await first.payload(`${L}/matchups/1`)),
    );
  });

  test("`full` asks for every week", async () => {
    const dir = await tempDir();
    const first = await fetchWeeks(
      dir,
      "2025-10-07T12:00:00.000Z",
      season(4, 5),
    );
    const full = await fetchWeeks(
      dir,
      "2025-10-14T12:00:00.000Z",
      season(5, 6, { bump: 5 }),
      { full: true },
    );
    expect(full.matchups).toEqual([1, 2, 3, 4, 5, 6]);
    expect(roster1(await full.payload(`${L}/matchups/1`))).toBeCloseTo(
      roster1(await first.payload(`${L}/matchups/1`)) + 5,
    );
  });

  test("a fetch more than 2 weeks after the last snapshot asks for every week", async () => {
    const dir = await tempDir();
    await fetchWeeks(dir, "2025-10-07T12:00:00.000Z", season(4, 5));
    const within = await fetchWeeks(
      dir,
      "2025-10-21T12:00:00.000Z",
      season(5, 6),
    );
    expect(within.matchups).toEqual([4, 5, 6]);
    const after = await fetchWeeks(
      dir,
      "2025-11-04T12:00:00.001Z",
      season(6, 7),
    );
    expect(after.matchups).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("a week the last snapshot didn't hold as scored is asked for again", async () => {
    const dir = await tempDir();
    await fetchWeeks(dir, "2025-10-07T12:00:00.000Z", season(2, 3));
    const later = await fetchWeeks(
      dir,
      "2025-10-14T12:00:00.000Z",
      season(5, 6),
    );
    expect(later.matchups).toEqual([3, 4, 5, 6]);
  });

  test("another season's snapshot is never reused", async () => {
    const dir = await tempDir();
    await fetchWeeks(
      dir,
      "2025-10-07T12:00:00.000Z",
      season(4, 5, { season: "2024" }),
    );
    const later = await fetchWeeks(
      dir,
      "2025-10-14T12:00:00.000Z",
      season(5, 6),
    );
    expect(later.matchups).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("the snapshot folder's .gitignore", () => {
  test("is written as `*` when a fetch creates the folder", async () => {
    const dir = join(await tempDir(), ".snapshots");
    await fetchSleeperSnapshot({
      transport: replay(),
      clock: fixedClock,
      snapshotsDir: dir,
      cacheDir: await tempDir(),
      leagueId: FEAR_THE_TURTLE_ID,
    });
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe("*\n");
  });
});
