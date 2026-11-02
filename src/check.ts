import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import { draftData } from "./draft-data.ts";
import { WorkspaceFileError } from "./front-matter.ts";
import type { League, TeamId } from "./league.ts";
import { checkOrder, parseRanking, type RankingFile } from "./ranking-file.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import { readSnapshot } from "./snapshot.ts";
import {
  applyAutoTags,
  type ClaimStatus,
  isHard,
  type OrderEvidence,
  stripTags,
  validate,
} from "./validator.ts";
import {
  rankingsDir,
  readWorkspace,
  snapshotsDir,
  weekStem,
} from "./workspace.ts";
import { writeWorkspaceFile } from "./workspace-files.ts";

/**
 * One item in the problems list: something in the draft the pundit should
 * see before publishing. The same list backs `check`, `draft`, `publish` and
 * the editing view; the CLI only formats it.
 */
export interface Problem {
  severity: "hard" | "soft";
  /** The section's team, or null for the intro. */
  team: TeamId | null;
  /** The team's name in the league, or "Intro". */
  section: string;
  /** The file line the words are on. */
  line: number;
  /** The words at fault, as the league would read them. */
  text: string;
  kind: Exclude<ClaimStatus, "verified"> | "swear" | "unreadable-tag";
  /** Why, in words the pundit reads. */
  reason: string;
  /** For a stale claim: what changed since it held. */
  cause?: "refresh" | "reorder";
  /** The evidence ID cited or matched. */
  id?: string;
}

export interface CheckResult {
  week: number;
  /** The draft checked. */
  path: string;
  /** Hard first, then in file order. */
  problems: Problem[];
  /** How many claims were auto-tagged in the file. */
  autoTagged: number;
}

/**
 * Re-checks the latest draft: every blurb and the intro against the evidence
 * pack and the order as it stands, writing auto-tags back without changing
 * a word. Problems are reported, never fixed.
 */
export async function check(
  workspaceDir: string,
  _deps: Deps,
): Promise<CheckResult> {
  const { week, path, problems, autoTagged } = await checkDraft(workspaceDir);
  return { week, path, problems, autoTagged };
}

/** A draft as `check` left it, for publish to freeze. */
export interface CheckedDraft extends CheckResult {
  stem: string;
  dir: string;
  /** The draft's text, auto-tags included. */
  text: string;
  ranking: RankingFile;
  league: League;
}

/** Swearing is allowed until a persona sets it (#54), so the word list doesn't run yet. */
const SWEARING_ALLOWED = "on" as const;

