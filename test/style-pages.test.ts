import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { draft, PublishWriteError, publish } from "../src/index.ts";
import {
  atWeek,
  fearTheTurtle,
  highScore,
  linkHandles,
  noClipboard,
  published,
  rankingsDir,
  writeLeagueFile,
} from "./support/workspace.ts";

/**
 * Fear The Turtle drafted at `week` without an LLM, with `league.md`'s
 * `fields` and `handles` linked, if given.
 */
async function drafted(week: number, fields?: string, handles?: string[]) {
  const ws = await fearTheTurtle(week);
  if (fields !== undefined) await writeLeagueFile(ws.dir, fields);
  if (handles) await linkHandles(ws.dir, handles);
  const result = await draft(ws.dir, ws.deps);
  return { ...ws, path: result.path };
}

function stylePath(
  dir: string,
  week: number,
  style: "tabloid" | "broadcast",
): string {
  return join(
    rankingsDir(dir),
    `week-${String(week).padStart(2, "0")}.${style}.html`,
  );
}

function tabloidPath(dir: string, week: number): string {
  return stylePath(dir, week, "tabloid");
}

async function tabloid(dir: string, week: number): Promise<string> {
  return readFile(tabloidPath(dir, week), "utf8");
}

function broadcastPath(dir: string, week: number): string {
  return stylePath(dir, week, "broadcast");
}

async function broadcast(dir: string, week: number): Promise<string> {
  return readFile(broadcastPath(dir, week), "utf8");
}

