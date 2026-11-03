import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readFrontMatter, WorkspaceFileError } from "./front-matter.ts";
import type { League, TeamId } from "./league.ts";
import { normalize, type ValidatorInput, wholeWords } from "./validator.ts";
import type { Workspace } from "./workspace.ts";

/** `lore.md`'s front matter. Its shape is versioned by `FORMAT`. */
export const loreSchema = z.strictObject({ lore: z.number() });

const LEAGUE_TYPES = ["work", "family", "friends", "other"] as const;
export type LeagueType = (typeof LEAGUE_TYPES)[number];

export interface LoreSection {
  /**
   * What a `{lore=…}` tag cites: `manager:bo`, `team:sleeper:3`, or the
   * heading in lower case with dashes, such as `running-jokes`.
   */
  name: string;
  line: number;
  nicknames: string[];
  /** Each lore entry: every other line of text, without its bullet. */
  entries: string[];
}

export interface Lore {
  type?: LeagueType;
  sections: LoreSection[];
  /** The lines with a `{local}` on them. */
  localLines: number[];
}

/** The names `validate` takes: what a team goes by, and what may be cited. */
export type ValidatorNames = Pick<ValidatorInput, "nicknames" | "sections">;

/**
 * Reads the workspace's `lore.md`, refusing an unknown tag or a malformed
 * reserved line. With no file, the lore is empty. Markdown comments aren't
 * lore: their tags mean nothing and their text is no entry.
 */
export async function loadLore(ws: Workspace): Promise<Lore> {
  let text: string;
  try {
    text = await readFile(join(ws.dir, "lore.md"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { sections: [], localLines: [] };
  }
  const { data, body, bodyLine } = readFrontMatter("lore.md", text, "lore");
  const parsed = loreSchema.safeParse(data);
  if (!parsed.success) {
    throw new WorkspaceFileError(`lore.md: ${z.prettifyError(parsed.error)}`);
  }
  const lines = withoutComments(body)
    .split(/\r?\n/)
    .map((raw, i) => ({ text: raw.trim(), at: bodyLine + i }));
  refuseUnknownTags(lines);
  const lore: Lore = {
    sections: [],
    // Commented or not: a marker beside an entry must never fail open.
    localLines: body.split(/\r?\n/).flatMap((line, i) => {
      return line.includes("{local}") ? [bodyLine + i] : [];
    }),
  };
  let section: LoreSection | undefined;
  for (const { text: line, at } of lines) {
    const heading = HEADING.exec(line)?.[1];
    if (heading !== undefined) {
      section = newSection(heading, at, lore.sections);
      lore.sections.push(section);
      continue;
    }
    const item = line.replace(/^[-*]\s+/, "");
    const nicknames = /^nicknames:(.*)$/i.exec(item)?.[1];
    if (nicknames !== undefined) {
      addNicknames(section, nicknames, at);
    } else if (section?.name === "league" && /^type:/i.test(item)) {
      lore.type = leagueType(item.slice("type:".length).trim(), lore, at);
    } else if (section && item) {
      section.entries.push(item);
    }
  }
  return lore;
}

function refuseUnknownTags(lines: { text: string; at: number }[]): void {
  const unknown: string[] = [];
  for (const { text, at } of lines) {
    const isSection = SECTION_TAG.test(HEADING.exec(text)?.[1] ?? "");
    for (const [tag] of text.matchAll(/\{[^{}]*\}/g)) {
      if (tag !== "{local}" && !isSection) {
        unknown.push(`line ${at}: ${tag}`);
      }
    }
  }
  if (unknown.length > 0) {
    throw new WorkspaceFileError(
      `lore.md has tags this version doesn't know, so remove each one (a {manager=<handle>} or {team=<platform>:<id>} is a whole heading): ${unknown.join(", ")}`,
    );
  }
}

const HEADING = /^##(?!#)\s*(.*)$/;
const SECTION_TAG = /^\{(?:manager=([^{}\s=]+)|team=([a-z]+:[^{}\s:=]+))\}$/;

/** A comment's text removed, its line breaks kept so line numbers hold. */
function withoutComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ""));
}

function newSection(
  heading: string,
  line: number,
  sections: LoreSection[],
): LoreSection {
  const tag = SECTION_TAG.exec(heading);
  const name = tag
    ? tag[1]
      ? `manager:${tag[1]}`
      : `team:${tag[2]}`
    : headingName(heading);
  if (!name) {
    throw new WorkspaceFileError(
      `lore.md line ${line}: this heading has no words a {lore=…} tag could cite`,
    );
  }
  const earlier = sections.find((s) => s.name === name);
  if (earlier) {
    throw new WorkspaceFileError(
      `lore.md has two sections named ${name}, on lines ${earlier.line} and ${line}`,
    );
  }
  return { name, line, nicknames: [], entries: [] };
}

