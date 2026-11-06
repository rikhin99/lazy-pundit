import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  type Deps,
  draft,
  fetchSleeperSnapshot,
  refresh,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import {
  FEAR_THE_TURTLE_ID,
  fixedClock,
  frontMatter,
  type Json,
  onStandings,
  patchingTransport,
  statCorrection,
} from "./support/workspace.ts";

const LEAGUE = `${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`;
const WEEK_8 = `${LEAGUE}/matchups/8`;

/** Deps at `iso`, whose fetch sees `patches` (by URL) on the replayed data. */
function at(
  deps: Deps,
  iso: string,
  patches: Record<string, (payload: Json) => void> = {},
): Deps {
  return {
    ...deps,
    clock: fixedClock(iso),
    transport: patchingTransport(deps.transport, patches),
  };
}

test("a snapshot write keeps what drafts name and each season's latest, and prunes the rest past 14 days with their blobs", async () => {
  const { dir, deps } = await onStandings(8);
  const snapshots = join(dir, ".snapshots");
  /** A snapshot nothing names, as a fetch that never became a draft leaves. */
  const unnamed = async (
    iso: string,
    patches: Record<string, (payload: Json) => void>,
  ) => {
    const d = at(deps, iso, patches);
    return fetchSleeperSnapshot({
      transport: d.transport,
      clock: d.clock,
      snapshotsDir: snapshots,
      cacheDir: d.cacheDir,
      leagueId: FEAR_THE_TURTLE_ID,
    });
  };

  const lastSeason = await unnamed("2025-09-15T09:00:00.000Z", {
    [LEAGUE]: (league) => {
      league.season = "2024";
    },
  });
  const old = await unnamed("2025-10-01T09:00:00.000Z", {
    [WEEK_8]: statCorrection(2, 3),
  });
  const before = new Set(await readdir(join(snapshots, "blobs")));
  // Only drafts and frozen copies keep a snapshot: not other pundit files,
  // and a folder named like one is no ranking file.
  await mkdir(join(dir, "pundits/rikhin/archive.md"), { recursive: true });
  await writeFile(
    join(dir, "pundits/rikhin/notes.md"),
    `Compare with ${old.id}.\n`,
  );
  const { path } = await draft(dir, at(deps, "2025-10-28T09:00:00.000Z"));
  const drafted = frontMatter(await readFile(path, "utf8")).snapshot;
  await refresh(
    dir,
    at(deps, "2025-10-30T09:00:00.000Z", { [WEEK_8]: statCorrection(1, 1.8) }),
  );
  const refreshed = frontMatter(await readFile(path, "utf8")).snapshot;
  const recent = await unnamed("2025-11-05T09:00:00.000Z", {
    [WEEK_8]: statCorrection(4, 2),
  });

  await refresh(
    dir,
    at(deps, "2025-11-12T09:00:00.000Z", {
      [WEEK_8]: (payload) => {
        statCorrection(1, 1.8)(payload);
        statCorrection(3, -10)(payload);
      },
    }),
  );

  const meta = frontMatter(await readFile(path, "utf8"));
  expect(meta.earlier_snapshots).toEqual([drafted, refreshed]);
  const left = (await readdir(snapshots)).filter((n) => /^\d{8}T/.test(n));
  expect(left.sort()).toEqual(
    [lastSeason.id, drafted, refreshed, recent.id, meta.snapshot].sort(),
  );
  expect(left).not.toContain(old.id);

  // Every blob left is listed by a snapshot left, and the pruned one's own
  // week-8 payload is gone.
  const listed = new Set<string>();
  for (const id of left) {
    const manifest = JSON.parse(
      await readFile(join(snapshots, id, "manifest.json"), "utf8"),
    );
    for (const r of manifest.requests) listed.add(`${r.sha256}.json.gz`);
  }
  const blobs = await readdir(join(snapshots, "blobs"));
  expect(new Set(blobs)).toEqual(listed);
  const oldWeek8 = old.manifest.requests.find((r) => r.url === WEEK_8)?.sha256;
  expect(before).toContain(`${oldWeek8}.json.gz`);
  expect(blobs).not.toContain(`${oldWeek8}.json.gz`);
});
