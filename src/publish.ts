import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { checkDraft, type Problem } from "./check.ts";
import type { Deps } from "./deps.ts";
import type { PersonaRecord } from "./persona.ts";
import { renderPlainText } from "./plain-text.ts";
import { frozenCopy, lastPublished, parseRanking } from "./ranking-file.ts";
import { freshDataWarnings } from "./refresh.ts";
import { writeOutput, writeWorkspaceFile } from "./workspace-files.ts";

export interface PublishOptions {
  /** Publish even with hard problems, without asking (`--yes`). */
  yes?: boolean;
  /**
   * Asked once when the draft has hard problems: true is Publish anyway,
   * false is Back to editing. With no one to ask, it's Back to editing.
   */
  confirm?: (hard: Problem[]) => Promise<boolean>;
  /**
   * Asked when the draft's persona relaxes the family league and differs from
   * the persona of the last ranking published (or none was): true publishes.
   * With no one to ask, it's No. `yes` skips it too.
   */
  confirmRelaxed?: (persona: PersonaRecord) => Promise<boolean>;
  /**
   * Told the data-changed warning or the failed fetch's note before anything
   * is asked or written. The result carries them too.
   */
  onWarnings?: (warnings: string[]) => void;
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
      /** The data-changed warning, or a note that the fetch failed. */
      warnings: string[];
    }
  | {
      /** Nothing was written. */
      published: false;
      /** Hard problems, or a relaxed persona the pundit didn't confirm. */
      stoppedBy: "hard" | "relaxed";
      week: number;
      problems: Problem[];
      warnings: string[];
    };

/**
 * Checks the latest draft and diffs fresh data against its snapshot, warning
 * without re-snapshotting. Then it freezes the draft as `week-NN.published.md`,
 * renders the plain text from the frozen copy into `week-NN.txt`, and copies it
 * to the clipboard. Hard problems are put to `confirm` first; soft ones are only
 * returned.
 */
export async function publish(
  workspaceDir: string,
  deps: Deps,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const checked = await checkDraft(workspaceDir);
  const { week, problems, dir, stem } = checked;
  const warnings = [
    ...checked.warnings,
    ...(await freshDataWarnings(workspaceDir, checked, deps)),
  ];
  opts.onWarnings?.(warnings);

  const hard = problems.filter((p) => p.severity === "hard");
  if (hard.length > 0 && !opts.yes && !(await opts.confirm?.(hard))) {
    return { published: false, stoppedBy: "hard", week, problems, warnings };
  }
  const { persona } = checked.ranking.meta;
  if (persona.family_league_relaxed && !opts.yes) {
    // This week's own frozen copy counts, so a republish isn't asked again.
    const last = await lastPublished(dir, week + 1);
    const unchanged =
      last !== undefined &&
      isDeepStrictEqual(last.ranking.meta.persona, persona);
    if (!unchanged && !(await opts.confirmRelaxed?.(persona))) {
      return {
        published: false,
        stoppedBy: "relaxed",
        week,
        problems,
        warnings,
      };
    }
  }

  const name = `${stem}.published.md`;
  const publishedPath = join(dir, name);
  const edition = (await editionOf(publishedPath, name)) + 1;
  await writeWorkspaceFile(
    publishedPath,
    frozenCopy(name, checked.text, edition),
  );
  // The frozen copy is the checked draft with its edition, so the draft's
  // parse and order evidence render it.
  const text = renderPlainText(
    checked.ranking,
    checked.league,
    checked.order,
    checked.baseline,
  );
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
    warnings,
  };
}

/**
 * The edition of the frozen copy at `path`: 0 before the week's first
 * publish, and 1 for one written before frozen copies carried an edition.
 */
async function editionOf(path: string, name: string): Promise<number> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return 0;
  return parseRanking(name, text).meta.edition ?? 1;
}
