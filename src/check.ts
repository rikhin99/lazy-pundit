import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import { draftData } from "./draft-data.ts";
import { WorkspaceFileError } from "./front-matter.ts";
import type { League, TeamId } from "./league.ts";
import { loadLeagueFile } from "./league-file.ts";
import type { FailedSection, SectionKey } from "./llm-gate.ts";
import {
  type Lore,
  loadLore,
  type ValidatorNames,
  validatorNames,
} from "./lore.ts";
import {
  type MovementBaseline,
  movementBaseline,
  moveOf,
  orderEvidence,
} from "./movement.ts";
import { isSmallSample } from "./power-score.ts";
import { checkOrder, parseRanking, type RankingFile } from "./ranking-file.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import { readSnapshot } from "./snapshot.ts";
import { type Stakes, stakesWarnings } from "./stakes.ts";
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
  /** The section's team, or null for the intro or a league item. */
  team: TeamId | null;
  /** The team's name in the league, "Intro", or "League" for a league item. */
  section: string;
  /** The file line the words are on, or null for a league item, which has none. */
  line: number | null;
  /** The words at fault, as the league would read them. Empty for a league item. */
  text: string;
  /**
   * `moved`: a moved team, away from its starting place. `small-sample`: the
   * small-sample flag, a league item. `no-stakes`: the no-stakes flag.
   * `failed-fetch`: the failed-fetch item, a league item only the command
   * that fetched lists. `provisional`: a provisional claim.
   * `correction-timing`: the correction-timing reminder, a league item.
   */
  kind:
    | Exclude<ClaimStatus, "verified">
    | "swear"
    | "no-stakes"
    | "unreadable-tag"
    | "moved"
    | "small-sample"
    | "failed-fetch"
    | "provisional"
    | "correction-timing";
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
  /** What reading the lore has to say, personal data included. */
  warnings: string[];
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
  const { week, path, problems, autoTagged, warnings } =
    await checkDraft(workspaceDir);
  return { week, path, problems, autoTagged, warnings };
}

/** A draft as `check` left it, for publish to freeze. */
export interface CheckedDraft extends CheckResult {
  stem: string;
  dir: string;
  /** The draft's text, auto-tags included. */
  text: string;
  ranking: RankingFile;
  league: League;
  /** The workspace's lore and handles, to name teams in a later league. */
  lore: Lore;
  /** The season's stakes, for evidence on a later league. */
  stakes: Stakes;
  handles: Workspace["handles"];
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

