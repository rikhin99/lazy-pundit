import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, draft, draftData, PRESETS, publish } from "../src/index.ts";
import { validate } from "../src/validator.ts";
import { scriptedLlm } from "./support/llm.ts";
import { blurb } from "./support/week8-evidence.ts";
import { atWeek, committed, fearTheTurtle } from "./support/workspace.ts";

const KEY = "sk-ant-api03-test-key";

/** Week 8's reply: a blurb per team from its checked stat line, and an intro. */
function week8Reply(blurb = "Steady as ever."): Promise<string> {
  return reply(8, blurb);
}

function week9Reply(): Promise<string> {
  return reply(9, "Steady as ever.");
}

async function reply(week: number, blurb: string): Promise<string> {
  const data = draftData(await committed(week), week);
  return [
    `## {intro}\nWhat a week. ${data.intro}`,
    ...Object.entries(data.teams).map(
      ([id, t]) => `## {team=${id}}\n${blurb} ${t.statLine}`,
    ),
  ].join("\n\n");
}

/** Fear The Turtle week 8 with a key, a scripted LLM and `persona.md`. */
async function withPersona(persona: string | null, ...replies: string[]) {
  const ws = await fearTheTurtle(8);
  const llm = scriptedLlm(...(replies.length ? replies : [await week8Reply()]));
  ws.deps.llm = llm;
  ws.deps.env.anthropicApiKey = KEY;
  if (persona !== null) await writePersona(ws.dir, persona);
  return { ...ws, llm };
}

async function writePersona(dir: string, text: string): Promise<void> {
  await mkdir(join(dir, "pundits", "rikhin"), { recursive: true });
  await writeFile(join(dir, "pundits", "rikhin", "persona.md"), text);
}

/** The Persona part of a prompt. */
function personaPart(prompt: string | undefined): string {
  return /## Persona\n([^\n]*)\n/.exec(prompt ?? "")?.[1] ?? "";
}

describe("persona.md", () => {
  test("its preset's tone controls reach the prompt", async () => {
    const { dir, deps, llm } = await withPersona(
      "---\nformat: 1\npreset: banter\n---\n",
    );

    await draft(dir, deps);

    const part = personaPart(llm.requests[0]?.prompt);
    expect(part).toContain("Mild swearing is fine.");
    expect(part).toContain("Light, friendly teasing only.");
    expect(part).toContain("Keep it conversational.");
    expect(part).toContain("prose, 2 to 3 sentences");
  });

  test("overrides win over the preset, and the style note joins the preset's", async () => {
    const { dir, deps, llm } = await withPersona(
      "---\nformat: 1\npreset: roast\nswearing: off\nteasing: light\nformality: formal\nshape: bullets\nlength: 1–2\n---\nTalk like a ship's captain.\n",
    );

    await draft(dir, deps);

    const part = personaPart(llm.requests[0]?.prompt);
    expect(part).toMatch(
      /^A roast comic with the mic: .* Talk like a ship's captain\. No swearing at all\. Light, friendly teasing only\. Keep it polished\. Write each blurb and the intro as 1 to 2 bullets/,
    );
  });

  test("with no persona.md, the draft is Broadcast", async () => {
    const { dir, deps, llm } = await withPersona(null);

    const result = await draft(dir, deps);

    expect(personaPart(llm.requests[0]?.prompt)).toMatch(
      /^A studio host calling the week: .* No swearing at all\. Light, friendly teasing only\. Keep it polished\./,
    );
    expect(await readFile(result.path, "utf8")).toContain(
      "persona:\n  preset: broadcast\n  swearing: off\n  teasing: light\n  formality: formal\n  shape: prose\n  length: 2-3\n  intro: on\n  family_league_relaxed: false\n",
    );
  });

  test("changing it changes the next draft and its recorded persona", async () => {
    const { dir, deps, llm } = await withPersona(
      "---\nformat: 1\npreset: banter\n---\n",
      await week8Reply(),
      await week9Reply(),
    );
    await draft(dir, deps);
    await publish(dir, deps, { yes: true });
    await writePersona(
      dir,
      "---\nformat: 1\npreset: family\nlength: 3\n---\nKeep it sunny.\n",
    );

    const result = await draft(dir, atWeek(deps, 9));

    expect(personaPart(llm.requests[1]?.prompt)).toMatch(
      /^A friendly host .* Keep it sunny\. No swearing at all\. .* as prose, 3 sentences\./,
    );
    expect(await readFile(result.path, "utf8")).toContain(
      "persona:\n  preset: family\n  swearing: off\n  teasing: light\n  formality: casual\n  shape: prose\n  length: 3-3\n  intro: on\n  style_note: Keep it sunny.\n  family_league_relaxed: false\n",
    );
  });

  test.each([
    [
      "an unknown key",
      "---\nformat: 1\npreset: banter\nmood: grumpy\n---\n",
      /persona\.md: .*mood/s,
    ],
    [
      "an unknown preset",
      "---\nformat: 1\npreset: gonzo\n---\n",
      /persona\.md: .*preset/s,
    ],
    [
      "a braced tag",
      "---\nformat: 1\npreset: banter\n---\nLike {lore=League} says.\n",
      /persona\.md uses no tags.*line 5: \{lore=League\}/,
    ],
  ])("%s is a load error, and nothing is drafted", async (_, text, error) => {
    const { dir, deps, llm } = await withPersona(text);

    await expect(draft(dir, deps)).rejects.toThrow(error);
    expect(llm.requests).toHaveLength(0);
  });
});

