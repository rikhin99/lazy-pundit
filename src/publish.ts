import { join } from "node:path";
import { checkDraft, type Problem } from "./check.ts";
import type { Deps } from "./deps.ts";
import { renderPlainText } from "./plain-text.ts";
import { writeOutput, writeWorkspaceFile } from "./workspace-files.ts";

export interface PublishOptions {
  /** Publish even with hard problems, without asking (`--yes`). */
  yes?: boolean;
  /**
   * Asked once when the draft has hard problems: true is Publish anyway,
   * false is Back to editing. With no one to ask, it's Back to editing.
   */
  confirm?: (hard: Problem[]) => Promise<boolean>;
}

export type PublishResult =
  | {
      published: true;
      week: number;
      /** The frozen copy. */
      publishedPath: string;
      /** The plain text file. */
      textPath: string;
      /** The plain text, as written and copied. */
      text: string;
      /** Whether the text reached a clipboard. */
      copied: boolean;
      /** The problems published with, hard first. */
      problems: Problem[];
    }
  | {
      /** Back to editing: the draft had hard problems and nothing was written. */
      published: false;
      week: number;
      problems: Problem[];
    };

/**
 * Checks the latest draft, then freezes it as `week-NN.published.md`, renders
 * the plain text from the frozen copy into `week-NN.txt`, and copies it to
 * the clipboard. Hard problems are put to `confirm` first; soft ones are only
 * returned.
 */
export async function publish(
  workspaceDir: string,
  deps: Deps,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const checked = await checkDraft(workspaceDir);
  const { week, problems, dir, stem } = checked;

  const hard = problems.filter((p) => p.severity === "hard");
  if (hard.length > 0 && !opts.yes && !(await opts.confirm?.(hard))) {
    return { published: false, week, problems };
  }

  const publishedPath = join(dir, `${stem}.published.md`);
  await writeWorkspaceFile(publishedPath, checked.text);
  // The frozen copy is the checked draft verbatim, so its parse renders it.
  const text = renderPlainText(checked.ranking, checked.league);
  const textPath = join(dir, `${stem}.txt`);
  await writeOutput(textPath, text);
  const copied = await deps.clipboard.write(text);

  return {
    published: true,
    week,
    publishedPath,
    textPath,
    text,
    copied,
    problems,
  };
}
