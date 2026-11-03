import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import { draftData } from "./draft-data.ts";
import { WorkspaceFileError } from "./front-matter.ts";
import type { League, TeamId } from "./league.ts";
import type { FailedSection, SectionKey } from "./llm-gate.ts";
import {
  type MovementBaseline,
  movementBaseline,
  moveOf,
  orderEvidence,
} from "./movement.ts";
import { checkOrder, parseRanking, type RankingFile } from "./ranking-file.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import { readSnapshot } from "./snapshot.ts";
import {
  applyAutoTags,
  type ClaimStatus,
  type EvidencePack,
  isHard,
  type OrderEvidence,
  stripTags,
  type ValidatorInput,
  validate,
} from "./validator.ts";
import {
  rankingsDir,
  readWorkspace,
  snapshotsDir,
  type Workspace,
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
  /** `moved`: a moved team, away from its starting place. */
  kind: Exclude<ClaimStatus, "verified"> | "swear" | "unreadable-tag" | "moved";
  /** Why, in words the pundit reads. */
  reason: string;
  /** For a stale claim: what changed since it held. */
  cause?: "refresh" | "reorder";
  /** The evidence ID cited or matched. */
  id?: string;
  /**
   * A gate failure: LLM prose that never passed the LLM gate was written as
   * its best attempt with this fault in it. Only the new draft's list has it.
   */
  gate?: true;
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
  /** Each team's order evidence in the checked order. */
  order: Record<TeamId, OrderEvidence>;
  /** What movement was measured against, or none before the first publish. */
  baseline?: MovementBaseline;
}

/**
 * Reads, checks and auto-tags the latest draft in the workspace's season.
 * With `autoTag: false` the file is left alone, and an untagged claim that
 * could be auto-tagged is simply verified.
 */
export async function checkDraft(
  workspaceDir: string,
  opts: { autoTag?: boolean } = {},
): Promise<CheckedDraft> {
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
  const baseline = await movementBaseline(dir, week);
  const order = orderEvidence(ranking, baseline);
  const startingOrder = Object.fromEntries(
    ranking.meta.starting_order.map((team, i) => [
      team,
      { place: i + 1, move: moveOf(baseline, team as TeamId, i + 1) },
    ]),
  ) as Record<TeamId, OrderEvidence>;
  const { problems, autoTags } = reviewProse({
    text: written,
    ranking,
    league,
    evidence,
    order,
    before: {
      order: startingOrder,
      evidence: await earlierEvidence(ws, ranking),
    },
  });
  problems.push(
    ...movedTeams(ranking, order, startingOrder, teamNames(league)),
  );
  problems.sort(byHardThenLine);

  const tagging = opts.autoTag !== false && autoTags.length > 0;
  let text = written;
  if (tagging) {
    text = applyAutoTags(written, autoTags);
    await writeWorkspaceFile(path, text);
  }
  return {
    week,
    path,
    problems,
    autoTagged: tagging ? autoTags.length : 0,
    stem,
    dir,
    text,
    ranking: tagging ? parseRanking(name, text) : ranking,
    league,
    order,
    ...(baseline ? { baseline } : {}),
  };
}

/**
 * The claims in a checked draft that hold on the data of `from` and fail on the
 * data of `to`: the ones a move between the two makes stale.
 */
export function claimsGoingStale(
  checked: CheckedDraft,
  from: League,
  to: League,
): Problem[] {
  const { week } = checked.ranking.meta;
  const { problems } = reviewProse({
    text: checked.text,
    ranking: checked.ranking,
    league: to,
    evidence: draftData(to, week).evidence,
    order: checked.order,
    before: { evidence: [draftData(from, week).evidence] },
  });
  return problems.filter((p) => p.kind === "stale" && p.cause === "refresh");
}

