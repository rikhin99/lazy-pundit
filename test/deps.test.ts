import { afterEach, expect, test, vi } from "vitest";
import { systemDeps } from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { HOT_TAKERY_LEAGUE_URL } from "./support/espn.ts";

const HOT_TAKERY = `${import.meta.dirname}/../fixtures/espn/hot-takery-2025`;

afterEach(() => {
  vi.unstubAllEnvs();
});

test("LAZY_PUNDIT_NOW stops the clock for a replayed run, and only for one", () => {
  vi.stubEnv("LAZY_PUNDIT_NOW", "2025-10-28T15:00:00.000Z");
  vi.stubEnv("LAZY_PUNDIT_REPLAY", "");
  expect(systemDeps().clock.now().getFullYear()).not.toBe(2025);

  vi.stubEnv("LAZY_PUNDIT_REPLAY", "/nowhere/20251028T120000Z-a095861f");
  expect(systemDeps().clock.now().toISOString()).toBe(
    "2025-10-28T15:00:00.000Z",
  );
});

test("LAZY_PUNDIT_REPLAY_COOKIE makes a replayed ESPN league private to that cookie", async () => {
  vi.stubEnv("LAZY_PUNDIT_REPLAY", `${HOT_TAKERY}/20251028T120000Z-a095861f`);
  vi.stubEnv("LAZY_PUNDIT_REPLAY_COOKIE", "AEB%2Fright");
  const { transport } = systemDeps();
  const ask = (headers: Record<string, string>) =>
    transport.request({ url: HOT_TAKERY_LEAGUE_URL, params: {}, headers });

  expect((await ask({})).status).toBe(401);
  expect((await ask({ Cookie: "espn_s2=AEB%2Fwrong" })).status).toBe(401);
  expect((await ask({ Cookie: "espn_s2=AEB%2Fright" })).status).toBe(200);
  // Other platforms' requests are replayed as before.
  expect(
    (await transport.request({ url: `${SLEEPER_API}/state/nfl` })).status,
  ).toBe(404);
});

test("a LAZY_PUNDIT_NOW that isn't a time is refused by name", () => {
  vi.stubEnv("LAZY_PUNDIT_REPLAY", "/nowhere/20251028T120000Z-a095861f");
  vi.stubEnv("LAZY_PUNDIT_NOW", "last tuesday");
  expect(() => systemDeps()).toThrow(
    "LAZY_PUNDIT_NOW is last tuesday, not an ISO time.",
  );
});
