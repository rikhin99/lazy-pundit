import { formatRecord, type League, type TeamId } from "./league.ts";
import type { RankingFile } from "./ranking-file.ts";

const PLATFORM_NAMES: Record<League["platform"], string> = {
  sleeper: "Sleeper",
  espn: "ESPN",
};

/**
 * The published ranking as plain text for pasting into a group chat. Rendered
 * from the frozen copy and the league data of its snapshot. No Markdown.
 */
export function renderPlainText(ranking: RankingFile, league: League): string {
  const teams = new Map<string, League["teams"][number]>(
    league.teams.map((t) => [t.id, t]),
  );
  const { week, pundit } = ranking.meta;
  const blocks: string[] = [
    `🏈 ${league.name.toUpperCase()} POWER RANKINGS\n${
      week === 0 ? "Preseason" : `after Week ${week}`
    } · by ${pundit}`,
  ];
  if (ranking.intro) blocks.push(stripTags(ranking.intro));

  let place = 0;
  for (const entry of ranking.entries) {
    if (entry.kind === "group") {
      blocks.push(`— ${entry.label.toUpperCase()} —`);
      continue;
    }
    place += 1;
    const team = teams.get(entry.team as TeamId);
    if (!team) throw new Error(`No team ${entry.team} in the league`);
    const line = `${place}. ${team.name} · ${formatRecord(team.standing)}`;
    blocks.push(entry.blurb ? `${line}\n${stripTags(entry.blurb)}` : line);
  }

  blocks.push(
    `Stats: ${PLATFORM_NAMES[league.platform]} · made with Lazy Pundit`,
  );
  return `${blocks.join("\n\n")}\n`;
}

/** `[7-1]{ev=record}` → `7-1`: claim tags are for the tool, not the league. */
function stripTags(text: string): string {
  return text.replace(/\[([^\]]*)\]\{[^{}]*\}/g, "$1");
}
