import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  type DoctorCheck,
  doctor,
  saveCredentials,
  type Transport,
  type TransportRequest,
} from "../src/index.ts";
import { fearTheTurtle, fixedClock, operator } from "./support/workspace.ts";

/**
 * A transport that answers Anthropic's model list with `status`, and
 * remembers each request.
 */
function anthropicAnswers(status: number): Transport & {
  requests: TransportRequest[];
} {
  const requests: TransportRequest[] = [];
  return {
    requests,
    async request(req) {
      requests.push(req);
      const ok = req.url === "https://api.anthropic.com/v1/models";
      return {
        status: ok ? status : 404,
        body: new TextEncoder().encode(ok ? '{"data":[]}' : ""),
      };
    },
  };
}

/** One operator with a config listing Fear The Turtle and a stored key. */
async function setUp() {
  const { dir } = await fearTheTurtle(8);
  const deps = await operator();
  await mkdir(deps.configDir, { recursive: true });
  await writeFile(
    join(deps.configDir, "config.yaml"),
    `format: 1\nname: Rikhin\nworkspaces:\n  fear-the-turtle: ${dir}\n`,
  );
  await saveCredentials(deps, { anthropicApiKey: "sk-ant-stored" });
  deps.transport = anthropicAnswers(200);
  return { deps, dir };
}

function bySubject(checks: DoctorCheck[]) {
  return Object.fromEntries(checks.map((c) => [c.subject, c.status]));
}

test("a healthy setup passes every check", async () => {
  const { deps } = await setUp();

  const { checks } = await doctor(deps);

  expect(bySubject(checks)).toEqual({
    Node: "ok",
    "config.yaml": "ok",
    "credentials.yaml": "ok",
    "spend.yaml": "ok",
    "Anthropic key": "ok",
    "ESPN cookie": "ok",
    "workspace fear-the-turtle": "ok",
    clipboard: "ok",
  });
  expect(checks.filter((c) => c.fix)).toEqual([]);
});

function find(checks: DoctorCheck[], subject: string) {
  return checks.find((c) => c.subject === subject);
}

test("on a fresh machine with an old Node, doctor fails Node and says to run init", async () => {
  const deps = await operator();
  deps.env = { nodeVersion: "v22.11.0" };

  const { checks, ok } = await doctor(deps);

  expect(ok).toBe(false);
  expect(find(checks, "Node")).toMatchObject({
    status: "fail",
    fix: expect.stringContaining("Install Node 24 or later"),
  });
  expect(find(checks, "config.yaml")).toMatchObject({
    status: "warn",
    fix: "Run: lazy-pundit init",
  });
  expect(find(checks, "Anthropic key")?.status).toBe("note");
});

test("a key Anthropic rejects fails with how to get a new one", async () => {
  const { deps } = await setUp();
  deps.transport = anthropicAnswers(401);

  const { checks, ok } = await doctor(deps);

  expect(ok).toBe(false);
  expect(find(checks, "Anthropic key")).toEqual({
    subject: "Anthropic key",
    status: "fail",
    message: "Anthropic rejected the stored key.",
    fix: "Make a new key at https://console.anthropic.com, then run: lazy-pundit setup key",
  });
});

test("doctor checks the ANTHROPIC_API_KEY override live, not the stored key", async () => {
  const { deps } = await setUp();
  const transport = anthropicAnswers(200);
  deps.transport = transport;
  deps.env = { ...deps.env, anthropicApiKey: "sk-ant-env" };

  const { checks } = await doctor(deps);

  expect(transport.requests.map((r) => r.headers?.["x-api-key"])).toEqual([
    "sk-ant-env",
  ]);
  expect(find(checks, "Anthropic key")?.message).toBe(
    "Anthropic accepted ANTHROPIC_API_KEY.",
  );
});

test("a credentials file others can read is a warning with the chmod to fix it", async () => {
  const { deps } = await setUp();
  const path = join(deps.configDir, "credentials.yaml");
  await chmod(path, 0o644);

  const { checks, ok } = await doctor(deps);

  expect(ok).toBe(true);
  expect(find(checks, "credentials.yaml")).toMatchObject({
    status: "warn",
    fix: `Run: chmod 600 ${path}`,
  });
});

test("a vanished workspace is dropped from config.yaml, its folder never made, the rest kept", async () => {
  const { deps, dir } = await setUp();
  const gone = join(deps.workspacesDir, "hot-takery");
  const config = join(deps.configDir, "config.yaml");
  await writeFile(
    config,
    `format: 1\nname: Rikhin # me\nworkspaces:\n  fear-the-turtle: ${dir}\n  hot-takery: ${gone}\n`,
  );

  const { checks, ok } = await doctor(deps);

  expect(ok).toBe(true);
  expect(find(checks, "workspace hot-takery")).toEqual({
    subject: "workspace hot-takery",
    status: "note",
    message: `${gone} is gone, so it was dropped from config.yaml.`,
  });
  expect(existsSync(gone)).toBe(false);
  expect(existsSync(deps.workspacesDir)).toBe(false);
  expect(await readFile(config, "utf8")).toBe(
    `format: 1\nname: Rikhin # me\nworkspaces:\n  fear-the-turtle: ${dir}\n`,
  );
});

test("a listed workspace whose workspace.md doesn't parse fails and stays listed", async () => {
  const { deps, dir } = await setUp();
  await writeFile(join(dir, "workspace.md"), "---\nformat: 1\n---\n");

  const { checks, ok } = await doctor(deps);

  expect(ok).toBe(false);
  expect(find(checks, "workspace fear-the-turtle")).toMatchObject({
    status: "fail",
    message: expect.stringContaining("workspace.md"),
    fix: expect.stringContaining(`Fix workspace.md in ${dir}`),
  });
  expect(await readFile(join(deps.configDir, "config.yaml"), "utf8")).toContain(
    "fear-the-turtle",
  );
});

test("an espn_s2 cookie saved more than 11 months ago is a warning to renew it", async () => {
  const { deps } = await setUp();
  deps.clock = fixedClock("2024-11-20T12:00:00.000Z");
  await saveCredentials(deps, { espnS2: "AEB%2Fstored" });
  deps.clock = fixedClock("2025-10-28T15:00:00.000Z");

  const { checks } = await doctor(deps);

  expect(find(checks, "ESPN cookie")).toEqual({
    subject: "ESPN cookie",
    status: "warn",
    message:
      "The espn_s2 cookie was saved 2024-11-20, over 11 months ago, and may stop working soon.",
    fix: "Copy a fresh espn_s2 from your browser, then run: lazy-pundit setup espn",
  });
});

test("an espn_s2 cookie 10 months old passes", async () => {
  const { deps } = await setUp();
  deps.clock = fixedClock("2024-12-29T12:00:00.000Z");
  await saveCredentials(deps, { espnS2: "AEB%2Fstored" });
  deps.clock = fixedClock("2025-10-28T15:00:00.000Z");

  const { checks } = await doctor(deps);

  expect(find(checks, "ESPN cookie")?.status).toBe("ok");
});

test("no clipboard command is a warning, since publish still writes the text file", async () => {
  const { deps } = await setUp();
  deps.clipboard = { write: async () => false, find: async () => undefined };

  const { checks, ok } = await doctor(deps);

  expect(ok).toBe(true);
  expect(find(checks, "clipboard")).toMatchObject({
    status: "warn",
    fix: expect.stringContaining("paste from the .txt file"),
  });
});
