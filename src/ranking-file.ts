import { z } from "zod";
import {
  readFrontMatter,
  WorkspaceFileError,
  writeFrontMatter,
} from "./front-matter.ts";
import { formatRecord, type League, type TeamId } from "./league.ts";

/**
 * A ranking file: a draft (`week-NN.md`) or its frozen copy
 * (`week-NN.published.md`). A team's place comes from section order only; a team
 * section's heading text is just a label, and its `{team=…}` tag says which
 * team it is.
 */
export interface RankingFile {
  meta: RankingMeta;
  intro?: string;
  entries: Entry[];
}

export type Entry = GroupEntry | TeamEntry;

/** A `#` heading labelling the run of places after it. */
export interface GroupEntry {
  kind: "group";
  label: string;
  line: number;
}

/** A `## <label> {team=<id>}` section. */
export interface TeamEntry {
  kind: "team";
  team: string;
  label: string;
  blurb: string;
  line: number;
}

const metaSchema = z.object({
  season: z.number().int(),
  week: z.number().int().nonnegative(),
  pundit: z.string(),
  data_as_of: z.string(),
  checked_at: z.string(),
  snapshot: z.string(),
  starting_order: z.array(z.string()),
  created_at: z.string(),
});

export type RankingMeta = z.infer<typeof metaSchema>;

/** A ranking file that can't be read or doesn't place every team once. */
export class RankingFileError extends WorkspaceFileError {
  override name = "RankingFileError";
  readonly problems: string[];

  constructor(file: string, problems: string[]) {
    super(`${file}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

/** A new draft: the starting order, each team with its stat line. */
export function renderDraft(
  meta: RankingMeta,
  league: League,
  order: TeamId[],
): string {
  const teams = new Map(league.teams.map((t) => [t.id, t]));
  const sections = order.map((id) => {
    const team = teams.get(id);
    if (!team) throw new Error(`No team ${id} in the league`);
    return `## ${team.name} {team=${id}}\n${statLine(formatRecord(team.standing))}\n`;
  });
  return `${writeFrontMatter({ ...meta }, ["starting_order"])}\n${sections.join("\n")}`;
}

/** A blurb made only of checked stats. For now, the record. */
function statLine(record: string): string {
  return `Record: [${record}]{ev=record}.`;
}

const HEADING = /^(#{1,2})\s+(.*?)\s*$/;
const TAGGED = /^(.*?)\s*\{([^{}]*)\}$/;

/** Reads a ranking file, refusing an unknown format version. */
export function parseRanking(file: string, text: string): RankingFile {
  const { data, body, bodyLine } = readFrontMatter(file, text);
  const meta = metaSchema.safeParse(data);
  if (!meta.success) {
    throw new WorkspaceFileError(`${file}: ${z.prettifyError(meta.error)}`);
  }

  const problems: string[] = [];
  const entries: Entry[] = [];
  /** Lines of the intro and of each team's blurb, as they're read. */
  const lines = new Map<Entry | "intro", string[]>();
  let current: string[] | undefined;

  body.split(/\r?\n/).forEach((raw, i) => {
    const line = bodyLine + i;
    const heading = HEADING.exec(raw);
    if (!heading) {
      if (current) current.push(raw);
      else if (raw.trim()) {
        problems.push(`line ${line}: text outside any section`);
      }
      return;
    }
    current = undefined;
    const [, hashes, rest = ""] = heading;
    if (hashes === "#") {
      entries.push({ kind: "group", label: rest, line });
      return;
    }
    const [, label = rest, tag = ""] = TAGGED.exec(rest) ?? [];
    if (tag.trim() === "intro") {
      if (entries.length > 0 || lines.has("intro")) {
        problems.push(
          `line ${line}: the intro goes once, before the first team or group`,
        );
        return;
      }
      current = [];
      lines.set("intro", current);
      return;
    }
    const team = /^team=(\S+)$/.exec(tag.trim())?.[1];
    if (!team) {
      problems.push(
        `line ${line}: section "${rest}" has no {team=…} or {intro} tag`,
      );
      return;
    }
    const entry: TeamEntry = { kind: "team", team, label, blurb: "", line };
    entries.push(entry);
    current = [];
    lines.set(entry, current);
  });

  if (problems.length > 0) throw new RankingFileError(file, problems);
  const joined = (key: Entry | "intro") =>
    (lines.get(key) ?? []).join("\n").trim();
  const intro = joined("intro");
  return {
    meta: meta.data,
    ...(intro ? { intro } : {}),
    entries: entries.map((e) =>
      e.kind === "team" ? { ...e, blurb: joined(e) } : e,
    ),
  };
}

/**
 * Checks that the file places every team in the league exactly once. Problems
 * are reported, never fixed: the pundit owns the order.
 */
export function checkOrder(
  file: string,
  ranking: RankingFile,
  league: League,
): void {
  const names = new Map<string, string>(
    league.teams.map((t) => [t.id, t.name]),
  );
  const seen = new Map<string, TeamEntry[]>();
  for (const entry of ranking.entries) {
    if (entry.kind !== "team") continue;
    seen.set(entry.team, [...(seen.get(entry.team) ?? []), entry]);
  }

  const problems: string[] = [];
  for (const [team, entries] of seen) {
    const first = entries[0] as TeamEntry;
    if (!names.has(team)) {
      problems.push(
        `line ${first.line}: unknown team ${first.label} {team=${team}}; no team in the ${league.season} league has that ID`,
      );
    } else if (entries.length > 1) {
      const lines = entries.map((e) => e.line);
      problems.push(
        `${names.get(team)} {team=${team}} is placed more than once, at lines ${lines.slice(0, -1).join(", ")} and ${lines.at(-1)}`,
      );
    }
  }
  for (const [team, name] of names) {
    if (!seen.has(team)) {
      problems.push(
        `missing team ${name} {team=${team}}; add a "## ${name} {team=${team}}" section where it belongs`,
      );
    }
  }
  if (problems.length > 0) throw new RankingFileError(file, problems);
}
