import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ESPN_VIEWS, espnLeagueUrl, espnViewUrl } from "../src/espn/api.ts";
import {
  check,
  type Deps,
  draft,
  FetchError,
  fileTransport,
  publish,
  refresh,
  saveCredentials,
} from "../src/index.ts";
import { hotTakeryAt } from "./support/espn.ts";
import { fearTheTurtle, operator, rankingsDir } from "./support/workspace.ts";

const HOT_TAKERY = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "espn",
  "hot-takery-2025",
);
const LEAGUE_URL = espnViewUrl(
  espnLeagueUrl("2025", "900000001"),
  ESPN_VIEWS.league,
);

/** A hand-written Hot Takery workspace on ESPN, with deps replaying `week`. */
async function hotTakery(week: number) {
  const dir = await mkdtemp(join(tmpdir(), "lazy-pundit-espn-ws-"));
  await writeFile(
    join(dir, "workspace.md"),
    `---
format: 1
pundit: rikhin
seasons:
  2025:
    platform: espn
    league_id: "900000001"
---

# Hot Takery
`,
  );
  return { dir, deps: await atWeek(await operator(), week) };
}

async function atWeek(deps: Deps, week: number): Promise<Deps> {
  const weeks = JSON.parse(
    await readFile(join(HOT_TAKERY, "weeks.json"), "utf8"),
  );
  return { ...deps, transport: fileTransport(HOT_TAKERY, weeks[String(week)]) };
}

/** The same deps, except ESPN rejects the cookie. */
function rejecting(deps: Deps): Deps {
  return {
    ...deps,
    transport: {
      async request(req) {
        if (req.url === LEAGUE_URL) {
          return { status: 401, body: new Uint8Array() };
        }
        return deps.transport.request(req);
      },
    },
  };
}

describe("an ESPN league through draft and publish", () => {
  test("a draft then a publish runs end to end on the committed fixtures", async () => {
    const { dir, deps } = await hotTakery(14);
    const drafted = await draft(dir, deps);
    expect(drafted.path).toContain("week-14");
    const text = await readFile(drafted.path, "utf8");
    expect(text).toContain("starting_order: [espn:2, espn:1, espn:8");
    // The draft's snapshot is an ESPN one, and the check reads it back.
    const checked = await check(dir);
    expect(checked.week).toBe(14);

    const result = await publish(dir, deps, { yes: true });
    expect(result.published).toBe(true);
    if (!result.published) return;
    expect(result.text).toContain("Stats: ESPN");
    expect(JSON.stringify(checked.problems)).toContain(
      "Corrections may land through Saturday",
    );
    expect(
      await readFile(join(rankingsDir(dir), "week-14.published.md"), "utf8"),
    ).toContain("starting_order");
  });

  test("a draft's snapshot ID ends with the data hash, the same for the same data", async () => {
    const a = await hotTakery(14);
    const b = await hotTakery(14);
    const first = await draft(a.dir, a.deps);
    const second = await draft(b.dir, b.deps);
    const id = (p: string) => /snapshot: (\S+)/.exec(p)?.[1];
    const texts = await Promise.all(
      [first.path, second.path].map((p) => readFile(p, "utf8")),
    );
    expect(id(texts[0] as string)).toMatch(/-[0-9a-f]{8}$/);
    expect(id(texts[0] as string)?.slice(-8)).toBe(
      id(texts[1] as string)?.slice(-8),
    );
  });
});