  const { stakes, warnings: leagueFileWarnings } = await loadLeagueFile(ws);
  const { evidence } = draftData(
    league,
    ranking.meta.week,
    stakes,
    ranking.meta.in_progress_week,
  );
  const baseline = await movementBaseline(dir, week);
  const order = orderEvidence(ranking, baseline);
  const startingOrder = Object.fromEntries(
    ranking.meta.starting_order.map((team, i) => [
      team,
      { place: i + 1, move: moveOf(baseline, team as TeamId, i + 1) },
    ]),
  ) as Record<TeamId, OrderEvidence>;
  const lore = await loadLore(ws);
  const { problems, autoTags } = reviewProse({
    text: written,
    ranking,
    league,
    evidence,
    order,
    validatorNames: validatorNames(lore, league, ws.handles, stakes),
    before: {
      order: startingOrder,
      evidence: await earlierEvidence(ws, ranking, stakes),
    },
  });
  problems.push(
    ...movedTeams(ranking, order, startingOrder, teamNames(league)),
    ...(isSmallSample(week) ? [smallSampleFlag(week)] : []),
    ...(week > 0 ? [correctionTiming(league)] : []),
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
    warnings: [
      ...lore.warnings,
      ...leagueFileWarnings,
      ...stakesWarnings(stakes, league),
    ],
    stem,
    dir,
    text,
    ranking: tagging ? parseRanking(name, text) : ranking,
    league,
    lore,
    stakes,
    handles: ws.handles,
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
  const { week, in_progress_week } = checked.ranking.meta;
  const evidenceOf = (league: League) =>
    draftData(league, week, checked.stakes, in_progress_week).evidence;
  const { problems } = reviewProse({
    text: checked.text,
    ranking: checked.ranking,
    league: to,
    evidence: evidenceOf(to),
    order: checked.order,
    validatorNames: validatorNames(
      checked.lore,
      to,
      checked.handles,
      checked.stakes,
    ),
    before: { evidence: [evidenceOf(from)] },
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
  stakes: Stakes,
): Promise<EvidencePack[]> {
  const packs: EvidencePack[] = [];
  for (const id of (ranking.meta.earlier_snapshots ?? []).toReversed()) {
    try {
      const league = normalizeSleeper(await readSnapshot(snapshotsDir(ws), id));
      const { week, in_progress_week } = ranking.meta;
      packs.push(draftData(league, week, stakes, in_progress_week).evidence);
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
  validatorNames: ValidatorNames;
  before: NonNullable<ValidatorInput["before"]>;
}): {
  problems: Problem[];
  autoTags: { start: number; end: number; id: string }[];
} {
  const { text: written, ranking, league, evidence, order, before } = input;
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
  // Provisional while the week the draft let in is still unscored in its data.
  const recorded = ranking.meta.in_progress_week;
  const inProgress = league.weeks.some((w) => w.week === recorded && !w.scored)
    ? recorded
    : undefined;
  const lineAt = (offset: number) =>
    written.slice(0, offset).split("\n").length;
  for (const s of sections) {
    const result = validate({
      text: s.text,
      team: s.team,
      evidence,
      order,
      ...input.validatorNames,
      // The persona the draft was written in, not today's persona.md.
      swearing: ranking.meta.persona.swearing,
      before,
    });
    const at = {
      team: s.team,
      section: s.team ? (names.get(s.team) ?? s.team) : "Intro",
    };
    for (const c of result.claims) {
      if (c.status === "verified") {
        if (inProgress && c.id?.startsWith(`w${inProgress}.`)) {
          problems.push({
            ...at,
            severity: "soft",
            line: lineAt(s.start + c.start),
            text: c.text,
            kind: "provisional",
            reason: `week ${inProgress} is still in progress, so this can change once it's scored`,
            id: c.id,
          });
        }
        continue;
      }
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
    for (const w of result.stakesMentions) {
      problems.push({
        ...at,
        severity: "hard",
        line: lineAt(s.start + w.start),
        text: w.word,
        kind: "no-stakes",
        reason: NO_STAKES_REASON,
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

/** Why a mention of money, a prize or a punishment is a problem under `stakes: none`. */
export const NO_STAKES_REASON =
  "mentions money, a prize or a punishment, and league.md says stakes: none (bragging rights only)";

/** The small-sample flag. Worked out here, never written to the file, so nothing published can carry it. */
function smallSampleFlag(week: number): Problem {
  return leagueItem(
    "small-sample",
    `week ${week} is early in the season, so the starting order means little yet`,
  );
}

/**
 * The last day each platform makes stat corrections to a scored week, as
 * spec #37's user story 59 gives them.
 */
const CORRECTIONS_THROUGH: Record<League["platform"], string> = {
  sleeper: "Thursday",
  espn: "Saturday",
};

/**
 * The correction-timing reminder. Nothing signals when corrections stop, so
 * every draft of a scored week carries it.
 */
function correctionTiming(league: League): Problem {
  return leagueItem(
    "correction-timing",
    `Scored. Corrections may land through ${CORRECTIONS_THROUGH[league.platform]}`,
  );
}

/** The problems list's order: hard first, then by line, with league items ahead of any line. */
function byHardThenLine(a: Problem, b: Problem): number {
  return (
    Number(b.severity === "hard") - Number(a.severity === "hard") ||
    (a.line ?? 0) - (b.line ?? 0)
  );
}

/**
 * A problems list with a league item only the command knows, such as the
 * failed-fetch item, in its place in the list's order.
 */
export function withLeagueItem(
  problems: Problem[],
  item: Problem | undefined,
): Problem[] {
  return item ? [item, ...problems].sort(byHardThenLine) : problems;
}

/** A soft league item: about the whole league, at no team or line. */
export function leagueItem(kind: Problem["kind"], reason: string): Problem {
  return {
    severity: "soft",
    team: null,
    section: "League",
    line: null,
    text: "",
    kind,
    reason,
  };
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
          : p.kind === "no-stakes"
            ? f.stakesMentions.some((w) => w.word === p.text)
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
