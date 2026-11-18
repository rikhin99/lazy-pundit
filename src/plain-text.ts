import { formatRecord, type League, type TeamId } from "./league.ts";
import { type MovementBaseline, movementMark, shownMove } from "./movement.ts";
import type { RankingFile } from "./ranking-file.ts";
import { type OrderEvidence, stripTags } from "./validator.ts";

/** Each platform's name as the pundit reads it. */
export const PLATFORM_NAMES: Record<League["platform"], string> = {
  sleeper: "Sleeper",
  espn: "ESPN",
};

/**
 * The published ranking as plain text for pasting into a group chat. Rendered
 * from the frozen copy, the league data of its snapshot, and its order
 * evidence, whose `move` is shown after each record. No Markdown. A preseason
 * ranking shows no movement.
 */
export function renderPlainText(
  ranking: RankingFile,
  league: League,
  order: Record<TeamId, OrderEvidence>,
  baseline: MovementBaseline | undefined,
): string {
  const blocks = plainTextBlocks(ranking, league, order, baseline);
  return `${blocks.map((b) => b.text).join("\n\n")}\n`;
}

/**
 * One block of the plain text, with what it's about: a team's entry by its
 * team ID, the week intro as `intro`, or null for the header, a group's label
 * and the credit.
 */
export interface PlainTextBlock {
  entry: TeamId | "intro" | null;
  text: string;
}

/**
 * The plain text's blocks in order. Joined by a blank line they're the plain
 * text, so the preview page can mark each entry where it starts.
 */
export function plainTextBlocks(
  ranking: RankingFile,
  league: League,
  order: Record<TeamId, OrderEvidence>,
  baseline: MovementBaseline | undefined,
): PlainTextBlock[] {
  const teams = new Map<string, League["teams"][number]>(
    league.teams.map((t) => [t.id, t]),
  );
  const { week, pundit } = ranking.meta;
  const header = [
    `🏈 ${league.name.toUpperCase()} POWER RANKINGS`,
    `${weekTitle(week)} · by ${pundit}`,
  ];
  const since = movementSince(week, baseline);
  if (since) header.push(since);
  const blocks: PlainTextBlock[] = [{ entry: null, text: header.join("\n") }];
  if (ranking.intro) {
    blocks.push({ entry: "intro", text: stripTags(ranking.intro) });
  }

  let place = 0;
  for (const entry of ranking.entries) {
    if (entry.kind === "group") {
      blocks.push({ entry: null, text: `— ${entry.label.toUpperCase()} —` });
      continue;
    }
    place += 1;
    const team = teams.get(entry.team as TeamId);
    if (!team) throw new Error(`No team ${entry.team} in the league`);
    const move = shownMove(week, order, team.id);
    const mark = move === undefined ? "" : ` ${movementMark(move)}`;
    const line = `${place}. ${team.name} · ${formatRecord(team.standing)}${mark}`;
    blocks.push({
      entry: team.id,
      text: entry.blurb ? `${line}\n${stripTags(entry.blurb)}` : line,
    });
  }

  blocks.push({ entry: null, text: credit(league) });
  return blocks;
}

/** A published ranking's week: "after Week 8", or "Preseason" for week 0. */
export function weekTitle(week: number): string {
  return week === 0 ? "Preseason" : `after Week ${week}`;
}

/**
 * "Movement since week M" (or "since Preseason") when the movement baseline
 * isn't the week before the ranking week; otherwise, and at week 0, none.
 */
export function movementSince(
  week: number,
  baseline: MovementBaseline | undefined,
): string | undefined {
  if (week === 0 || !baseline || baseline.week === week - 1) return undefined;
  return `Movement since ${baseline.week === 0 ? "Preseason" : `week ${baseline.week}`}`;
}

/** The published ranking's credit line. */
export function credit(league: League): string {
  return `Stats: ${PLATFORM_NAMES[league.platform]} · made with Lazy Pundit`;
}
