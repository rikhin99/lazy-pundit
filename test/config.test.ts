import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  type Deps,
  findWorkspace,
  loadCredentials,
  saveCredentials,
} from "../src/index.ts";
import { fearTheTurtle, person } from "./support/workspace.ts";

test("a folder inside a workspace finds it, as git finds a repo", async () => {
  const { dir } = await fearTheTurtle(8);
  const inside = join(dir, "pundits", "rikhin", "2025");
  await mkdir(inside, { recursive: true });

  expect(await findWorkspace(await person(), { cwd: inside })).toBe(dir);
});

test("saved credentials are written at mode 0600 and read back from the file", async () => {
  const deps = await person();

  const path = await saveCredentials(deps, {
    anthropicApiKey: "sk-ant-stored",
    espnS2: "AEB%2Fstored",
  });

  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await loadCredentials(deps)).toEqual({
    anthropicApiKey: { value: "sk-ant-stored", from: "file" },
    espnS2: { value: "AEB%2Fstored", from: "file", savedAt: "2025-10-28" },
    warnings: [],
  });
});

test("a credentials file others can read loads with a warning and the chmod to fix it", async () => {
  const deps = await person();
  const path = await saveCredentials(deps, {
    anthropicApiKey: "sk-ant-stored",
  });
  await chmod(path, 0o644);

  const { anthropicApiKey, warnings } = await loadCredentials(deps);

  expect(anthropicApiKey?.value).toBe("sk-ant-stored");
  expect(warnings).toEqual([
    `${path} can be read by other users on this machine (mode 0644). Run: chmod 600 ${path}`,
  ]);
});

test("ANTHROPIC_API_KEY and LAZY_PUNDIT_ESPN_S2 override the stored values", async () => {
  const deps = await person();
  await saveCredentials(deps, {
    anthropicApiKey: "sk-ant-stored",
    espnS2: "AEB%2Fstored",
  });
  deps.env = {
    ...deps.env,
    anthropicApiKey: "sk-ant-env",
    espnS2: "AEB%2Fenv",
  };

  expect(await loadCredentials(deps)).toEqual({
    anthropicApiKey: { value: "sk-ant-env", from: "env" },
    espnS2: { value: "AEB%2Fenv", from: "env" },
    warnings: [],
  });
});

test("saving one credential keeps the other", async () => {
  const deps = await person();
  await saveCredentials(deps, { espnS2: "AEB%2Fstored" });
  await saveCredentials(deps, { anthropicApiKey: "sk-ant-stored" });

  const { anthropicApiKey, espnS2 } = await loadCredentials(deps);
  expect([anthropicApiKey?.value, espnS2?.value]).toEqual([
    "sk-ant-stored",
    "AEB%2Fstored",
  ]);
});

/** Writes the person's `config.yaml` as a pundit would by hand. */
async function writeConfig(deps: Deps, yaml: string) {
  await mkdir(deps.configDir, { recursive: true });
  await writeFile(join(deps.configDir, "config.yaml"), yaml);
}

test("--league finds a workspace listed in config.yaml from any folder", async () => {
  const { dir } = await fearTheTurtle(8);
  const deps = await person();
  await writeConfig(
    deps,
    `format: 1\nname: Rikhin\nworkspaces:\n  fear-the-turtle: ${dir}\n`,
  );

  expect(
    await findWorkspace(deps, {
      cwd: deps.workspacesDir,
      league: "fear-the-turtle",
    }),
  ).toBe(dir);
});

test("an unknown --league names the leagues config.yaml lists", async () => {
  const { dir } = await fearTheTurtle(8);
  const deps = await person();
  await writeConfig(
    deps,
    `format: 1\nworkspaces:\n  fear-the-turtle: ${dir}\n`,
  );

  await expect(
    findWorkspace(deps, { cwd: dir, league: "hot-takery" }),
  ).rejects.toThrow(
    /No league "hot-takery" in .*config\.yaml\. Its leagues: fear-the-turtle/,
  );
});

test("a config.yaml that doesn't parse names the file and the field", async () => {
  const deps = await person();
  await writeConfig(deps, "format: 1\nmonthly_cap_usd: lots\n");

  await expect(
    findWorkspace(deps, { cwd: deps.workspacesDir, league: "fear-the-turtle" }),
  ).rejects.toThrow(/config\.yaml: [\s\S]*monthly_cap_usd/);
});

test("a workspace listed by a relative or ~ path is refused, asking for a full path", async () => {
  const deps = await person();
  await writeConfig(
    deps,
    "format: 1\nworkspaces:\n  fear-the-turtle: ~/lazy-pundit/fear-the-turtle\n",
  );

  await expect(
    findWorkspace(deps, { cwd: deps.workspacesDir, league: "fear-the-turtle" }),
  ).rejects.toThrow(/config\.yaml: [\s\S]*full path[\s\S]*fear-the-turtle/);
});

test("a credentials file others can change but not read is warned about as changeable", async () => {
  const deps = await person();
  const path = await saveCredentials(deps, {
    anthropicApiKey: "sk-ant-stored",
  });
  await chmod(path, 0o620);

  expect((await loadCredentials(deps)).warnings).toEqual([
    `${path} can be changed by other users on this machine (mode 0620). Run: chmod 600 ${path}`,
  ]);
});