/** Turns the 2025 season's family league on or off in its `league.md`. */
async function writeFamilyLeague(dir: string, setting: "on" | "off") {
  await mkdir(join(dir, "seasons", "2025"), { recursive: true });
  await writeFile(
    join(dir, "seasons", "2025", "league.md"),
    `---\nleague: 1\nseason: 2025\nfamily-league: ${setting}\n---\n`,
  );
}

const ROAST = "---\nformat: 1\npreset: roast\n---\n";
const RELAXED_ROAST =
  "---\nformat: 1\npreset: roast\nfamily-league: relaxed\n---\n";

describe("a family league", () => {
  test("lowers a Roast persona to no swearing and light teasing, with a warning", async () => {
    const { dir, deps, llm } = await withPersona(ROAST);
    await writeFamilyLeague(dir, "on");

    const result = await draft(dir, deps);

    const part = personaPart(llm.requests[0]?.prompt);
    expect(part).toContain(
      "No swearing at all. Light, friendly teasing only. Go as wild as you like.",
    );
    expect(result.warnings).toEqual([
      'The family league is on, so persona.md\'s swearing (on) is lowered to off and its teasing (roast) to light. To keep them, add "family-league: relaxed" to persona.md.',
    ]);
    expect(await readFile(result.path, "utf8")).toContain(
      "  swearing: off\n  teasing: light\n  formality: unhinged\n",
    );
  });

  test("leaves a persona within the cap as it is, without a warning", async () => {
    const { dir, deps, llm } = await withPersona(
      "---\nformat: 1\npreset: family\nteasing: none\n---\n",
    );
    await writeFamilyLeague(dir, "on");

    const result = await draft(dir, deps);

    expect(personaPart(llm.requests[0]?.prompt)).toContain(
      "Don't tease anyone.",
    );
    expect(result.warnings).toEqual([]);
  });

  test("off leaves Roast as it is", async () => {
    const { dir, deps, llm } = await withPersona(RELAXED_ROAST);
    await writeFamilyLeague(dir, "off");

    const result = await draft(dir, deps);

    expect(personaPart(llm.requests[0]?.prompt)).toContain(
      "Swearing is fine. Roast freely.",
    );
    expect(result.warnings).toEqual([]);
    expect(await readFile(result.path, "utf8")).toContain(
      "  family_league_relaxed: false\n",
    );
  });

  test("a relaxed persona keeps its controls, warns on every load and is recorded", async () => {
    const { dir, deps, llm } = await withPersona(RELAXED_ROAST);
    await writeFamilyLeague(dir, "on");

    const result = await draft(dir, deps);

    expect(personaPart(llm.requests[0]?.prompt)).toContain(
      "Swearing is fine. Roast freely.",
    );
    expect(result.warnings).toEqual([
      "The family league is on, but persona.md relaxes it (family-league: relaxed): swearing on, teasing roast. Publishing with it asks you to confirm the first time and whenever the persona changes.",
    ]);
    expect(await readFile(result.path, "utf8")).toContain(
      "  family_league_relaxed: true\n",
    );
  });
});

describe("swearing", () => {
  test("allowed by the persona, a word-list hit passes the gate and isn't listed", async () => {
    const { dir, deps, llm } = await withPersona(
      "---\nformat: 1\npreset: banter\n---\n",
      await week8Reply("Damn, steady as ever."),
    );

    const result = await draft(dir, deps);

    expect(llm.requests).toHaveLength(1);
    expect(result.problems).toEqual([]);
    expect((await check(dir, deps)).problems).toEqual([]);
  });

  test("off, the same word in a pundit edit only warns", async () => {
    const { dir, deps } = await withPersona(
      "---\nformat: 1\npreset: family\n---\n",
    );
    const { path } = await draft(dir, deps);
    const text = await readFile(path, "utf8");
    await writeFile(path, text.replace("What a week.", "What a damn week."));

    const result = await check(dir, deps);

    const line = text.split("\n").indexOf("## Intro {intro}") + 2;
    expect(result.problems).toEqual([
      {
        team: null,
        section: "Intro",
        severity: "soft",
        line,
        text: "damn",
        kind: "swear",
        reason: "on the word list, and swearing is off",
      },
    ]);
    const published = await publish(dir, deps);
    expect(published.published).toBe(true);
  });
});

/** A publish confirm for a relaxed persona that answers `yes` and counts its asks. */
function relaxedConfirm(yes: boolean) {
  const asked: unknown[] = [];
  return {
    asked,
    confirmRelaxed: async (persona: unknown) => {
      asked.push(persona);
      return yes;
    },
  };
}

