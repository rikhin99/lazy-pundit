import { standingsThrough } from "./standings.js";
/**
 * Each team's settled playoff status through `week`, from conservative bounds
 * on each team alone: its record with every remaining matchup lost, and with
 * every one won. The remaining pairings aren't used, so this can stay quiet a
 * week longer than an exact search, but it never makes a false claim.
 *
 * - Clinched (N spots): fewer than N other teams can finish level with the
 *   team or ahead of it. A clinched bye is the same test with N = the byes.
 * - Eliminated: at least as many teams as there are spots are sure to finish
 *   ahead of it.
 *
 * Finishing level counts against the team, since the tiebreak isn't known
 * yet. Once the regular season is over points for is known, so it decides a
 * level finish, and only a level finish on points for too stays open.
 *
 * Divisions and median scoring give no status: the standings don't recount
 * them, and a division winner's seed doesn't follow the record.
 */
export function playoffStatuses(league, week) {
    const { median, divisions, playoffTeams: spots } = league.settings;
    const statuses = new Map();
    if (median || divisions > 0 || spots <= 0)
        return statuses;
    const seasonOver = week >= league.settings.regularSeasonWeeks;
    const byes = playoffByes(spots);
    const all = bounds(league, week);
    for (const own of all) {
        const others = all.filter((o) => o !== own);
        const threats = others.filter((o) => canFinishAhead(o, own, seasonOver)).length;
        const sureAhead = others.filter((o) => isSureAhead(o, own, seasonOver)).length;
        if (threats < byes)
            statuses.set(own.team, "clinched_bye");
        else if (threats < spots)
            statuses.set(own.team, "clinched");
        else if (sureAhead >= spots)
            statuses.set(own.team, "eliminated");
    }
    return statuses;
}
/**
 * The teams whose status changed in ranking week `week`, against the same
 * snapshot recomputed through the week before, in standings order. A team
 * that had a spot and now has a bye counts under `clinched`.
 */
export function settledThisWeek(league, week) {
    const now = playoffStatuses(league, week);
    const before = playoffStatuses(league, week - 1);
    const changed = standingsThrough(league, week)
        .map((s) => s.team)
        .filter((t) => now.get(t) !== before.get(t));
    return {
        clinched: changed.filter((t) => now.get(t)?.startsWith("clinched")),
        eliminated: changed.filter((t) => now.get(t) === "eliminated"),
    };
}
/** The next power of two at or above the spots, minus the spots. */
function playoffByes(spots) {
    let bracket = 1;
    while (bracket < spots)
        bracket *= 2;
    return bracket - spots;
}
/**
 * Each team's bounds. The in-progress week counts as remaining, and a known
 * regular-season bye is a matchup that can't be won. A later week's byes aren't
 * known yet, so those weeks count as matchups: that only widens the bounds.
 */
function bounds(league, week) {
    const { regularSeasonWeeks } = league.settings;
    return standingsThrough(league, week).map((s) => {
        let remaining = Math.max(0, regularSeasonWeeks - week);
        for (const w of league.weeks) {
            if (w.week > week && w.week <= regularSeasonWeeks) {
                if (w.byes.includes(s.team))
                    remaining--;
            }
        }
        const won = s.wins + s.ties / 2;
        const matchups = s.wins + s.losses + s.ties + remaining;
        return {
            team: s.team,
            worst: matchups === 0 ? 0 : won / matchups,
            best: matchups === 0 ? 0 : (won + remaining) / matchups,
            pointsFor: s.pointsFor,
        };
    });
}
function canFinishAhead(other, own, seasonOver) {
    if (other.best !== own.worst)
        return other.best > own.worst;
    return !seasonOver || other.pointsFor >= own.pointsFor;
}
function isSureAhead(other, own, seasonOver) {
    if (other.worst !== own.best)
        return other.worst > own.best;
    return seasonOver && other.pointsFor > own.pointsFor;
}
//# sourceMappingURL=playoff-status.js.map