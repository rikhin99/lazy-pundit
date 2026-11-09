import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { checkDraft, isBlurbProblem, type Problem } from "./check.ts";
import type { Deps } from "./deps.ts";
import { rawFrontMatterValue, WorkspaceFileError } from "./front-matter.ts";
import type { PersonaRecord } from "./persona.ts";
import { renderPlainText } from "./plain-text.ts";
import {
  frozenCopy,
  lastPublished,
  type PublishRecord,
  parseRanking,
  type RankingMeta,
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
  const name = `${stem}.published.md`;
  const publishedPath = join(dir, name);
  const ownCopy = await lastEdition(publishedPath, name);
  const warnings = [
    ...checked.warnings,
    ...(await freshDataWarnings(workspaceDir, checked, deps)),
    ...(ownCopy?.warnings ?? []),
  ];
  opts.onWarnings?.(warnings);

  const hard = problems.filter((p) => p.severity === "hard");
  if (hard.length > 0 && !opts.yes && !(await opts.confirm?.(hard))) {
    return { published: false, stoppedBy: "hard", week, problems, warnings };
  }
  const { persona } = checked.ranking.meta;
  if (persona.family_league_relaxed && !opts.yes) {
    // This week's own frozen copy counts, so a republish isn't asked again,
    // unless it can't be read: then the persona counts as changed.
    const last = ownCopy
      ? ownCopy.meta
      : (await lastPublished(dir, week))?.ranking.meta;
    const unchanged =
      last !== undefined && isDeepStrictEqual(last.persona, persona);
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

  const record = publishRecord(
    ownCopy,
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
 * The week's last edition: its frozen copy at `path` (none before the week's
 * first publish) and its edition number (an old frozen copy with no edition
 * counts as 1). A frozen copy that can't be read gives no `meta`: its edition
 * comes from a top-level `edition:` line, if it has one, and a warning that
 * publishing replaces it.
 */
async function lastEdition(
  path: string,
  name: string,
): Promise<LastEdition | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const meta = parseRanking(name, text).meta;
    return { edition: meta.edition ?? 1, meta, warnings: [] };
  } catch (error) {
    if (!(error instanceof WorkspaceFileError)) throw error;
    const written = rawFrontMatterValue(text, "edition") ?? "";
    const edition = /^[1-9]\d*$/.test(written) ? Number(written) : 1;
    return {
      edition,
      warnings: [
        `${name} can't be read, so publishing replaces it with edition ${edition + 1}, and any edits made in it are lost`,
      ],
    };
  }
}

interface LastEdition {
  edition: number;
  /** The frozen copy's front matter, unless it can't be read. */
  meta?: RankingMeta;
  /** That publishing replaces a frozen copy that can't be read. */
  warnings: string[];
}

/**
 * The publish record of a new edition after `last`: edition 1 on the week's
 * first publish, else one more than the last, keeping the last edition's first
 * publish time when it froze the same draft (`createdAt`): a draft made again
 * after the week was published starts its own.
 */
function publishRecord(
  last: LastEdition | undefined,
  createdAt: string,
  now: Date,
  problems: Problem[],
): PublishRecord {
  const blurb = problems.filter(isBlurbProblem);
  const sameDraft = last?.meta?.created_at === createdAt;
  return {
    edition: last === undefined ? 1 : last.edition + 1,
    firstPublishedAt:
      (sameDraft && last?.meta?.first_published_at) || now.toISOString(),
    blurbProblems: {
      hard: blurb.filter((p) => p.severity === "hard").length,
      soft: blurb.filter((p) => p.severity === "soft").length,
    },
  };
}