/** A heading as a tag can cite it, since a tag holds no spaces. */
function headingName(heading: string): string {
  return heading
    .replace(/\{[^{}]*\}/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function addNicknames(
  section: LoreSection | undefined,
  line: string,
  at: number,
): void {
  if (!section || !/^(manager|team):/.test(section.name)) {
    throw new WorkspaceFileError(
      `lore.md line ${at}: nicknames belong in a manager or team section`,
    );
  }
  if (section.nicknames.length > 0) {
    throw new WorkspaceFileError(
      `lore.md line ${at}: ${section.name} already has its one nicknames: line`,
    );
  }
  section.nicknames = line
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

function leagueType(value: string, lore: Lore, at: number): LeagueType {
  if (lore.type) {
    throw new WorkspaceFileError(
      `lore.md line ${at}: the league already has its one type: line`,
    );
  }
  const type = LEAGUE_TYPES.find((t) => t === value);
  if (!type) {
    throw new WorkspaceFileError(
      `lore.md line ${at}: the league's type is work, family, friends or other, not "${value}"`,
    );
  }
  return type;
}

/** Stops a draft on any `{local}`: no entry marked so may reach the LLM. */
export function refuseLocal(lore: Lore): void {
  if (lore.localLines.length > 0) {
    const lines = lore.localLines.join(", ");
    throw new WorkspaceFileError(
      `lore.md line${lore.localLines.length > 1 ? "s" : ""} ${lines}: local-only isn't supported yet; remove the entry or the marker`,
    );
  }
}

/**
 * The teams in this league a section's nicknames count for: a team section's
 * own team, or the teams a manager section's handle runs through its linked
 * accounts. A departed manager, or a handle with no link, has none.
 */
function teamsOf(
  s: LoreSection,
  league: League,
  handles: Workspace["handles"],
): TeamId[] {
  const manager = /^manager:(.*)$/.exec(s.name)?.[1];
  if (manager !== undefined) {
    const accounts = handles[manager] ?? [];
    return league.teams
      .filter((t) =>
        t.managers.some((m) =>
          accounts.includes(`${league.platform}:${m.accountId}`),
        ),
      )
      .map((t) => t.id);
  }
  const team = /^team:(.*)$/.exec(s.name)?.[1];
  return league.teams.filter((t) => t.id === team).map((t) => t.id);
}

/**
 * Every team's names for the validator: its name, its managers' display names
 * and lore's nicknames, plus the lore sections a tag may cite. A nickname that
 * would read as two holders' is a load error naming both, unless they come to
 * one team, as a manager and their own team do.
 */
export function validatorNames(
  lore: Lore,
  league: League,
  handles: Workspace["handles"],
): ValidatorNames {
  const nicknames = Object.fromEntries(
    league.teams.map((t) => [
      t.id,
      [t.name, ...t.managers.map((m) => m.displayName)],
    ]),
  ) as Record<TeamId, string[]>;
  const taken = league.teams.flatMap((t) =>
    (nicknames[t.id] ?? []).map((name) => ({ name, team: t })),
  );

  const written: { name: string; holder: string; teams: TeamId[] }[] = [];
  for (const s of lore.sections) {
    const teams = teamsOf(s, league, handles);
    for (const n of s.nicknames) {
      const held = written.find(
        (w) =>
          w.holder !== s.name &&
          !comeToOneTeam(w.teams, teams) &&
          readAsOne(w.name, n),
      );
      if (held) throwClash(n, held.holder, s.name);
      const other = taken.find(
        ({ name, team }) => !teams.includes(team.id) && readAsOne(name, n),
      );
      if (other) {
        throwClash(n, s.name, `${other.team.name} (${other.team.id})`);
      }
      written.push({ name: n, holder: s.name, teams });
      for (const team of teams) nicknames[team]?.push(n);
    }
  }
  return {
    nicknames,
    sections: {
      lore: lore.sections.map((s) => s.name),
      stakes: [],
      log: [],
    },
  };
}

/** Whether two holders mean the same team; holders with no team don't. */
function comeToOneTeam(a: TeamId[], b: TeamId[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((t) => b.includes(t));
}

/**
 * Whether a sentence using one name also reads as the other: they're the same,
 * or one holds the other as whole words, as "Bench Mob" holds "Mob".
 */
function readAsOne(a: string, b: string): boolean {
  const [x, y] = [normalize(a), normalize(b)];
  return wholeWords(x).test(y) || wholeWords(y).test(x);
}

function throwClash(nickname: string, a: string, b: string): never {
  throw new WorkspaceFileError(
    `lore.md: the nickname "${nickname}" points at both ${a} and ${b}; keep it on one`,
  );
}
