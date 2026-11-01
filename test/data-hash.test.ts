import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { draft } from "../src/index.ts";
import {
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  type Json,
  patchingTransport,
} from "./support/workspace.ts";

const SLEEPER = "https://api.sleeper.app/v1";
const LEAGUE = `${SLEEPER}/league/${FEAR_THE_TURTLE_ID}`;

/** Drafts week 8, optionally through a patched payload, and reads the front matter. */
async function draftWeek8(
  patch?: [string, (payload: Json) => void],
): Promise<{ data_hash: string; snapshot: string }> {
  const { dir, deps } = await fearTheTurtle(8);
  if (patch) {
    deps.transport = patchingTransport(deps.transport, {
      [patch[0]]: patch[1],
    });
  }
  const { path } = await draft(dir, deps);
  const text = await readFile(path, "utf8");
  return parse(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "");
}

describe("data hash", () => {
  test("a draft records the data hash of the data it was built from", async () => {
    const fm = await draftWeek8();
    expect(fm.data_hash).toMatch(/^[0-9a-f]{64}$/);
    // The snapshot ID's short hash is the data hash's start.
    expect(fm.snapshot.endsWith(`-${fm.data_hash.slice(0, 8)}`)).toBe(true);
  });

  test("injuries, names and the league's chat don't change it", async () => {
    const plain = await draftWeek8();
    const injured = await draftWeek8([
      `${SLEEPER}/players/nfl`,
      (players) => {
        for (const p of Object.values(players) as Json[]) {
          p.injury_status = "Out";
        }
      },
    ]);
    const renamed = await draftWeek8([
      `${LEAGUE}/users`,
      (users) => {
        for (const u of users) u.metadata = { team_name: "Renamed" };
      },
    ]);
    const chatted = await draftWeek8([
      LEAGUE,
      (league) => {
        league.last_message_time = 1761500000000;
      },
    ]);
    expect(injured.data_hash).toBe(plain.data_hash);
    expect(renamed.data_hash).toBe(plain.data_hash);
    expect(chatted.data_hash).toBe(plain.data_hash);
    expect(chatted.snapshot).toBe(plain.snapshot);
  });

  test("a stat correction in a scored week changes it", async () => {
    const plain = await draftWeek8();
    const corrected = await draftWeek8([
      `${LEAGUE}/matchups/7`,
      (matchups) => {
        const m = matchups.find((x: Json) => x.roster_id === 1);
        m.players_points[m.starters[0]] += 0.1;
        m.points += 0.1;
      },
    ]);
    expect(corrected.data_hash).not.toBe(plain.data_hash);
    expect(corrected.snapshot).not.toBe(plain.snapshot);
  });
});
