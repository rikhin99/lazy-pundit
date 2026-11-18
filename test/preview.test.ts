import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import {
  type Deps,
  draft,
  startPreview,
  type TransportRequest,
} from "../src/index.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import {
  atWeek,
  FEAR_THE_TURTLE_ID,
  fearTheTurtle,
  type Json,
  onStandings,
  patchingTransport,
  published,
  rankingsDir,
  writeLeagueFile,
} from "./support/workspace.ts";

/** A port nothing on 127.0.0.1 holds right now. */
async function freePort(): Promise<number> {
  const server = await listening(0);
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A server holding `port` on 127.0.0.1 until the test ends. */
async function listening(port: number): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

/**
 * Week 10 drafted, and the preview started on a free port with deps whose
 * transport records every request from then on.
 */
async function previewing() {
  const { dir, deps } = await fearTheTurtle(10);
  await draft(dir, deps);
  const requests: TransportRequest[] = [];
  const recording: Deps = {
    ...deps,
    transport: {
      request: (req) => {
        requests.push(req);
        return deps.transport.request(req);
      },
    },
  };
  const preview = await startPreview(dir, recording, {
    port: await freePort(),
  });
  onTestFinished(() => preview.stop());
  const draftPath = join(rankingsDir(dir), "week-10.md");
  return { dir, deps, preview, requests, draftPath };
}

/** The page as served now. */
async function page(url: string): Promise<string> {
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return res.text();
}

/** Text as a browser shows it: tags dropped, entities read. */
function shown(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** The Problems panel's markup. */
function panel(html: string): string {
  const found = /<section class="problems"[^>]*>([\s\S]*?)<\/section>/.exec(
    html,
  );
  expect(found, "no Problems panel").not.toBeNull();
  return found?.[1] as string;
}

/** Each item of the Problems panel, as markup. */
function items(html: string): string[] {
  return [...panel(html).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(
    (m) => m[1] as string,
  );
}

/** The tabs' labels in order, each marked `*` when selected. */
function tabs(html: string): string[] {
  return [...html.matchAll(/<button role="tab"([^>]*)>([^<]*)<\/button>/g)].map(
    (m) => `${m[2]}${/aria-selected="true"/.test(m[1] as string) ? "*" : ""}`,
  );
}

/** One tab's panel markup: `plain`, `tabloid` or `broadcast`. */
function tab(html: string, name: string): string {
  const found = new RegExp(
    `<section role="tabpanel" id="tab-${name}"[^>]*>([\\s\\S]*?)</section>`,
  ).exec(html);
  expect(found, `no ${name} tab`).not.toBeNull();
  return found?.[1] as string;
}

/** The Plain text tab's text, as the pundit would copy it. */
function plainText(html: string): string {
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(tab(html, "plain"));
  expect(pre).not.toBeNull();
  return shown(pre?.[1] as string);
}

/** One block of the Check tab, the week intro's or a team's, picked apart. */
interface CheckBlock {
  id: string;
  /** The team's name, or "Week intro". */
  name: string;
  place?: string;
  start?: string;
  mark?: string;
  /** The blurb or intro as the league reads it. */
  blurb: string;
  /** Each underlined claim: its words, its style and where it starts in `blurb`. */
  underlines: { text: string; style: string; start: number }[];
  /** The stats panel: each label with its values in order. */
  stats: Record<string, string[]>;
}

/** The Check tab's blocks in order. */
function checkBlocks(html: string): CheckBlock[] {
  const markup = tab(html, "check");
  return [
    ...markup.matchAll(
      /<article [^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g,
    ),
  ].map(([, id, block]) => {
    const b = block as string;
    const field = (cls: string) =>
      new RegExp(`class="${cls}"[^>]*>([^<]*)<`).exec(b)?.[1]?.trim();
    const blurb = /<p class="blurb">([\s\S]*?)<\/p>/.exec(b)?.[1] ?? "";
    const underlines: CheckBlock["underlines"] = [];
    let read = "";
    for (const part of blurb.split(/(<u class="[^"]*"[^>]*>[\s\S]*?<\/u>)/)) {
      const u = /^<u class="([^"]*)"[^>]*>([\s\S]*?)<\/u>$/.exec(part);
      if (u) {
        underlines.push({
          text: shown(u[2] as string),
          style: u[1] as string,
          start: read.length,
        });
      }
      read += shown(part);
    }
    const stats: CheckBlock["stats"] = {};
    for (const [, label, dds] of b.matchAll(
      /<dt>([^<]*)<\/dt>((?:<dd>[\s\S]*?<\/dd>)*)/g,
    )) {
      stats[label as string] = [
        ...(dds as string).matchAll(/<dd>([\s\S]*?)<\/dd>/g),
      ].map((m) => shown(m[1] as string));
    }
    const place = field("place");
    const start = field("start")?.replace(/^start /, "");
    const mark = field("mark");
    return {
      id: id as string,
      name: shown(/<h2>([^<]*)/.exec(b)?.[1] ?? "").trim(),
      ...(place ? { place } : {}),
      ...(start ? { start } : {}),
      ...(mark ? { mark } : {}),
      blurb: read,
      underlines,
      stats,
    };
  });
}

/** The Check tab's block named `name`: a team's name, or "Week intro". */
function checkBlock(html: string, name: string): CheckBlock {
  const found = checkBlocks(html).filter((b) => b.name === name);
  expect(found, `blocks named ${name}`).toHaveLength(1);
  return found[0] as CheckBlock;
}

/** The page `preview` serves for the workspace as it stands. */
async function served(dir: string, deps: Deps): Promise<string> {
  const preview = await startPreview(dir, deps, { port: await freePort() });
  onTestFinished(() => preview.stop());
  return page(preview.url);
}

/** The style page a tab's frame shows, whole. */
function framed(html: string, name: string): string {
  const frame = /<iframe [^>]*srcdoc="([^"]*)"/.exec(tab(html, name));
  expect(frame).not.toBeNull();
  const doc = frame?.[1] as string;
  return doc.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

/**
 * Listens on the page's reload channel: `count()` is the reload notices so
 * far, and `next()` waits for the next one.
 */
async function reloads(url: string) {
  const controller = new AbortController();
  const res = await fetch(new URL("/events", url), {
    signal: controller.signal,
  });
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
  let count = 0;
  let waiting: (() => void) | undefined;
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buffer = "";
    for (;;) {
      const chunk = await reader.read().catch(() => undefined);
      if (!chunk || chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        if (/^event: reload$/m.test(buffer.slice(0, end))) {
          count += 1;
          waiting?.();
        }
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
      }
    }
  })();
  onTestFinished(() => controller.abort());
  return {
    count: () => count,
    next: () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("no reload notice")),
          5_000,
        );
        waiting = () => {
          clearTimeout(timer);
          resolve();
        };
      }),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

