import { afterEach, expect, test, vi } from "vitest";
import { systemDeps } from "../src/index.ts";

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

test("a LAZY_PUNDIT_NOW that isn't a time is refused by name", () => {
  vi.stubEnv("LAZY_PUNDIT_REPLAY", "/nowhere/20251028T120000Z-a095861f");
  vi.stubEnv("LAZY_PUNDIT_NOW", "last tuesday");
  expect(() => systemDeps()).toThrow(
    "LAZY_PUNDIT_NOW is last tuesday, not an ISO time.",
  );
});
