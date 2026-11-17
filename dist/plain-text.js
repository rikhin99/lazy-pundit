import { formatRecord } from "./league.js";
import { movementMark } from "./movement.js";
import { stripTags } from "./validator.js";
/** Each platform's name as the pundit reads it. */
export const PLATFORM_NAMES = {
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
        `${weekTitle(week)} · by ${pundit}`,
    ];
    const since = movementSince(week, baseline);
    if (since)
        header.push(since);
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
    blocks.push(credit(league));
    return `${blocks.join("\n\n")}\n`;
}
/** A published ranking's week: "after Week 8", or "Preseason" for week 0. */
export function weekTitle(week) {
    return week === 0 ? "Preseason" : `after Week ${week}`;
}
/**
 * "Movement since week M" (or "since Preseason") when the movement baseline
 * isn't the week before the ranking week; otherwise, and at week 0, none.
 */
export function movementSince(week, baseline) {
    if (week === 0 || !baseline || baseline.week === week - 1)
        return undefined;
    return `Movement since ${baseline.week === 0 ? "Preseason" : `week ${baseline.week}`}`;
}
/** The published ranking's credit line. */
export function credit(league) {
    return `Stats: ${PLATFORM_NAMES[league.platform]} · made with Lazy Pundit`;
}
//# sourceMappingURL=plain-text.js.map