const REMINDER =
  "League: correction timing: Scored. Corrections may land through Thursday";

test("the page leads with the problems list, then the share tabs on Plain text", async () => {
  const { preview } = await previewing();

  const html = await page(preview.url);

  expect(shown(panel(html))).toContain("Problems: 0 hard, 1 soft");
  const [only, ...rest] = items(html);
  expect(rest).toEqual([]);
  expect(shown(only as string)).toContain(REMINDER);
  expect(only).not.toContain("<a ");
  expect(shown(only as string)).not.toMatch(/line \d/);
  expect(html.indexOf('class="problems"')).toBeLessThan(
    html.indexOf('role="tab"'),
  );
  expect(tabs(html)).toEqual(["Plain text*", "Tabloid", "Broadcast", "Check"]);
});

test("each share tab shows what publish then writes, byte for byte", async () => {
  const { dir, deps, preview } = await previewing();

  const html = await page(preview.url);
  await published(dir, deps);

  const out = (file: string) => readFile(join(rankingsDir(dir), file), "utf8");
  expect(plainText(html)).toBe(await out("week-10.txt"));
  expect(plainText(html)).toContain("1. Bench Mob · 9-1 (new)");
  expect(framed(html, "tabloid")).toBe(await out("week-10.tabloid.html"));
  expect(framed(html, "broadcast")).toBe(await out("week-10.broadcast.html"));
});