describe("a rejected ESPN cookie", () => {
  test("with no snapshot to continue from, a stored cookie's error ends with the setup fix", async () => {
    const { dir, deps } = await hotTakery(14);
    await saveCredentials(deps, { espnS2: "stale" });
    const error = await draft(dir, rejecting(deps)).catch((e) => e);
    expect(error).toBeInstanceOf(FetchError);
    expect(error.message).toMatch(
      /^ESPN cookie rejected \(saved \d{4}-\d{2}-\d{2}\)\. /,
    );
    expect(error.message).toMatch(/run: lazy-pundit setup espn$/);
  });

  test("with no snapshot to continue from, an environment cookie's error says to set or unset it", async () => {
    const { dir, deps } = await hotTakery(14);
    const withEnv = {
      ...deps,
      env: { ...deps.env, espnS2: "stale" },
    } satisfies Deps;
    const error = await draft(dir, rejecting(withEnv)).catch((e) => e);
    expect(error).toBeInstanceOf(FetchError);
    expect(error.message).toContain("from LAZY_PUNDIT_ESPN_S2");
    expect(error.message).toContain("unset it to use the stored cookie");
  });

  test("with a snapshot to continue from, the failed-fetch item carries each fix", async () => {
    for (const [env, fix] of [
      [undefined, "lazy-pundit setup espn"],
      ["stale", "unset it to use the stored cookie"],
    ] as const) {
      const { dir, deps } = await hotTakery(14);
      const base: Deps = env
        ? { ...deps, env: { ...deps.env, espnS2: env } }
        : deps;
      if (!env) await saveCredentials(deps, { espnS2: "stale" });
      await draft(dir, base);
      const result = await refresh(dir, rejecting(base));
      expect(result.fromLastComplete).toBe(true);
      const item = result.problems.find((p) => p.kind === "failed-fetch");
      expect(item?.reason).toContain("ESPN cookie rejected");
      expect(item?.reason).toContain(fix);
    }
  });
});

describe("a credentials.yaml others can read, on an ESPN workspace", () => {
  const exposed = (path: string) =>
    `${path} can be read by other users on this machine (mode 0644). Run: chmod 600 ${path}`;
  const count = (warnings: string[], warning: string) =>
    warnings.filter((w) => w === warning).length;

  /** A week-14 draft on a stored cookie, then `credentials.yaml` at `mode`. */
  async function drafted(mode: number) {
    const { dir, deps } = await hotTakery(14);
    const path = await saveCredentials(deps, { espnS2: "cookie" });
    await draft(dir, deps);
    await chmod(path, mode);
    return { dir, deps, path };
  }

  test("refresh warns once, whether the fetch succeeds or fails", async () => {
    const { dir, deps, path } = await drafted(0o644);
    for (const run of [deps, rejecting(deps)]) {
      const result = await refresh(dir, run);
      expect(result.changes).toEqual([]);
      expect(count(result.warnings, exposed(path))).toBe(1);
    }
  });

  test("refresh onto changed data warns once", async () => {
    const { dir, deps, path } = await drafted(0o644);
    const corrected = hotTakeryAt(deps, 14, {
      correction: { week: 14, points: 1 },
    });
    const result = await refresh(dir, corrected);
    expect(result.changes).not.toEqual([]);
    expect(count(result.warnings, exposed(path))).toBe(1);
  });

  test("publish warns once, whether the fetch succeeds or fails", async () => {
    for (const reject of [false, true]) {
      const { dir, deps, path } = await drafted(0o644);
      const warned: string[][] = [];
      const result = await publish(dir, reject ? rejecting(deps) : deps, {
        yes: true,
        onWarnings: (w) => warned.push(w),
      });
      expect(count(result.warnings, exposed(path))).toBe(1);
      expect(count(warned.flat(), exposed(path))).toBe(1);
    }
  });

  test("draft warns once, for the fetch and the key together", async () => {
    const { dir, deps } = await hotTakery(14);
    const path = await saveCredentials(deps, { espnS2: "cookie" });
    await chmod(path, 0o644);
    const warned: string[][] = [];
    const result = await draft(dir, deps, {
      onWarnings: (w) => warned.push(w),
    });
    expect(count(result.warnings, exposed(path))).toBe(1);
    expect(count(warned.flat(), exposed(path))).toBe(1);
  });

  test("at 0600, neither refresh nor publish warns about it", async () => {
    const { dir, deps } = await drafted(0o600);
    const about = (warnings: string[]) =>
      warnings.filter((w) => w.includes("credentials.yaml"));
    expect(about((await refresh(dir, deps)).warnings)).toEqual([]);
    expect(about((await publish(dir, deps, { yes: true })).warnings)).toEqual(
      [],
    );
  });
});

test("a Sleeper workspace's refresh and publish don't read credentials, so don't warn about them", async () => {
  const { dir, deps } = await fearTheTurtle(8);
  await draft(dir, deps);
  const path = await saveCredentials(deps, { espnS2: "cookie" });
  await chmod(path, 0o644);
  expect((await refresh(dir, deps)).warnings).toEqual([]);
  expect((await publish(dir, deps, { yes: true })).warnings).toEqual([]);
});
