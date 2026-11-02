import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { scrubSleeperFixtures } from "../scripts/scrub-sleeper.ts";
import {
  type Clock,
  fetchSleeperSnapshot,
  fileTransport,
  readBlob,
  readManifest,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "fixtures", "sleeper", "fear-the-turtle-2025");
const RAW = join(ROOT, "fixtures", "raw", "sleeper", "fear-the-turtle-2025");
const DENYLIST = join(ROOT, "fixtures", "denylist.txt");
const hasRaw = existsSync(RAW);

/** Week → snapshot ID of the committed set. */
async function committedWeeks(): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(FIXTURES, "weeks.json"), "utf8"));
}

/** A payload from one week's snapshot; `path` is relative to the league URL. */
async function payload(week: string, path = ""): Promise<unknown> {
  const id = (await committedWeeks())[week] as string;
  const manifest = await readManifest(FIXTURES, id);
  const url = `${SLEEPER_API}/league/${manifest.league_id}${path}`;
  const request = manifest.requests.find((r) => r.url === url);
  if (!request) throw new Error(`no ${path} in week ${week}`);
  return JSON.parse(
    new TextDecoder().decode(await readBlob(FIXTURES, request.sha256)),
  );
}

/** Every committed payload and manifest, as text. */
async function committedText(): Promise<string[]> {
  const texts: string[] = [];
  for (const id of Object.values(await committedWeeks())) {
    const manifest = await readManifest(FIXTURES, id);
    texts.push(JSON.stringify(manifest));
    for (const r of manifest.requests) {
      texts.push(new TextDecoder().decode(await readBlob(FIXTURES, r.sha256)));
    }
  }
  return texts;
}

describe("committed Sleeper fixtures (Fear The Turtle 2025)", () => {
  test("hold a snapshot for each eval week and the week before it", async () => {
    expect(Object.keys(await committedWeeks())).toEqual([
      "1",
      "7",
      "8",
      "9",
      "10",
      "14",
      "15",
    ]);
  });

  test("each snapshot is as of its week: scored through that week, standings to match", async () => {
    const week10 = (await payload("10")) as {
      settings: { last_scored_leg: number };
      metadata: Record<string, unknown>;
    };
    expect(week10.settings.last_scored_leg).toBe(10);

    // Independent literals: team sleeper:3 was 9-1 after week 10 and finished 10-4.
    const rosters10 = (await payload("10", "/rosters")) as {
      roster_id: number;
      settings: { wins: number; losses: number };
    }[];
    expect(rosters10.find((r) => r.roster_id === 3)?.settings).toMatchObject({
      wins: 9,
      losses: 1,
    });
    // The champion isn't known mid-season.
    expect(week10.metadata).toMatchObject({
      latest_league_winner_roster_id: null,
    });
    // After the regular season the bracket is seeded, with no results yet.
    type Game = { r: number; m: number; t1?: number; t2?: number; w?: number };
    expect(await payload("9", "/winners_bracket")).toEqual([]);
    const seeded = (await payload("14", "/winners_bracket")) as Game[];
    expect(seeded.find((g) => g.m === 1)).toMatchObject({ r: 1, t1: 5, t2: 7 });
    expect(seeded.some((g) => g.w !== undefined)).toBe(false);
    const afterRound1 = (await payload("15", "/winners_bracket")) as Game[];
    expect(afterRound1.find((g) => g.m === 1)).toMatchObject({ w: 7 });
    expect(afterRound1.find((g) => g.m === 3)).toMatchObject({ t1: 3, t2: 7 });
    expect(afterRound1.find((g) => g.m === 3)?.w).toBeUndefined();

    const rosters15 = (await payload("15", "/rosters")) as typeof rosters10;
    expect(rosters15.find((r) => r.roster_id === 3)?.settings).toMatchObject({
      wins: 10,
      losses: 4,
    });
  });

  test("replay through the file transport into an identical snapshot", async () => {
    for (const [week, id] of Object.entries(await committedWeeks())) {
      const manifest = await readManifest(FIXTURES, id);
      const clock: Clock = { now: () => new Date(manifest.fetched_at) };
      const out = await mkdtemp(join(tmpdir(), "lazy-pundit-"));
      const replayed = await fetchSleeperSnapshot({
        transport: fileTransport(FIXTURES, id),
        clock,
        snapshotsDir: out,
        cacheDir: await mkdtemp(join(tmpdir(), "lazy-pundit-cache-")),
        leagueId: manifest.league_id,
      });
      expect(replayed.id, `week ${week}`).toBe(id);
      expect(replayed.manifest).toEqual(manifest);
    }
  });

  const denylist = existsSync(DENYLIST)
    ? readFileSync(DENYLIST, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    : [];

  test.skipIf(denylist.length === 0)(
    "contain no real name from the denylist (fixtures/denylist.txt, never committed)",
    async () => {
      const texts = await committedText();
      const found = denylist.filter((name) =>
        texts.some((t) => wholeWord(name).test(t)),
      );
      expect(found).toEqual([]);
    },
  );
});

describe.skipIf(!hasRaw)("scrubbing the full raw fixtures (local only)", () => {
  test("reproduces the committed set exactly", async () => {
    const out = await mkdtemp(join(tmpdir(), "lazy-pundit-scrub-"));
    await scrubSleeperFixtures({ rawDir: RAW, outDir: out });

    expect(await readFile(join(out, "weeks.json"), "utf8")).toBe(
      await readFile(join(FIXTURES, "weeks.json"), "utf8"),
    );
    expect((await readdir(join(out, "blobs"))).sort()).toEqual(
      (await readdir(join(FIXTURES, "blobs"))).sort(),
    );
    for (const id of Object.values(await committedWeeks())) {
      expect(await readManifest(out, id)).toEqual(
        await readManifest(FIXTURES, id),
      );
    }
  });

  test("leaves no real display name, team name, nickname or user ID behind", async () => {
    const realNames = await realIdentifiers(RAW);
    expect(realNames.length).toBeGreaterThan(30);
    const texts = await committedText();
    const found = realNames.filter((name) =>
      texts.some((t) => t.includes(name)),
    );
    expect(found).toEqual([]);
  });
});

/** Matches `name` as a whole word, ignoring case, so "Al" doesn't hit "total". */
function wholeWord(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

/** The identifying strings in the raw payloads, read straight from the files. */
async function realIdentifiers(rawDir: string): Promise<string[]> {
  const read = async (f: string) =>
    JSON.parse(await readFile(join(rawDir, f), "utf8"));
  const league = await read("league.json");
  const users = (await read("league_users.json")) as {
    user_id: string;
    display_name: string;
    metadata?: { team_name?: string } | null;
  }[];
  const rosters = (await read("league_rosters.json")) as {
    metadata?: Record<string, string> | null;
  }[];
  const names = [
    league.league_id,
    ...users.flatMap((u) => [
      u.user_id,
      u.display_name,
      u.metadata?.team_name ?? "",
    ]),
    ...rosters.flatMap((r) =>
      Object.entries(r.metadata ?? {})
        .filter(([k]) => k.startsWith("p_nick_"))
        .map(([, v]) => v),
    ),
  ];
  // Very short strings would match by accident; they're covered by the denylist instead.
  return [...new Set(names)].filter((n) => n.trim().length >= 4);
}
