import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import { WorkspaceFileError } from "./front-matter.ts";
import { renderPlainText } from "./plain-text.ts";
import { checkOrder, parseRanking } from "./ranking-file.ts";
import { normalizeSleeper } from "./sleeper/normalizer.ts";
import { readSnapshot } from "./snapshot.ts";
import {
  rankingsDir,
  readWorkspace,
  snapshotsDir,
  weekStem,
} from "./workspace.ts";
import { writeOutput, writeWorkspaceFile } from "./workspace-files.ts";

export interface PublishResult {
  week: number;
  /** The frozen copy. */
  publishedPath: string;
  /** The plain text file. */
  textPath: string;
  /** The plain text, as written and copied. */
  text: string;
  /** Whether the text reached a clipboard. */
  copied: boolean;
}

/**
 * Freezes the latest draft as `week-NN.published.md`, renders the plain text from the
 * frozen copy into `week-NN.txt`, and copies it to the clipboard.
 */
export async function publish(
  workspaceDir: string,
  deps: Deps,
): Promise<PublishResult> {
  const ws = await readWorkspace(workspaceDir);
  const dir = rankingsDir(ws);
  const week = await latestDraftWeek(dir);
  const stem = weekStem(week);

  const draftText = await readDraft(join(dir, `${stem}.md`), `${stem}.md`);
  const ranking = parseRanking(`${stem}.md`, draftText);
  const league = normalizeSleeper(
    await readSnapshot(snapshotsDir(ws), ranking.meta.snapshot),
  );
  checkOrder(`${stem}.md`, ranking, league);

  const publishedPath = join(dir, `${stem}.published.md`);
  await writeWorkspaceFile(publishedPath, draftText);
  // The frozen copy is the draft verbatim, so the parsed draft renders it.
  const text = renderPlainText(ranking, league);
  const textPath = join(dir, `${stem}.txt`);
  await writeOutput(textPath, text);
  const copied = await deps.clipboard.write(text);

  return { week, publishedPath, textPath, text, copied };
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
      `No draft to publish in ${dir}; run \`lazy-pundit draft\` first`,
    );
  }
  return Math.max(...weeks);
}

async function readDraft(path: string, name: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    throw new WorkspaceFileError(`No draft ${name} to publish`, { cause });
  }
}
