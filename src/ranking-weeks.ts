import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkspaceFileError } from "./front-matter.ts";
import { type LlmProseFile, parseLlmProseFile } from "./llm-prose-file.ts";
import { parseRanking, type RankingFile } from "./ranking-file.ts";
import { punditDir, type Workspace } from "./workspace.ts";

/** One ranking week of the pundit's, as the workspace keeps it. */
export interface RankingWeek {
  season: number;
  week: number;
  /** `week-NN.md`, the draft, if the pundit kept it. */
  draft?: RankingFile;
  /** `week-NN.published.md`, the frozen copy, once the week is published. */
  frozenCopy?: RankingFile;
  /** `week-NN.llm.md`, the LLM prose file, when the LLM wrote any of the draft. */
  llmProse?: LlmProseFile;
  /**
   * The week's files that couldn't be read, such as a draft mid-edit, each
   * with the reason, as `<season>/<file>`. The others are read regardless.
   */
  unreadable: { kind: RankingWeekFile; file: string; reason: string }[];
}

/** Which of a ranking week's files: its draft, frozen copy or LLM prose file. */
export type RankingWeekFile = "draft" | "frozenCopy" | "llmProse";

const RANKING_FILE = /^week-(\d+)(?:\.(published|llm))?\.md$/;

/**
 * Every ranking week the pundit has a draft, frozen copy or LLM prose file
 * for, in every season of the workspace, oldest first. It reads files only.
 */
export async function readRankingWeeks(ws: Workspace): Promise<RankingWeek[]> {
  const root = punditDir(ws);
  const seasons = (await readdir(root).catch(() => [] as string[]))
    .filter((name) => /^\d{4}$/.test(name))
    .sort();
  const weeks: RankingWeek[] = [];
  for (const season of seasons) {
    const dir = join(root, season);
    const byWeek = new Map<number, RankingWeek>();
    for (const name of (await readdir(dir)).sort()) {
      const match = RANKING_FILE.exec(name);
      if (!match) continue;
      const week = Number(match[1]);
      const entry: RankingWeek = byWeek.get(week) ?? {
        season: Number(season),
        week,
        unreadable: [],
      };
      byWeek.set(week, entry);
      const kind: RankingWeekFile =
        match[2] === "llm" ? "llmProse" : match[2] ? "frozenCopy" : "draft";
      const text = await readFile(join(dir, name), "utf8");
      try {
        if (kind === "llmProse") entry.llmProse = parseLlmProseFile(name, text);
        else entry[kind] = parseRanking(name, text);
      } catch (err) {
        if (!(err instanceof WorkspaceFileError)) throw err;
        const reason = err.message.replace(`${name}: `, "");
        entry.unreadable.push({ kind, file: `${season}/${name}`, reason });
      }
    }
    weeks.push(...[...byWeek.values()].sort((a, b) => a.week - b.week));
  }
  return weeks;
}