test("each share tab has the not-published strip outside its page, and nothing copies", async () => {
  const { preview } = await previewing();

  const html = await page(preview.url);

  for (const name of ["plain", "tabloid", "broadcast"]) {
    const markup = tab(html, name);
    const strip = markup.indexOf("Draft: not published yet");
    expect(strip, name).toBeGreaterThanOrEqual(0);
    expect(strip, name).toBeLessThan(markup.search(/<pre|<iframe/));
  }
  expect(framed(html, "tabloid")).not.toContain("not published");
  expect(tab(html, "check")).not.toContain("not published");
  expect(shown(html)).not.toMatch(/\bcopy\b/i);
});

test("a wrong claim comes first in the problems list, with its line, linking to its team's block on the Check tab", async () => {
  const { preview, draftPath } = await previewing();
  const text = await readFile(draftPath, "utf8");
  expect(text.split("\n")[26]).toMatch(/^## Bench Mob/);
  await writeFile(
    draftPath,
    text.replace("by [23.9]{ev=w10.margin}", "by [50]{ev=w10.margin}"),
  );

  const html = await page(preview.url);

  expect(shown(panel(html))).toContain("Problems: 1 hard, 1 soft");
  const [first, second] = items(html);
  expect(shown(first as string)).toContain(
    'line 28 Bench Mob: "50" wrong: w10.margin is 23.9',
  );
  const href = /<a [^>]*href="#([^"]+)"/.exec(first as string)?.[1];
  expect(href).toBeDefined();
  expect(checkBlocks(html).filter((b) => b.id === href)).toEqual([
    checkBlock(html, "Bench Mob"),
  ]);
  expect(shown(second as string)).toContain(REMINDER);
  expect(plainText(html)).toContain("beat Bye Bye Bea by 50");
});

test("the panel shows lore's warnings, the personal-data warning word for word", async () => {
  const { dir, preview } = await previewing();
  const lore = join(dir, "lore.md");
  await writeFile(
    lore,
    "---\nlore: 1\n---\n## Running jokes\n- A joke.\n- Bo lives at 42 Elm Street.\n",
  );
  expect((await readFile(lore, "utf8")).split("\n")[5]).toBe(
    "- Bo lives at 42 Elm Street.",
  );

  const html = await page(preview.url);

  expect(shown(panel(html))).toContain(
    "lore.md may hold personal data: line 6 (street address). Lore is sent to the LLM provider and copied into each LLM transcript, so remove what shouldn't go there; `lazy-pundit transcripts delete` removes the copies.",
  );
});

test("saving the draft sends one reload notice, and nothing else in the workspace sends any", async () => {
  const { dir, preview, draftPath } = await previewing();
  const events = await reloads(preview.url);

  await writeFile(
    join(dir, "lore.md"),
    "---\nlore: 1\n---\n## Running jokes\n- A joke.\n",
  );
  await writeLeagueFile(dir, "");
  await mkdir(join(dir, "pundits", "rikhin"), { recursive: true });
  await writeFile(
    join(dir, "pundits", "rikhin", "persona.md"),
    "---\nformat: 1\npreset: broadcast\n---\nGo easy on Bobcat.\n",
  );
  await writeFile(join(rankingsDir(dir), "week-10.txt"), "text");
  await writeFile(join(rankingsDir(dir), "week-09.md"), "an older draft");
  await settle();
  expect(events.count()).toBe(0);

  const text = await readFile(draftPath, "utf8");
  const notice = events.next();
  await writeFile(
    draftPath,
    text.replace("by [23.9]{ev=w10.margin}", "by [50]{ev=w10.margin}"),
  );
  await notice;
  await settle();

  expect(events.count()).toBe(1);
  expect(plainText(await page(preview.url))).toContain(
    "beat Bye Bye Bea by 50",
  );
});

