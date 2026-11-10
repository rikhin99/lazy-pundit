import { formatRecord } from "./league.js";
import { movementMark } from "./movement.js";
import { stripTags } from "./validator.js";
const PLATFORM_NAMES = {
    sleeper: "Sleeper",
    espn: "ESPN",
};
/**
 * The published ranking as plain text for pasting into a group chat. Rendered
 * from the frozen copy, the league data of its snapshot, and its order
 * evidence, whose `move` is shown after each record. No Markdown. A preseason
 * ranking shows no movement.
 */
export function renderPlainText(ranking, league, order, baseline) {
    const teams = new Map(league.teams.map((t) => [t.id, t]));
    const { week, pundit } = ranking.meta;
    const showMovement = week > 0;
    const header = [
        `🏈 ${league.name.toUpperCase()} POWER RANKINGS`,
        `${week === 0 ? "Preseason" : `after Week ${week}`} · by ${pundit}`,
    ];
    if (showMovement && baseline && baseline.week !== week - 1) {
        header.push(`Movement since ${baseline.week === 0 ? "Preseason" : `week ${baseline.week}`}`);
    }
    const blocks = [header.join("\n")];
    if (ranking.intro)
        blocks.push(stripTags(ranking.intro));
    let place = 0;
    for (const entry of ranking.entries) {
        if (entry.kind === "group") {
            blocks.push(`— ${entry.label.toUpperCase()} —`);
            continue;
        }
        place += 1;
        const team = teams.get(entry.team);
        if (!team)
            throw new Error(`No team ${entry.team} in the league`);
        const move = order[team.id]?.move;
        const mark = showMovement && move !== undefined ? ` ${movementMark(move)}` : "";
        const line = `${place}. ${team.name} · ${formatRecord(team.standing)}${mark}`;
        blocks.push(entry.blurb ? `${line}\n${stripTags(entry.blurb)}` : line);
    }
    blocks.push(`Stats: ${PLATFORM_NAMES[league.platform]} · made with Lazy Pundit`);
    return `${blocks.join("\n\n")}\n`;
}
//# sourceMappingURL=plain-text.js.map