describe("publishing with a relaxed family-league persona", () => {
  async function relaxedWeek8() {
    const ws = await withPersona(
      RELAXED_ROAST,
      await week8Reply(),
      await week9Reply(),
    );
    await writeFamilyLeague(ws.dir, "on");
    await draft(ws.dir, ws.deps);
    return ws;
  }

  test("asks the first time, and No leaves it unpublished", async () => {
    const { dir, deps, clipboard } = await relaxedWeek8();
    const no = relaxedConfirm(false);

    const result = await publish(dir, deps, no);

    expect(no.asked).toEqual([
      expect.objectContaining({
        preset: "roast",
        swearing: "on",
        teasing: "roast",
        family_league_relaxed: true,
      }),
    ]);
    expect(result).toMatchObject({ published: false, stoppedBy: "relaxed" });
    expect(clipboard.copied).toEqual([]);
  });

  test("with no one to ask, it's No", async () => {
    const { dir, deps } = await relaxedWeek8();

    expect(await publish(dir, deps)).toMatchObject({ published: false });
  });

  test("doesn't ask again for the same persona, next week or on a republish", async () => {
    const { dir, deps } = await relaxedWeek8();
    expect(await publish(dir, deps, relaxedConfirm(true))).toMatchObject({
      published: true,
    });
    const week9 = atWeek(deps, 9);
    await draft(dir, week9);
    const same = relaxedConfirm(false);
    expect(await publish(dir, week9, same)).toMatchObject({ published: true });
    expect(same.asked).toHaveLength(0);

    const again = relaxedConfirm(false);
    expect(await publish(dir, week9, again)).toMatchObject({ published: true });
    expect(again.asked).toHaveLength(0);
  });

  test("asks after the persona changes", async () => {
    const { dir, deps } = await relaxedWeek8();
    await publish(dir, deps, relaxedConfirm(true));
    await writePersona(dir, `${RELAXED_ROAST}Louder.\n`);
    const week9 = atWeek(deps, 9);
    await draft(dir, week9);
    const changed = relaxedConfirm(true);

    expect(await publish(dir, week9, changed)).toMatchObject({
      published: true,
    });
    expect(changed.asked).toHaveLength(1);
  });

  test("--yes publishes without asking", async () => {
    const { dir, deps } = await relaxedWeek8();
    const no = relaxedConfirm(false);

    expect(await publish(dir, deps, { ...no, yes: true })).toMatchObject({
      published: true,
    });
    expect(no.asked).toHaveLength(0);
  });

  test("a persona that isn't relaxed is never asked about", async () => {
    const { dir, deps } = await withPersona(ROAST);
    await writeFamilyLeague(dir, "on");
    await draft(dir, deps);
    const no = relaxedConfirm(false);

    expect(await publish(dir, deps, no)).toMatchObject({ published: true });
    expect(no.asked).toHaveLength(0);
  });
});

describe("preset samples", () => {
  test.each(Object.entries(PRESETS))(
    "%s has one, clean on the word list whenever its swearing is off",
    (_, preset) => {
      expect(preset.sample.length).toBeGreaterThan(0);
      if (preset.swearing !== "off") return;
      const result = validate(blurb(null, preset.sample, { swearing: "off" }));
      expect(result.swears).toEqual([]);
    },
  );
});

describe("the style note", () => {
  test("naming a real manager is a one-line warning", async () => {
    const managers = (await committed(8)).teams.flatMap((t) =>
      t.managers.map((m) => m.displayName),
    );
    const named = managers[0] as string;
    const { dir, deps } = await withPersona(
      `---\nformat: 1\npreset: banter\n---\nGo easy on ${named.toLowerCase()}, who's new.\n`,
    );

    const result = await draft(dir, deps);

    expect(result.warnings).toEqual([
      `persona.md's style note names ${named}, a manager in the league or its lore. It's sent to the LLM provider with every draft.`,
    ]);
  });
});

describe("intro: off", () => {
  test("the LLM is told to write no intro, and the draft has none", async () => {
    const { dir, deps, llm } = await withPersona(
      "---\nformat: 1\npreset: broadcast\nintro: off\n---\n",
    );

    const result = await draft(dir, deps);

    const part = personaPart(llm.requests[0]?.prompt);
    expect(part).toContain("Write each blurb as prose, 2 to 3 sentences.");
    expect(part).toContain(
      "Write no week intro: leave out the {intro} section.",
    );
    const text = await readFile(result.path, "utf8");
    expect(text).not.toContain("{intro}");
    expect(text).toContain("  intro: off\n");
  });

  test("a draft without the LLM has no intro either", async () => {
    const { dir, deps } = await withPersona(
      "---\nformat: 1\npreset: broadcast\nintro: off\n---\n",
    );
    delete deps.env.anthropicApiKey;

    const result = await draft(dir, deps);

    expect(await readFile(result.path, "utf8")).not.toContain("{intro}");
  });
});