test("serving the page never writes the draft, even with a claim auto-tags would tag", async () => {
  const { preview, draftPath } = await previewing();
  const text = await readFile(draftPath, "utf8");
  const edited = text.replace(
    /(## Bench Mob[^\n]*\n[^\n]*)/,
    "$1 Bench Mob are 9-1.",
  );
  expect(edited).not.toBe(text);
  await writeFile(draftPath, edited);

  await page(preview.url);

  expect(await readFile(draftPath, "utf8")).toBe(edited);
});

test("nothing is fetched from starting the preview through a save and the page after it", async () => {
  const { preview, draftPath, requests } = await previewing();

  await page(preview.url);
  const text = await readFile(draftPath, "utf8");
  await writeFile(draftPath, `${text}\n`);
  await page(preview.url);

  expect(requests).toEqual([]);
});

test("a newer draft written while the preview runs is the one shown", async () => {
  const { dir, deps, preview } = await previewing();
  await page(preview.url);
  const events = await reloads(preview.url);
  const notice = events.next();

  await draft(dir, atWeek(deps, 14));

  await notice;
  expect(plainText(await page(preview.url))).toContain(
    "after Week 14 · by rikhin",
  );
});

test("a draft that can't be read shows the CLI's message, until a good save brings the ranking back", async () => {
  const { dir, preview, draftPath } = await previewing();
  const good = await readFile(draftPath, "utf8");
  const shows = async (message: string) => {
    const html = await page(preview.url);
    expect(shown(html)).toContain(message);
    expect(html).not.toContain('class="problems"');
    expect(html).not.toContain('role="tab"');
  };

  await writeFile(draftPath, good.replace(/^---\n/, "---\nweek: [\n"));
  await shows(
    "week-10.md: the front matter isn't valid YAML; close each bracket you open; give each key only once",
  );
  await writeFile(draftPath, "");
  await shows("week-10.md has no front matter");
  await rm(draftPath);
  await shows(
    `No draft in ${rankingsDir(dir)}; run \`lazy-pundit draft\` first`,
  );
  await writeFile(draftPath, good);

  const html = await page(preview.url);
  expect(shown(panel(html))).toContain("Problems: 0 hard, 1 soft");
  expect(tabs(html)).toEqual(["Plain text*", "Tabloid", "Broadcast", "Check"]);
});

test("the preview listens on 127.0.0.1 alone, on the next port up when its port is taken", async () => {
  const { dir, deps } = await fearTheTurtle(10);
  await draft(dir, deps);
  let held: Server | undefined;
  let port = 0;
  // A free port with a free port above it, the first held.
  for (let tries = 0; !held && tries < 20; tries += 1) {
    port = await freePort();
    const above = await listening(port + 1).catch(() => undefined);
    if (!above) continue;
    await new Promise((resolve) => above.close(resolve));
    held = await listening(port).catch(() => undefined);
  }
  expect(held).toBeDefined();
  onTestFinished(() => {
    held?.close();
  });

  const preview = await startPreview(dir, deps, { port });
  onTestFinished(() => preview.stop());

  expect(preview.url).toBe(`http://127.0.0.1:${port + 1}`);
  expect((await fetch(preview.url)).status).toBe(200);
});

test("the page loads nothing from any other host", async () => {
  const { preview } = await previewing();

  const html = await page(preview.url);

  const outside = [
    ...html.matchAll(/(?:src|href)\s*=\s*["']?(https?:[^"'\s>]*)/gi),
  ].map((m) => m[1]);
  expect(outside).toEqual([]);
  expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
});

describe("the Check tab", () => {
  const BENCH_MOB =
    "2nd in points · won 9 straight · beat Bye Bye Bea by 23.9 · Clinched a playoff spot";
  const BENCH_MOB_STATS = {
    Start: ["1"],
    Record: ["9-1"],
    Rank: ["1st"],
    PPG: ["123.99"],
    "All-play": ["80-30"],
    Form: ["128.00"],
    Luck: ["1.73"],
    Streak: ["W9"],
    "Points for": ["1239.93"],
    Injuries: ["Alec Pierce (IR, Heel)", "Tyjae Spears (Questionable, Knee)"],
  };
  const INTRO =
    "Week high: Wendy's Wire 157.1 · Week low: Gus Bus 76.24 · Biggest margin: Wendy's Wire by 60.05 · Closest matchup: Snap Judgement by 7.86 · Clinched this week: Bench Mob";

  test("shows the week intro, then each blurb as the league reads it, nothing underlined", async () => {
    const { preview } = await previewing();

    const html = await page(preview.url);

    const [intro, first] = checkBlocks(html);
    expect(intro).toMatchObject({ name: "Week intro", blurb: INTRO });
    expect(intro?.underlines).toEqual([]);
    expect(first).toMatchObject({ name: "Bench Mob", blurb: BENCH_MOB });
    expect(first?.underlines).toEqual([]);
  });

  test("a wrong claim is underlined hard over exactly its words", async () => {
    const { preview, draftPath } = await previewing();
    const text = await readFile(draftPath, "utf8");
    await writeFile(
      draftPath,
      text.replace("by [23.9]{ev=w10.margin}", "by [50]{ev=w10.margin}"),
    );

    const block = checkBlock(await page(preview.url), "Bench Mob");

    expect(block.blurb).toBe(
      "2nd in points · won 9 straight · beat Bye Bye Bea by 50 · Clinched a playoff spot",
    );
    expect(block.underlines).toEqual([
      { text: "50", style: "hard", start: 53 },
    ]);

    // A comma inside the tag reads in the blurb but isn't underlined.
    await writeFile(
      draftPath,
      text.replace("by [23.9]{ev=w10.margin}", "by [50,]{ev=w10.margin}"),
    );
    const comma = checkBlock(await page(preview.url), "Bench Mob");
    expect(comma.blurb).toContain("by 50, · Clinched");
    expect(comma.underlines).toEqual([
      { text: "50", style: "hard", start: 53 },
    ]);
  });

  test("untagged claims are underlined hard and soft, never over the comma after them", async () => {
    const { preview, draftPath } = await previewing();
    const lines = (await readFile(draftPath, "utf8")).split("\n");
    lines.splice(
      27,
      0,
      "Bench Mob won by 50, and more. They are 3rd, and climbing.",
    );
    await writeFile(draftPath, lines.join("\n"));

    const block = checkBlock(await page(preview.url), "Bench Mob");

    expect(block.blurb).toBe(
      `Bench Mob won by 50, and more. They are 3rd, and climbing.\n${BENCH_MOB}`,
    );
    expect(block.underlines).toEqual([
      { text: "50", style: "hard", start: 17 },
      { text: "3rd", style: "soft", start: 40 },
    ]);
  });

  test("a provisional claim is underlined soft", async () => {
    const ws = await onStandings(8);
    ws.deps.transport = patchingTransport(ws.deps.transport, {
      [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`]: (league: Json) => {
        league.settings.last_scored_leg = 7;
      },
    });
    const { path } = await draft(ws.dir, ws.deps, { includeInProgress: true });
    const gus = "## Gus Bus {team=sleeper:1}\n";
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace(gus, `${gus}They have [133.22]{ev=w8.points} so far.\n`),
    );

    const html = await served(ws.dir, ws.deps);

    expect(checkBlock(html, "Gus Bus").underlines).toContainEqual({
      text: "133.22",
      style: "soft",
      start: 10,
    });
  });

  test("with no intro in the draft, the first block is the first team's", async () => {
    const { preview, draftPath } = await previewing();
    const text = await readFile(draftPath, "utf8");
    const edited = text.replace(/## Intro \{intro\}\n[^\n]*\n\n/, "");
    expect(edited).not.toBe(text);
    await writeFile(draftPath, edited);

    const html = await page(preview.url);

    expect(checkBlocks(html)[0]?.name).toBe("Bench Mob");
    expect(shown(tab(html, "check"))).not.toContain("Week intro");
  });

  test("each team shows its place beside its starting place, as the file stands", async () => {
    const { preview, draftPath } = await previewing();

    expect(checkBlock(await page(preview.url), "Bench Mob")).toMatchObject({
      place: "1",
      start: "1",
      mark: "(new)",
    });

    const text = await readFile(draftPath, "utf8");
    await writeFile(
      draftPath,
      text
        .replace("{team=sleeper:3}", "{team=FIRST}")
        .replace("{team=sleeper:11}", "{team=sleeper:3}")
        .replace("{team=FIRST}", "{team=sleeper:11}"),
    );
    const html = await page(preview.url);

    expect(checkBlocks(html).slice(1, 3)).toMatchObject([
      { name: "Bye Bye Bea", place: "1", start: "2" },
      { name: "Bench Mob", place: "2", start: "1" },
    ]);
  });

  test("each team's movement since the last publish, with the week it's since when that isn't last week", async () => {
    const lastWeek = await fearTheTurtle(9);
    await draft(lastWeek.dir, lastWeek.deps);
    await published(lastWeek.dir, lastWeek.deps);
    const weekLater = atWeek(lastWeek.deps, 10);
    await draft(lastWeek.dir, weekLater);

    const html = await served(lastWeek.dir, weekLater);

    expect(checkBlock(html, "Bench Mob").mark).toBe("(▲1)");
    expect(checkBlock(html, "Bye Bye Bea").mark).toBe("(▼1)");
    expect(checkBlock(html, "Snap Judgement").mark).toBe("(▲3)");
    expect(shown(tab(html, "check"))).not.toContain("Movement since");

    const twoBack = await fearTheTurtle(8);
    await draft(twoBack.dir, twoBack.deps);
    await published(twoBack.dir, twoBack.deps);
    const later = atWeek(twoBack.deps, 10);
    await draft(twoBack.dir, later);

    const since = await served(twoBack.dir, later);

    expect(
      shown(tab(since, "check")).split("Movement since week 8"),
    ).toHaveLength(2);
    expect(checkBlock(since, "Bench Mob").mark).toBe("(—)");
    expect(checkBlock(since, "Snap Judgement").mark).toBe("(▲1)");
  });

  test("each team's stats panel, the method named once and no power score shown", async () => {
    const { preview } = await previewing();

    const html = await page(preview.url);

    expect(checkBlock(html, "Bench Mob").stats).toEqual(BENCH_MOB_STATS);
    // The method is named once, and no power score beside it or anywhere:
    // every panel's labels are the ones above.
    const words = shown(tab(html, "check"));
    expect(words.split("ramped blend")).toHaveLength(2);
    expect(words.match(/power.score/gi)).toEqual(["Power-score"]);
    for (const { stats } of checkBlocks(html).filter((b) => b.place)) {
      expect(Object.keys(stats)).toEqual(Object.keys(BENCH_MOB_STATS));
    }
  });

  test("an injury without a body part shows its status alone, and a team with nobody hurt reads none", async () => {
    const { dir, deps } = await fearTheTurtle(10);
    const patched = patchingTransport(deps.transport, {
      [`${SLEEPER_API}/players/nfl`]: (players: Json) => {
        for (const p of Object.values(players) as Json[]) {
          if (`${p.first_name} ${p.last_name}` === "Alec Pierce") {
            p.injury_body_part = null;
          } else {
            p.injury_status = null;
          }
        }
      },
    });
    await draft(dir, { ...deps, transport: patched });

    const html = await served(dir, deps);

    expect(checkBlock(html, "Bench Mob").stats.Injuries).toEqual([
      "Alec Pierce (IR)",
    ]);
    expect(checkBlock(html, "Bye Bye Bea").stats.Injuries).toEqual(["none"]);
  });

  test("at week 0 each stat shows the missing mark", async () => {
    const ws = await fearTheTurtle(1);
    ws.deps.transport = patchingTransport(ws.deps.transport, {
      [`${SLEEPER_API}/league/${FEAR_THE_TURTLE_ID}`]: (league: Json) => {
        league.settings.last_scored_leg = 0;
      },
    });
    await draft(ws.dir, ws.deps);

    const teams = checkBlocks(await served(ws.dir, ws.deps)).filter(
      (b) => b.place,
    );

    expect(teams).toHaveLength(12);
    for (const { stats, mark } of teams) {
      // Nothing to move from before the season, as the plain text shows it.
      expect(mark).toBeUndefined();
      const { Start, Injuries, ...rest } = stats;
      expect(Start).toEqual([expect.stringMatching(/^\d+$/)]);
      expect(Object.keys(rest)).toHaveLength(8);
      for (const values of Object.values(rest)) expect(values).toEqual(["—"]);
      expect(Injuries?.length).toBeGreaterThan(0);
    }
  });
});