/** Fails if `html` references anything outside itself, or shows a tag or tool-internal flag. */
function expectSelfContained(html: string): void {
  expect(html).toMatch(/^<!doctype html>/);
  expect(html).toContain('name="viewport"');
  expect(html).not.toMatch(/https?:|\/\/|url\(|@import|<script|<link|src=/i);
  const text = textOf(html);
  expect(text).not.toMatch(
    /\{(ev|lore|stakes|log|team|intro)\b|\]\{|\[[^\]]*\]\{/,
  );
  expect(text).not.toMatch(/power score|small-sample|auto-tag|\{|\}/i);
}

/** The text a viewer reads in `html`, tags removed and entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The awards as label → what it says, in page order: Tabloid's awards box,
 * or Broadcast's award chips with `list` "chips".
 */
function awardsOn(html: string, list = "awards"): [string, string][] {
  const box =
    html.match(new RegExp(`<ul class="${list}">([\\s\\S]*?)</ul>`))?.[1] ?? "";
  return [...box.matchAll(/<li><b>(.*?)<\/b>(.*?)<\/li>/g)].map((m) => [
    textOf(m[1] ?? ""),
    textOf(m[2] ?? ""),
  ]);
}

/** The text of the element with class `cls`, or undefined. */
function partOf(html: string, cls: string): string | undefined {
  const m = html.match(new RegExp(`<(\\w+) class="${cls}">([\\s\\S]*?)</\\1>`));
  return m ? textOf(m[2] ?? "") : undefined;
}

describe("the Tabloid style page", () => {
  test("publish writes week-NN.tabloid.html beside the text, with no external URL, tag or tool-internal flag", async () => {
    const ws = await drafted(10);
    const result = await published(ws.dir, ws.deps);
    const html = await tabloid(ws.dir, 10);

    expect(result.stylePaths).toEqual([
      tabloidPath(ws.dir, 10),
      broadcastPath(ws.dir, 10),
    ]);
    expectSelfContained(html);
    const text = textOf(html);
    expect(text).toContain("after Week 10");
    expect(text).toMatch(/Stats: Sleeper · made with Lazy Pundit/);
    // Every team, in the draft's order, with its record.
    for (const name of ["Bench Mob", "Gus Bus", "Hail Mary Hustle"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("Bench Mob 9-1");
  });

  test("awards on week 10 match the evidence pack's wk.* values, in order", async () => {
    const ws = await drafted(10);
    await published(ws.dir, ws.deps);
    // Hand-checked against `npm run fixture:show -- 10 --model`.
    expect(awardsOn(await tabloid(ws.dir, 10))).toEqual([
      ["Top score", "Wendy's Wire · 157.1"],
      ["Low score", "Gus Bus · 76.24"],
      // Wendy's Wire 157.1 v Pylon Patrol 97.05.
      ["Biggest margin", "Wendy's Wire by 60.05"],
      // Snap Judgement 124.5 v Red Zone Rascals 116.64.
      ["Closest matchup", "Snap Judgement by 7.86"],
      // Hail Mary Hustle, 1-8 going in, beat Gus Bus.
      ["Upset", "Hail Mary Hustle over Gus Bus"],
      // The highest score in a loss: Bye Bye Bea's 119.92 to Bench Mob.
      ["Robbed", "Bye Bye Bea · 119.92 in a loss"],
      // Week 10 clinches Bench Mob alone.
      ["Clinched this week", "Bench Mob"],
    ]);
  });

  test("week 1 has no upset, since no team has an all-play record going in, so there's no Upset award", async () => {
    const ws = await drafted(1);
    await published(ws.dir, ws.deps);
    const labels = awardsOn(await tabloid(ws.dir, 1)).map(([label]) => label);
    expect(labels).toContain("Top score");
    expect(labels).not.toContain("Upset");
  });

  test("house-rule triggers and rivalry results are awards, and with no league.md neither is there", async () => {
    // Week 8: Gus Bus plays Pylon Patrol, and Gus Bus's 133.22 is the high.
    const ws = await drafted(
      8,
      `house-rules:
${highScore()}rivalry-weeks:
  - week: 8
    pairs: [[gus, pete]]
`,
      ["gus", "pete"],
    );
    await published(ws.dir, ws.deps);
    const awards = awardsOn(await tabloid(ws.dir, 8));
    expect(awards).toContainEqual(["Weekly high score", "Gus Bus"]);
    expect(awards).toContainEqual([
      "Rivalry week",
      "Gus Bus and Pylon Patrol, won by Gus Bus",
    ]);

    const plain = await drafted(8);
    await published(plain.dir, plain.deps);
    const html = await tabloid(plain.dir, 8);
    const labels = awardsOn(html).map(([label]) => label);
    expect(labels).not.toContain("Weekly high score");
    expect(labels).not.toContain("Rivalry week");
    // Week 8 clinches no one: no award, and no empty one.
    expect(labels).not.toContain("Clinched this week");
    expect(textOf(html)).not.toMatch(/Clinched|Rivalry/);
    expect(awardsOn(html).every(([, says]) => says !== "")).toBe(true);
  });

  test("the week intro is the headline; pull quotes are each blurb's first sentence", async () => {
    const ws = await drafted(10);
    const text = await readFile(ws.path, "utf8");
    await writeFile(
      ws.path,
      text
        .replace(
          /## Intro \{intro\}\n[\s\S]*?\n(?=## )/,
          "## Intro {intro}\nChaos at the top. Everyone else just watched.\n\n",
        )
        .replace(
          /(## Bench Mob \{team=sleeper:3\}\n)[^\n]*\n/,
          "$1Unstoppable again. They won by plenty.\n",
        ),
    );
    await published(ws.dir, ws.deps);
    const html = await tabloid(ws.dir, 10);
    expect(partOf(html, "headline")).toBe("Chaos at the top.");
    expect(partOf(html, "standfirst")).toBe("Everyone else just watched.");
    expect(textOf(html)).toContain("“Unstoppable again.”");
    expect(textOf(html)).not.toContain("They won by plenty.");
  });

  test("with no LLM, the intro's league stat line repeats the awards, so there's no headline; each team's stat line shows whole, unquoted", async () => {
    const ws = await drafted(10);
    await published(ws.dir, ws.deps);
    const html = await tabloid(ws.dir, 10);
    expect(partOf(html, "headline")).toBeUndefined();
    expect(textOf(html)).not.toContain("Week high:");
    expect(textOf(html)).not.toContain("“");
    expect(partOf(html, "statline")).toBe(
      "2nd in points · won 9 straight · beat Bye Bye Bea by 23.9 · Clinched a playoff spot",
    );

    // An edited stat line is the pundit's prose: a headline and a quote.
    const text = await readFile(ws.path, "utf8");
    await writeFile(
      ws.path,
      text
        .replace(/(## Intro \{intro\}\n)/, "$1Bench Mob clinched. ")
        .replace(
          /(## Bench Mob \{team=sleeper:3\}\n)/,
          "$1Still perfect-ish. ",
        ),
    );
    await published(ws.dir, ws.deps);
    const edited = await tabloid(ws.dir, 10);
    expect(partOf(edited, "headline")).toBe("Bench Mob clinched.");
    expect(textOf(edited)).toContain("“Still perfect-ish.”");
  });

  test("correction lines go in a correction note, never the headline; with nothing else, there's no headline", async () => {
    const ws = await drafted(10);
    const text = await readFile(ws.path, "utf8");
    const correction =
      "[Correction from week 7: Gus Bus beat Bench Mob after all]{ev=w7.correction}";
    await writeFile(
      ws.path,
      text.replace(
        /## Intro \{intro\}\n[\s\S]*?\n(?=## )/,
        `## Intro {intro}\n${correction}\nWhat a week.\n\n`,
      ),
    );
    // The made-up item is a hard problem, so publish anyway.
    await publish(ws.dir, ws.deps, { yes: true });
    let html = await tabloid(ws.dir, 10);
    expect(partOf(html, "headline")).toBe("What a week.");
    expect(partOf(html, "correction")).toBe(
      "Correction from week 7: Gus Bus beat Bench Mob after all",
    );

    await writeFile(
      ws.path,
      text.replace(
        /## Intro \{intro\}\n[\s\S]*?\n(?=## )/,
        `## Intro {intro}\n${correction}\n\n`,
      ),
    );
    await publish(ws.dir, ws.deps, { yes: true });
    html = await tabloid(ws.dir, 10);
    expect(partOf(html, "headline")).toBeUndefined();
    expect(partOf(html, "correction")).toBe(
      "Correction from week 7: Gus Bus beat Bench Mob after all",
    );
  });

  test("a ranking with no intro has no headline, and no correction note", async () => {
    const ws = await drafted(10);
    const text = await readFile(ws.path, "utf8");
    await writeFile(
      ws.path,
      text.replace(/## Intro \{intro\}\n[\s\S]*?\n(?=## )/, ""),
    );
    await published(ws.dir, ws.deps);
    const html = await tabloid(ws.dir, 10);
    expect(partOf(html, "headline")).toBeUndefined();
    expect(partOf(html, "correction")).toBeUndefined();
    expect(textOf(html)).toContain("Bench Mob");
  });

  test("movement is shown as in the text, with the same 'Movement since' line", async () => {
    const ws = await drafted(8);
    await published(ws.dir, ws.deps);
    // Week 10 after week 8's publish: movement since week 8.
    const deps = atWeek(ws.deps, 10);
    await draft(ws.dir, deps);
    const result = await published(ws.dir, deps);
    const text = textOf(await tabloid(ws.dir, 10));
    expect(result.text).toContain("Movement since week 8");
    expect(text).toContain("Movement since week 8");
    for (const mark of result.text.match(/\((▲\d+|▼\d+|—|new)\)/g) ?? []) {
      expect(text).toContain(mark);
    }
  });

  test("a style page that can't be written fails publish after the text is written and copied, saying what was done and the fix", async () => {
    const ws = await drafted(10);
    // A folder where the page goes makes its write fail.
    await mkdir(tabloidPath(ws.dir, 10));
    const failed = publish(ws.dir, ws.deps);
    await expect(failed).rejects.toThrow(PublishWriteError);
    // An error instance makes toThrow compare the whole message.
    await expect(failed).rejects.toThrow(
      new PublishWriteError(
        "Published week 10 as edition 1, wrote its text to pundits/rikhin/2025/week-10.txt and copied it to the clipboard, but couldn't write the Tabloid page to pundits/rikhin/2025/week-10.tabloid.html: it's a folder. The Broadcast page wasn't written either. Move or remove that folder, then run `lazy-pundit publish` again in the league's workspace; that publishes week 10 as edition 2.",
      ),
    );
    expect(existsSync(join(rankingsDir(ws.dir), "week-10.txt"))).toBe(true);
    expect(ws.clipboard.copied).toHaveLength(1);
  });

  test("a Broadcast page that can't be written says the Tabloid page was written, and a clipboard that isn't there", async () => {
    const ws = await drafted(10);
    await mkdir(broadcastPath(ws.dir, 10));
    await expect(
      publish(ws.dir, { ...ws.deps, clipboard: noClipboard() }),
    ).rejects.toThrow(
      new PublishWriteError(
        "Published week 10 as edition 1, wrote its text to pundits/rikhin/2025/week-10.txt (no clipboard found; paste from the .txt file) and the Tabloid page to pundits/rikhin/2025/week-10.tabloid.html, but couldn't write the Broadcast page to pundits/rikhin/2025/week-10.broadcast.html: it's a folder. Move or remove that folder, then run `lazy-pundit publish` again in the league's workspace; that publishes week 10 as edition 2.",
      ),
    );
    expect(existsSync(tabloidPath(ws.dir, 10))).toBe(true);
  });

  test("a week-NN.txt that can't be written fails publish before the clipboard copy and the style pages", async () => {
    const ws = await drafted(10);
    await mkdir(join(rankingsDir(ws.dir), "week-10.txt"));
    const failed = publish(ws.dir, ws.deps);
    await expect(failed).rejects.toThrow(PublishWriteError);
    await expect(failed).rejects.toThrow(
      new PublishWriteError(
        "Published week 10 as edition 1, but couldn't write its text to pundits/rikhin/2025/week-10.txt: it's a folder. The text wasn't copied, and no style page was written. Move or remove that folder, then run `lazy-pundit publish` again in the league's workspace; that publishes week 10 as edition 2.",
      ),
    );
    expect(ws.clipboard.copied).toHaveLength(0);
    expect(existsSync(tabloidPath(ws.dir, 10))).toBe(false);
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "a read-only style page on a republish says it isn't allowed to write there, and to make it writable",
    async () => {
      const ws = await drafted(10);
      await publish(ws.dir, ws.deps);
      await chmod(broadcastPath(ws.dir, 10), 0o444);
      try {
        await expect(publish(ws.dir, ws.deps)).rejects.toThrow(
          new PublishWriteError(
            "Published week 10 as edition 2, wrote its text to pundits/rikhin/2025/week-10.txt and copied it to the clipboard and the Tabloid page to pundits/rikhin/2025/week-10.tabloid.html, but couldn't write the Broadcast page to pundits/rikhin/2025/week-10.broadcast.html: Lazy Pundit isn't allowed to write there. Make the file and its folder writable, then run `lazy-pundit publish` again in the league's workspace; that publishes week 10 as edition 3.",
          ),
        );
      } finally {
        await chmod(broadcastPath(ws.dir, 10), 0o644);
      }
    },
  );

  // A folder at the frozen copy's path stops `checkDraft`'s read before any
  // write, so only a folder that can't be written to reaches this. Root and
  // Windows write past the mode bits.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "a frozen copy that can't be written says nothing was published, and writes nothing else",
    async () => {
      const ws = await drafted(10);
      const season = rankingsDir(ws.dir);
      await chmod(season, 0o555);
      try {
        const failed = publish(ws.dir, ws.deps);
        await expect(failed).rejects.toThrow(
          new PublishWriteError(
            "Week 10 wasn't published: couldn't write its frozen copy to pundits/rikhin/2025/week-10.published.md: Lazy Pundit isn't allowed to write there. Nothing else was written or copied. Make the file and its folder writable, then run `lazy-pundit publish` again in the league's workspace.",
          ),
        );
        await expect(failed).rejects.toThrow(PublishWriteError);
      } finally {
        await chmod(season, 0o755);
      }
      expect(existsSync(join(season, "week-10.txt"))).toBe(false);
      expect(ws.clipboard.copied).toHaveLength(0);
    },
  );

  test("publish run again once the way is cleared goes through as the next edition", async () => {
    const ws = await drafted(10);
    const blocked = join(rankingsDir(ws.dir), "week-10.txt");
    await mkdir(blocked);
    await expect(publish(ws.dir, ws.deps)).rejects.toThrow(PublishWriteError);
    await rm(blocked, { recursive: true });
    const result = await publish(ws.dir, ws.deps);
    expect(result.published).toBe(true);
    const frozen = await readFile(
      join(rankingsDir(ws.dir), "week-10.published.md"),
      "utf8",
    );
    expect(frozen).toMatch(/^edition: 2$/m);
    expect(ws.clipboard.copied).toHaveLength(1);
  });

  test("a publish held back to editing writes no style page", async () => {
    const ws = await drafted(10);
    const text = await readFile(ws.path, "utf8");
    await writeFile(
      ws.path,
      text.replace(
        /## Intro \{intro\}\n/,
        "## Intro {intro}\nGus Bus scored [999]{ev=w10.points}.\n",
      ),
    );
    const result = await publish(ws.dir, ws.deps, {
      confirm: async () => false,
    });
    expect(result.published).toBe(false);
    expect(existsSync(tabloidPath(ws.dir, 10))).toBe(false);
    expect(existsSync(broadcastPath(ws.dir, 10))).toBe(false);
  });
});

describe("the Broadcast style page", () => {
  test("publish writes week-NN.broadcast.html, with no external URL, tag or tool-internal flag", async () => {
    const ws = await drafted(10);
    await published(ws.dir, ws.deps);
    const html = await broadcast(ws.dir, 10);

    expectSelfContained(html);
    const text = textOf(html);
    expect(text).toContain("Power Rankings");
    expect(text).toContain("after Week 10");
    expect(text).toMatch(/Stats: Sleeper · made with Lazy Pundit/);
    // Each row: its big place number, the team and its record.
    expect(partOf(html, "row")).toMatch(/^1 Bench Mob 9-1\b/);
    for (const name of ["Gus Bus", "Hail Mary Hustle"]) {
      expect(text).toContain(name);
    }
  });

  test("the award chips are the week's awards, as in Tabloid's awards box; one with no candidate is absent", async () => {
    const ws = await drafted(10);
    await published(ws.dir, ws.deps);
    const chips = awardsOn(await broadcast(ws.dir, 10), "chips");
    expect(chips[0]).toEqual(["Top score", "Wendy's Wire · 157.1"]);
    expect(chips).toContainEqual(["Upset", "Hail Mary Hustle over Gus Bus"]);
    expect(chips).toEqual(awardsOn(await tabloid(ws.dir, 10)));

    const rules = await drafted(
      8,
      `house-rules:
${highScore()}rivalry-weeks:
  - week: 8
    pairs: [[gus, pete]]
`,
      ["gus", "pete"],
    );
    await published(rules.dir, rules.deps);
    const html = await broadcast(rules.dir, 8);
    const week8 = awardsOn(html, "chips");
    expect(week8).toContainEqual(["Weekly high score", "Gus Bus"]);
    expect(week8).toContainEqual([
      "Rivalry week",
      "Gus Bus and Pylon Patrol, won by Gus Bus",
    ]);
    // Week 8 clinches no one: no chip, and no empty one.
    expect(textOf(html)).not.toContain("Clinched");
    expect(week8.every(([, says]) => says !== "")).toBe(true);
  });

  test("'The week' strip holds the whole intro and its correction note; each row has its blurb's first sentence", async () => {
    const ws = await drafted(10);
    const text = await readFile(ws.path, "utf8");
    await writeFile(
      ws.path,
      text
        .replace(
          /## Intro \{intro\}\n[\s\S]*?\n(?=## )/,
          "## Intro {intro}\n[Correction from week 7: Gus Bus beat Bench Mob after all]{ev=w7.correction}\nChaos at the top. Everyone else just watched.\n\n",
        )
        .replace(
          /(## Bench Mob \{team=sleeper:3\}\n)[^\n]*\n/,
          "$1Unstoppable again. They won by plenty.\n",
        ),
    );
    // The made-up item is a hard problem, so publish anyway.
    await publish(ws.dir, ws.deps, { yes: true });
    const html = await broadcast(ws.dir, 10);
    expect(partOf(html, "intro")).toBe(
      "Chaos at the top. Everyone else just watched.",
    );
    expect(partOf(html, "correction")).toBe(
      "Correction from week 7: Gus Bus beat Bench Mob after all",
    );
    expect(partOf(html, "week")).toMatch(/^The week /);
    expect(partOf(html, "quote")).toBe("Unstoppable again.");
    expect(textOf(html)).not.toContain("They won by plenty.");
  });

  test("with no LLM, or no intro, there's no 'The week' strip; each team's stat line shows whole", async () => {
    const ws = await drafted(10);
    await published(ws.dir, ws.deps);
    const html = await broadcast(ws.dir, 10);
    expect(partOf(html, "week")).toBeUndefined();
    expect(textOf(html)).not.toContain("Week high:");
    expect(partOf(html, "statline")).toBe(
      "2nd in points · won 9 straight · beat Bye Bye Bea by 23.9 · Clinched a playoff spot",
    );

    const text = await readFile(ws.path, "utf8");
    await writeFile(
      ws.path,
      text.replace(/## Intro \{intro\}\n[\s\S]*?\n(?=## )/, ""),
    );
    await published(ws.dir, ws.deps);
    expect(partOf(await broadcast(ws.dir, 10), "week")).toBeUndefined();
  });

  test("movement is shown as in the text, with the same 'Movement since' line", async () => {
    const ws = await drafted(8);
    await published(ws.dir, ws.deps);
    const deps = atWeek(ws.deps, 10);
    await draft(ws.dir, deps);
    const result = await published(ws.dir, deps);
    const text = textOf(await broadcast(ws.dir, 10));
    expect(text).toContain("Movement since week 8");
    const marks = result.text.match(/\((▲\d+|▼\d+|—|new)\)/g) ?? [];
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) expect(text).toContain(mark);
  });
});