/**
 * The evidence from a refreshed draft's earlier snapshots, newest first, so a
 * claim true when written reads as stale rather than wrong. A snapshot that's
 * gone or no longer normalizes never blocks a check: it's just left out, and a
 * claim that only it could vouch for reads as wrong.
 */
async function earlierEvidence(
  ws: Workspace,
  ranking: RankingFile,
): Promise<EvidencePack[]> {
  const packs: EvidencePack[] = [];
  for (const id of (ranking.meta.earlier_snapshots ?? []).toReversed()) {
    try {
      const league = normalizeSleeper(await readSnapshot(snapshotsDir(ws), id));
      packs.push(draftData(league, ranking.meta.week).evidence);
    } catch {
      // Left out, as above.
    }
  }
  return packs;
}

function teamNames(league: League): Map<string, string> {
  return new Map(league.teams.map((t) => [t.id, t.name]));
}

/** Validates the intro and every blurb in a draft's `text` against `evidence`. */
function reviewProse(input: {
  text: string;
  ranking: RankingFile;
  league: League;
  evidence: EvidencePack;
  order: Record<TeamId, OrderEvidence>;
  before: NonNullable<ValidatorInput["before"]>;
}): {
  problems: Problem[];
  autoTags: { start: number; end: number; id: string }[];
} {
  const { text: written, ranking, league, evidence, order, before } = input;
  const nicknames = Object.fromEntries(
    league.teams.map((t) => [
      t.id,
      [t.name, ...t.managers.map((m) => m.displayName)],
    ]),
  ) as Record<TeamId, string[]>;
  const names = teamNames(league);

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
      // The persona the draft was written in, not today's persona.md.
      swearing: ranking.meta.persona.swearing,
      before,
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
        reason: SWEAR_REASON,
      });
    }
    problems.push(...unreadableTags(s, at, lineAt));
    for (const t of result.autoTags) {
      autoTags.push({ ...t, start: s.start + t.start, end: s.start + t.end });
    }
  }
  return { problems, autoTags };
}

/** Why a word-list hit is a problem. */
export const SWEAR_REASON = "on the word list, and swearing is off";

/** The problems list's order: hard first, then by line. */
function byHardThenLine(a: Problem, b: Problem): number {
  return (
    Number(b.severity === "hard") - Number(a.severity === "hard") ||
    a.line - b.line
  );
}

/**
 * A new draft's problems list with each fault of prose that never passed the
 * LLM gate marked as a gate failure where the check lists it: a claim by its
 * text, a word-list hit by its word. A claim the check auto-tagged now cites
 * its evidence and is verified, so it isn't one.
 */
export function withGateFailures(
  checked: CheckedDraft,
  failed: FailedSection[],
): Problem[] {
  if (failed.length === 0) return checked.problems;
  const team = (key: SectionKey) => (key === "intro" ? null : key);
  return checked.problems.map((p) =>
    failed.some(
      (f) =>
        team(f.key) === p.team &&
        (p.kind === "swear"
          ? f.swears.some((w) => w.word === p.text)
          : f.claims.some((c) => c.text === p.text)),
    )
      ? { ...p, gate: true as const }
      : p,
  );
}

/**
 * A moved team item for each team the pundit placed away from its starting
 * place, on its heading's line.
 */
function movedTeams(
  ranking: RankingFile,
  order: Record<TeamId, OrderEvidence>,
  startingOrder: Record<TeamId, OrderEvidence>,
  names: Map<string, string>,
): Problem[] {
  const moved: Problem[] = [];
  for (const e of ranking.entries) {
    if (e.kind !== "team") continue;
    const team = e.team as TeamId;
    const now = order[team]?.place;
    const start = startingOrder[team]?.place;
    if (now === undefined || start === undefined || now === start) continue;
    moved.push({
      severity: "soft",
      team,
      section: names.get(team) ?? team,
      line: e.line,
      text: e.label,
      kind: "moved",
      reason: `starting place ${start}, now ${now}`,
    });
  }
  return moved;
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
