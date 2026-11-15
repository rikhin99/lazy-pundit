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
import {
  HOT_TAKERY_ID,
  HOT_TAKERY_LEAGUE_URL,
  hotTakeryAt,
} from "./support/espn.ts";
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

/**
 * The setup, with a listed Hot Takery workspace on ESPN and a stored cookie
 * dated `savedOn` (none when null), and ESPN answering its league request
 * with `status`.
 */
async function withEspnLeague(
  status: number,
  savedOn: string | null = "2025-10-01",
) {
  const { deps } = await setUp();
  const dir = join(deps.workspacesDir, "hot-takery");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "workspace.md"),
    `---\nformat: 1\npundit: rikhin\nseasons:\n  2025:\n    platform: espn\n    league_id: "${HOT_TAKERY_ID}"\n---\n\n# Hot Takery\n`,
  );
  const config = join(deps.configDir, "config.yaml");
  await writeFile(
    config,
    `${await readFile(config, "utf8")}  hot-takery: ${dir}\n`,
  );
  if (savedOn !== null) {
    deps.clock = fixedClock(`${savedOn}T12:00:00.000Z`);
    await saveCredentials(deps, { espnS2: "AEB%2Fstored" });
    deps.clock = fixedClock("2025-10-28T15:00:00.000Z");
  }
  const anthropic = anthropicAnswers(200);
  const espn = hotTakeryAt(deps, 8, { status }).transport;
  const asked: TransportRequest[] = [];
  deps.transport = {
    request(req) {
      if (req.url.startsWith("https://api.anthropic.com")) {
        return anthropic.request(req);
      }
      asked.push(req);
      return espn.request(req);
    },
  };
  return { deps, asked, dir };
}

test("with no cookie, a listed ESPN league that turns out private fails with the setup espn fix", async () => {
  const { deps, asked } = await withEspnLeague(401, null);

  const { checks, ok } = await doctor(deps);

  expect(ok).toBe(false);
  expect(asked[0]?.headers?.Cookie).toBeUndefined();
  expect(find(checks, "ESPN cookie")).toEqual({
    subject: "ESPN cookie",
    status: "fail",
    message: `ESPN league ${HOT_TAKERY_ID} is private, and no cookie is stored.`,
    fix: "Copy a fresh espn_s2 from your browser, then run: lazy-pundit setup espn",
  });
});

test("with no cookie, a public listed ESPN league passes", async () => {
  const { deps } = await withEspnLeague(200, null);
  expect(find((await doctor(deps)).checks, "ESPN cookie")).toMatchObject({
    status: "ok",
    message: `ESPN read league ${HOT_TAKERY_ID} with no cookie: it's public.`,
  });
});

test("a league ESPN doesn't know is a warning to check its league_id, not the connection", async () => {
  const { deps, dir } = await withEspnLeague(404);
  expect(find((await doctor(deps)).checks, "ESPN cookie")).toEqual({
    subject: "ESPN cookie",
    status: "warn",
    message: `Couldn't check the stored cookie: ESPN has no league ${HOT_TAKERY_ID} in 2025.`,
    fix: `Check league_id in ${join(dir, "workspace.md")} against the league's URL.`,
  });
});

test("doctor checks the cookie live with one request for a listed ESPN league", async () => {
  const { deps, asked } = await withEspnLeague(200);

  const { checks, ok } = await doctor(deps);

  expect(ok).toBe(true);
  expect(asked).toMatchObject([
    {
      url: HOT_TAKERY_LEAGUE_URL,
      headers: { Cookie: "espn_s2=AEB%2Fstored" },
    },
  ]);
  expect(find(checks, "ESPN cookie")).toEqual({
    subject: "ESPN cookie",
    status: "ok",
    message: `ESPN accepted the stored cookie (saved 2025-10-01) for league ${HOT_TAKERY_ID}.`,
  });
});

test("a cookie ESPN rejects fails with the setup espn fix, or the environment's", async () => {
  const stored = await withEspnLeague(401);
  expect(find((await doctor(stored.deps)).checks, "ESPN cookie")).toEqual({
    subject: "ESPN cookie",
    status: "fail",
    message: `ESPN rejected the stored cookie (saved 2025-10-01) for league ${HOT_TAKERY_ID}.`,
    fix: "Copy a fresh espn_s2 from your browser, then run: lazy-pundit setup espn",
  });

  const fromEnv = await withEspnLeague(401);
  fromEnv.deps.env = { ...fromEnv.deps.env, espnS2: "AEB%2Fenv" };
  const { checks, ok } = await doctor(fromEnv.deps);
  expect(ok).toBe(false);
  expect(fromEnv.asked[0]?.headers?.Cookie).toBe("espn_s2=AEB%2Fenv");
  expect(find(checks, "ESPN cookie")).toMatchObject({
    message: `ESPN rejected LAZY_PUNDIT_ESPN_S2 for league ${HOT_TAKERY_ID}.`,
    fix: "Set LAZY_PUNDIT_ESPN_S2 to a fresh espn_s2 from your browser, or unset it to use the stored cookie.",
  });
});

test("a cookie doctor can't check is a warning, and an accepted one 11 months old still warns", async () => {
  const down = await withEspnLeague(503);
  expect(find((await doctor(down.deps)).checks, "ESPN cookie")).toMatchObject({
    status: "warn",
    message: expect.stringMatching(/^Couldn't check the stored cookie: .*503/),
    fix: "Check your connection and run lazy-pundit doctor again.",
  });

  const old = await withEspnLeague(200, "2024-11-20");
  expect(find((await doctor(old.deps)).checks, "ESPN cookie")).toMatchObject({
    status: "warn",
    message:
      "The espn_s2 cookie was saved 2024-11-20, over 11 months ago, and may stop working soon.",
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
