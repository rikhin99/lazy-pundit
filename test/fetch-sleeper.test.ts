import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  type Clock,
  fetchSleeperSnapshot,
  fileTransport,
  type Transport,
  type TransportRequest,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";

const SLEEPER = SLEEPER_API;
const fixedClock: Clock = { now: () => new Date("2025-10-28T12:00:00.000Z") };

/** A tiny Sleeper league: 2 teams (one with no manager), 2 scored weeks. */
function tinyLeague(): Map<string, unknown> {
  const L = `${SLEEPER}/league/42`;
  return new Map<string, unknown>([
    [
      L,
      {
        league_id: "42",
        name: "Tiny",
        season: "2025",
        settings: {
          leg: 2,
          last_scored_leg: 2,
          playoff_teams: 2,
          playoff_week_start: 15,
        },
      },
    ],
    [`${L}/users`, [{ user_id: "u1", display_name: "One" }]],
    [
      `${L}/rosters`,
      [
        { roster_id: 1, owner_id: "u1", settings: {} },
        { roster_id: 2, owner_id: null, settings: {} },
      ],
    ],
    [`${L}/winners_bracket`, []],
    [`${L}/losers_bracket`, []],
    [
      `${L}/matchups/1`,
      [
        { roster_id: 1, matchup_id: 1, points: 100, players: ["4984", "0"] },
        { roster_id: 2, matchup_id: 1, points: 80 },
      ],
    ],
    [
      `${L}/matchups/2`,
      [
        { roster_id: 1, matchup_id: 1, points: 90.5, players: ["4984"] },
        { roster_id: 2, matchup_id: 1, points: 95 },
      ],
    ],
    [`${L}/transactions/1`, []],
    [
      `${L}/transactions/2`,
      [
        {
          transaction_id: "7",
          type: "free_agent",
          status: "complete",
          leg: 2,
          status_updated: 1760000000000,
          roster_ids: [1],
          adds: { "6130": 1 },
          drops: null,
        },
      ],
    ],
    [`${SLEEPER}/players/nfl`, PLAYERS],
  ]);
}

/** Part of Sleeper's players file: two rostered players and one nobody has. */
const PLAYERS = {
  "4984": { player_id: "4984", position: "QB", fantasy_positions: ["QB"] },
  "6130": { player_id: "6130", position: "WR", fantasy_positions: ["WR"] },
  "9999": { player_id: "9999", position: "K", fantasy_positions: ["K"] },
};

/** Serves JSON from a map and records every request it receives. */
function recordingTransport(
  routes: Map<string, unknown>,
  failOn?: string,
): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  return {
    requests,
    async request(req) {
      requests.push(req);
      const body = routes.get(req.url);
      if (req.url === failOn || body === undefined) {
        return { status: 500, body: new Uint8Array() };
      }
      return {
        status: 200,
        body: new TextEncoder().encode(JSON.stringify(body)),
      };
    },
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "lazy-pundit-"));
}

describe("fetchSleeperSnapshot", () => {
  test("writes a complete snapshot: manifest plus gzip blobs named by SHA-256", async () => {
    const dir = await tempDir();
    const routes = tinyLeague();
    const { id } = await fetchSleeperSnapshot({
      transport: recordingTransport(routes),
      clock: fixedClock,
      snapshotsDir: dir,
      cacheDir: await tempDir(),
      leagueId: "42",
    });

    expect(id).toMatch(/^20251028T120000Z-[0-9a-f]{8}$/);
    const manifest = JSON.parse(
      await readFile(join(dir, id, "manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      platform: "sleeper",
      league_id: "42",
      season: "2025",
      fetched_at: "2025-10-28T12:00:00.000Z",
    });
    expect(manifest.requests.map((r: { url: string }) => r.url).sort()).toEqual(
      [...routes.keys()].sort(),
    );

    // The players file keeps only the players the league names.
    const { "9999": _unrostered, ...rostered } = PLAYERS;
    routes.set(`${SLEEPER}/players/nfl`, rostered);
    for (const r of manifest.requests) {
      const raw = gunzipSync(
        await readFile(join(dir, "blobs", `${r.sha256}.json.gz`)),
      );
      expect(createHash("sha256").update(raw).digest("hex")).toBe(r.sha256);
      expect(JSON.parse(raw.toString("utf8"))).toEqual(routes.get(r.url));
    }
  });

  test("the manifest holds no cookies or headers", async () => {
    const dir = await tempDir();
    const { id } = await fetchSleeperSnapshot({
      transport: recordingTransport(tinyLeague()),
      clock: fixedClock,
      snapshotsDir: dir,
      cacheDir: await tempDir(),
      leagueId: "42",
      headers: { cookie: "espn_s2=secret-cookie" },
    });
    const text = await readFile(join(dir, id, "manifest.json"), "utf8");
    expect(text).not.toMatch(/secret-cookie|cookie|header/i);
  });

  test("a fetch where one request fails leaves no snapshot behind", async () => {
    const dir = await tempDir();
    await expect(
      fetchSleeperSnapshot({
        transport: recordingTransport(
          tinyLeague(),
          `${SLEEPER}/league/42/matchups/2`,
        ),
        clock: fixedClock,
        snapshotsDir: dir,
        cacheDir: await tempDir(),
        leagueId: "42",
      }),
    ).rejects.toThrow(/matchups\/2.*500/);
    expect(await readdir(dir)).toEqual([]);
  });

  test("a refetch through the file transport produces an identical snapshot", async () => {
    const first = await tempDir();
    const original = await fetchSleeperSnapshot({
      transport: recordingTransport(tinyLeague()),
      clock: fixedClock,
      snapshotsDir: first,
      cacheDir: await tempDir(),
      leagueId: "42",
    });

    const second = await tempDir();
    const replayed = await fetchSleeperSnapshot({
      transport: fileTransport(first, original.id),
      clock: fixedClock,
      snapshotsDir: second,
      cacheDir: await tempDir(),
      leagueId: "42",
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
  const PLAYERS_URL = `${SLEEPER}/players/nfl`;
  const at = (iso: string): Clock => ({ now: () => new Date(iso) });

  /** Fetches the tiny league at `iso` and says how often the players file was requested. */
  async function fetchAt(
    iso: string,
    cacheDir: string,
    routes = tinyLeague(),
  ): Promise<number> {
    const transport = recordingTransport(routes);
    await fetchSleeperSnapshot({
      transport,
      clock: at(iso),
      snapshotsDir: await tempDir(),
      cacheDir,
      leagueId: "42",
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

    const routes = tinyLeague();
    routes.set(`${SLEEPER}/league/42/matchups/2`, [
      { roster_id: 1, matchup_id: 1, points: 90.5, players: ["4984", "11"] },
      { roster_id: 2, matchup_id: 1, points: 95 },
    ]);
    routes.set(PLAYERS_URL, {
      ...PLAYERS,
      "11": { player_id: "11", position: "TE", fantasy_positions: ["TE"] },
    });
    expect(await fetchAt("2025-10-29T12:00:00.000Z", cache, routes)).toBe(1);
    expect(await fetchAt("2025-10-30T12:00:00.000Z", cache, routes)).toBe(0);
  });
});
