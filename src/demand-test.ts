import type { LlmProseFile } from "./llm-prose-file.ts";
import type { BlurbProblems, RankingFile } from "./ranking-file.ts";
import { type RankingWeek, readRankingWeeks } from "./ranking-weeks.ts";
import { stripTags } from "./validator.ts";
import { readWorkspace } from "./workspace.ts";

/** One published ranking week in the demand-test summary. */
export interface DemandTestWeek {
  season: number;
  week: number;
  /** From the draft's start to its first publish; unknown for a frozen copy that predates the record. */
  minutesToPublish?: number;
  /** Teams placed away from their starting place, against the starting order at publish. */
  movedTeams: number;
  /** The places those teams were moved, in all. */
  placesMoved: number;
  /** Whether the LLM wrote any section of the week's draft. */
  llmUsed: boolean;
  /** The LLM text kept, from 0 to 1, when the LLM was used. */
  llmTextKept?: number;
  /** The blurb problems the frozen copy was published with; unknown for one that predates the record. */
  blurbProblems?: BlurbProblems;
}

export interface DemandTestSummary {
  weeks: DemandTestWeek[];
  /** Frozen copies and LLM prose files that couldn't be read, each left out of `weeks`' numbers. */
  unreadable: RankingWeek["unreadable"];
  /** The summary as the pundit pastes it: a line per week, the medians, then what couldn't be read. */
  text: string;
}

/**
 * The demand-test summary of the workspace at `workspaceDir`: each published
 * ranking week, read from its frozen copy and LLM prose file alone, so nothing
 * is fetched or sent. A draft is never read for it, so one mid-edit doesn't
 * stop it.
 */
export async function stats(workspaceDir: string): Promise<DemandTestSummary> {
  const ws = await readWorkspace(workspaceDir);
  const weeks: DemandTestWeek[] = [];
  const unreadable: DemandTestSummary["unreadable"] = [];
  for (const w of await readRankingWeeks(ws)) {
    unreadable.push(...w.unreadable.filter((u) => u.kind !== "draft"));
    if (!w.frozenCopy) continue;
    const { meta } = w.frozenCopy;
    weeks.push({
      season: w.season,
      week: w.week,
      ...(meta.first_published_at && {
        minutesToPublish: minutesBetween(
          meta.created_at,
          meta.first_published_at,
        ),
      }),
      ...moves(w.frozenCopy),
      ...llmUse(w.frozenCopy, w.llmProse),
      ...(meta.blurb_problems && { blurbProblems: meta.blurb_problems }),
    });
  }
  return { weeks, unreadable, text: summaryText(weeks, unreadable) };
}

const TITLE = "Lazy Pundit demand-test summary";

function summaryText(
  weeks: DemandTestWeek[],
  unreadable: DemandTestSummary["unreadable"],
): string {
  const couldNot = unreadable.map(
    (u) => `Couldn't read ${u.file}: ${u.reason}`,
  );
  if (weeks.length === 0) {
    return [`${TITLE}: no published ranking weeks yet`, ...couldNot].join("\n");
  }
  const known = <T>(values: (T | undefined)[]) =>
    values.filter((v): v is T => v !== undefined);
  const used = weeks.filter((w) => w.llmUsed);
  const problems = known(weeks.map((w) => w.blurbProblems));
  const median = [
    timing(medianOf(known(weeks.map((w) => w.minutesToPublish)))),
    moved(
      medianOf(weeks.map((w) => w.movedTeams)) ?? 0,
      medianOf(weeks.map((w) => w.placesMoved)) ?? 0,
    ),
    `LLM used in ${used.length} of ${plural(weeks.length, "week")}${keptText(medianOf(known(used.map((w) => w.llmTextKept))))}`,
    blurbProblemsText(
      problems.length === 0
        ? undefined
        : {
            hard: medianOf(problems.map((p) => p.hard)) ?? 0,
            soft: medianOf(problems.map((p) => p.soft)) ?? 0,
          },
    ),
  ];
  return [
    `${TITLE}: ${plural(weeks.length, "published ranking week")}`,
    ...weeks.map((w) =>
      [
        `${w.season} week ${w.week}: ${timing(w.minutesToPublish)}`,
        moved(w.movedTeams, w.placesMoved),
        w.llmUsed ? `LLM used${keptText(w.llmTextKept)}` : "LLM unused",
        blurbProblemsText(w.blurbProblems),
      ].join(" · "),
    ),
    `Median: ${median.join(" · ")}`,
    ...couldNot,
  ].join("\n");
}

