import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { checkDraft, isBlurbProblem, type Problem } from "./check.ts";
import type { Deps } from "./deps.ts";
import type { PersonaRecord } from "./persona.ts";
import { renderPlainText } from "./plain-text.ts";
import {
  frozenCopy,
  lastPublished,
  type PublishRecord,
  parseRanking,
} from "./ranking-file.ts";
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
  const record = await publishRecord(
    publishedPath,
    name,
    checked.ranking.meta.created_at,
    deps.clock.now(),
    problems,
  );
  await writeWorkspaceFile(
    publishedPath,
    frozenCopy(name, checked.text, record),
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
 * The publish record of a new edition of the frozen copy at `path`: edition 1
 * on the week's first publish, else one more than the last (an old frozen
 * copy with no edition counts as 1), keeping the last edition's first publish
 * time when it froze the same draft (`createdAt`): a draft made again after
 * the week was published starts its own.
 */
async function publishRecord(
  path: string,
  name: string,
  createdAt: string,
  now: Date,
  problems: Problem[],
): Promise<PublishRecord> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  const last = text === undefined ? undefined : parseRanking(name, text).meta;
  const blurb = problems.filter(isBlurbProblem);
  const sameDraft = last?.created_at === createdAt;
  return {
    edition: last === undefined ? 1 : (last.edition ?? 1) + 1,
    firstPublishedAt:
      (sameDraft && last?.first_published_at) || now.toISOString(),
    blurbProblems: {
      hard: blurb.filter((p) => p.severity === "hard").length,
      soft: blurb.filter((p) => p.severity === "soft").length,
    },
  };
}