/** Reads, checks and auto-tags the latest draft in the workspace's season. */
export async function checkDraft(workspaceDir: string): Promise<CheckedDraft> {
  const ws = await readWorkspace(workspaceDir);
  const dir = rankingsDir(ws);
  const week = await latestDraftWeek(dir);
  const stem = weekStem(week);
  const name = `${stem}.md`;
  const path = join(dir, name);

  const written = await readDraft(path, name);
  const ranking = parseRanking(name, written);
  const league = normalizeSleeper(
    await readSnapshot(snapshotsDir(ws), ranking.meta.snapshot),
  );
  checkOrder(name, ranking, league);

  const { evidence } = draftData(league, ranking.meta.week);
  const order = orderEvidence(ranking);
  const startingOrder = Object.fromEntries(
    ranking.meta.starting_order.map((team, i) => [team, { place: i + 1 }]),
  ) as Record<TeamId, OrderEvidence>;
  const nicknames = Object.fromEntries(
    league.teams.map((t) => [
      t.id,
      [t.name, ...t.managers.map((m) => m.displayName)],
    ]),
  ) as Record<TeamId, string[]>;
  const names = new Map<string, string>(
    league.teams.map((t) => [t.id, t.name]),
  );

  const sections: { team: TeamId | null; text: string; start: number }[] = [];
  if (ranking.intro !== undefined) {
    sections.push({
      team: null,
      text: ranking.intro,
      start: ranking.introStart ?? 0,
    });
  }
  for (const e of ranking.entries) {
    if (e.kind === "team" && e.blurb) {
      sections.push({
        team: e.team as TeamId,
        text: e.blurb,
        start: e.blurbStart,
      });
    }
  }

  const problems: Problem[] = [];
  const autoTags: { start: number; end: number; id: string }[] = [];
  const lineAt = (offset: number) =>
    written.slice(0, offset).split("\n").length;
  for (const s of sections) {
    const result = validate({
      text: s.text,
      team: s.team,
      evidence,
      order,
      nicknames,
      sections: { lore: [], stakes: [], log: [] },
      swearing: SWEARING_ALLOWED,
      before: { order: startingOrder },
    });
    const at = {
      team: s.team,
      section: s.team ? (names.get(s.team) ?? s.team) : "Intro",
    };
    for (const c of result.claims) {
      if (c.status === "verified") continue;
      problems.push({
        ...at,
        severity: isHard(c.status) ? "hard" : "soft",
        line: lineAt(s.start + c.start),
        text: c.text,
        kind: c.status,
        reason: c.reason,
        ...(c.cause ? { cause: c.cause } : {}),
        ...(c.id ? { id: c.id } : {}),
      });
    }
    for (const w of result.swears) {
      problems.push({
        ...at,
        severity: "soft",
        line: lineAt(s.start + w.start),
        text: w.word,
        kind: "swear",
        reason: "on the word list, and swearing is off",
      });
    }
    problems.push(...unreadableTags(s, at, lineAt));
    for (const t of result.autoTags) {
      autoTags.push({ ...t, start: s.start + t.start, end: s.start + t.end });
    }
  }
  problems.sort(
    (a, b) =>
      Number(b.severity === "hard") - Number(a.severity === "hard") ||
      a.line - b.line,
  );

  let text = written;
  if (autoTags.length > 0) {
    text = applyAutoTags(written, autoTags);
    await writeWorkspaceFile(path, text);
  }
  return {
    week,
    path,
    problems,
    autoTagged: autoTags.length,
    stem,
    dir,
    text,
    ranking: autoTags.length > 0 ? parseRanking(name, text) : ranking,
    league,
  };
}

/** Each team's place and group, read from the draft's current order. */
function orderEvidence(ranking: RankingFile): Record<TeamId, OrderEvidence> {
  const order: Record<TeamId, OrderEvidence> = {};
  let place = 0;
  let group: string | undefined;
  for (const e of ranking.entries) {
    if (e.kind === "group") {
      group = e.label;
      continue;
    }
    place += 1;
    order[e.team as TeamId] = { place, ...(group ? { group } : {}) };
  }
  return order;
}

/**
 * A `[words]{…}` the validator can't read as a tag, such as `{ev = record}`,
 * would reach the league as written.
 */
function unreadableTags(
  s: { team: TeamId | null; text: string; start: number },
  at: { team: TeamId | null; section: string },
  lineAt: (offset: number) => number,
): Problem[] {
  // Anything tag-shaped that stripping leaves untouched isn't a tag it reads.
  return [...s.text.matchAll(/\[[^\][]*\]\{[^{}]*\}/g)]
    .filter((m) => stripTags(m[0]) === m[0])
    .map((m) => ({
      ...at,
      severity: "hard",
      line: lineAt(s.start + m.index),
      text: m[0],
      kind: "unreadable-tag",
      reason:
        "a tag the tool can't read would be published as written; write it as [words]{ev=<id>}",
    }));
}

/** The highest ranking week with a draft in the folder. */
async function latestDraftWeek(dir: string): Promise<number> {
  const names = await readdir(dir).catch(() => []);
  const weeks = names
    .map((n) => /^week-(\d+)\.md$/.exec(n)?.[1])
    .filter((w) => w !== undefined)
    .map(Number);
  if (weeks.length === 0) {
    throw new WorkspaceFileError(
      `No draft in ${dir}; run \`lazy-pundit draft\` first`,
    );
  }
  return Math.max(...weeks);
}

async function readDraft(path: string, name: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    throw new WorkspaceFileError(`No draft ${name}`, { cause });
  }
}