function timing(minutes: number | undefined): string {
  return minutes === undefined
    ? "minutes to publish not recorded"
    : `${Math.round(minutes)} min to publish`;
}

function moved(teams: number, places: number): string {
  if (teams === 0) return "no teams moved";
  return `${plural(teams, "team")} moved, ${plural(places, "place")} in all`;
}

function keptText(share: number | undefined): string {
  return share === undefined
    ? ""
    : `, ${Math.round(share * 100)}% of its text kept`;
}

function blurbProblemsText(p: BlurbProblems | undefined): string {
  return p === undefined
    ? "blurb problems not recorded"
    : `${count(p.hard)} hard and ${count(p.soft)} soft blurb problems`;
}

/** `n` and `noun`, with an s unless `n` is 1. */
function plural(n: number, noun: string): string {
  return `${count(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/** A count, or a median between two counts, with at most one decimal. */
function count(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** The middle value, or the mean of the middle two; none for no values. */
function medianOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Whether the LLM wrote any of the week's draft, and if so the LLM text kept:
 * the share of its words the frozen copy still has, in order, in the same
 * section, tags left out. An LLM prose file from another draft of the week
 * (another `created_at`) isn't this one's.
 */
function llmUse(
  frozen: RankingFile,
  file: LlmProseFile | undefined,
): Pick<DemandTestWeek, "llmUsed" | "llmTextKept"> {
  if (!file || file.createdAt !== frozen.meta.created_at) {
    return { llmUsed: false };
  }
  const published = new Map<string, string>();
  for (const e of frozen.entries) {
    if (e.kind === "team") published.set(e.team, e.blurb);
  }
  const sections: [string, string | undefined][] = Object.entries(
    file.prose.blurbs,
  ).map(([id, llm]) => [llm ?? "", published.get(id)]);
  if (file.prose.intro) sections.push([file.prose.intro, frozen.intro]);
  let total = 0;
  let keptWords = 0;
  for (const [llm, now] of sections) {
    const from = words(llm);
    total += from.length;
    keptWords += keptInOrder(from, words(now ?? ""));
  }
  return { llmUsed: true, llmTextKept: total === 0 ? 1 : keptWords / total };
}

/** A section's words, lowercased, with tags and punctuation left out. */
function words(text: string): string[] {
  return (
    stripTags(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** How many of `from`'s words `to` keeps in the same order: their longest common subsequence. */
function keptInOrder(from: string[], to: string[]): number {
  let row = new Array<number>(to.length + 1).fill(0);
  for (const word of from) {
    const next = [0];
    for (let j = 0; j < to.length; j++) {
      next.push(
        word === to[j]
          ? (row[j] ?? 0) + 1
          : Math.max(row[j + 1] ?? 0, next[j] ?? 0),
      );
    }
    row = next;
  }
  return row[to.length] ?? 0;
}

function minutesBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 60_000;
}

/** The teams a ranking places away from its starting order, and by how many places in all. */
function moves(
  ranking: RankingFile,
): Pick<DemandTestWeek, "movedTeams" | "placesMoved"> {
  const start = ranking.meta.starting_order;
  let movedTeams = 0;
  let placesMoved = 0;
  ranking.entries
    .filter((e) => e.kind === "team")
    .forEach((e, i) => {
      const from = start.indexOf(e.team);
      if (from === -1 || from === i) return;
      movedTeams += 1;
      placesMoved += Math.abs(from - i);
    });
  return { movedTeams, placesMoved };
}
