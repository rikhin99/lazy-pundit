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

const SLEEPER = "https://api.sleeper.app/v1";
const fixedClock: Clock = { now: () => new Date("2025-10-28T12:00:00.000Z") };

/** A tiny Sleeper league: 2 teams, 2 scored weeks. */
function tinyLeague(): Map<string, unknown> {
  const L = `${SLEEPER}/league/42`;
  return new Map<string, unknown>([
    [
      L,
      {
        league_id: "42",
        name: "Tiny",
        season: "2025",
        settings: { leg: 2, last_scored_leg: 2, playoff_week_start: 15 },
      },
    ],
    [`${L}/users`, [{ user_id: "u1", display_name: "One" }]],
    [`${L}/rosters`, [{ roster_id: 1, owner_id: "u1" }]],
    [`${L}/winners_bracket`, []],
    [`${L}/losers_bracket`, []],
    [`${L}/matchups/1`, [{ roster_id: 1, matchup_id: 1, points: 100 }]],
    [`${L}/matchups/2`, [{ roster_id: 1, matchup_id: 1, points: 90.5 }]],
    [`${L}/transactions/1`, []],
    [`${L}/transactions/2`, []],
  ]);
}

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
      leagueId: "42",
    });

    const second = await tempDir();
    const replayed = await fetchSleeperSnapshot({
      transport: fileTransport(first, original.id),
      clock: fixedClock,
      snapshotsDir: second,
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
