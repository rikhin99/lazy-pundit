/**
 * The standings through `week`, in order: each team's W-L-T and points for
 * and against, rebuilt from the scored regular-season matchups up to and
 * including it. A bye gives no result.
 *
 * With median scoring or divisions the recount is skipped and every week
 * gets the standings as reported in the snapshot (spec #37): the matchups don't
 * hold median results, and with divisions the standings stay as the
 * platform reports them.
 *
 * The order is Sleeper's: win percentage (a tie counts as half a win), then
 * points for. Sleeper reports neither rank nor seed, so both come from it.
 * How this was confirmed, and what's still unknown, is in
 * docs/research/sleeper-standings.md.
 * With divisions Sleeper's division seeding isn't modelled, so there's no
 * rank, seed or tiebreak; the list is still sorted by record, so the draft's
 * starting order has one to start from.
 */
export function standingsThrough(league, week) {
    const { divisions } = league.settings;
    const sorted = (standingsAsReported(league)
        ? league.teams.map((t) => ({ team: t.id, ...t.standing }))
        : recount(league, week)).sort((a, b) => winPercentage(b) - winPercentage(a) ||
        b.pointsFor - a.pointsFor ||
        a.team.localeCompare(b.team, "en", { numeric: true }));
    if (divisions > 0) {
        return sorted.map((line) => ({ ...line, rank: null, seed: null }));
    }
    return sorted.map((line, i) => {
        const standing = {
            ...line,
            rank: i + 1,
            seed: i < league.settings.playoffTeams ? i + 1 : null,
        };
        const tied = sorted.filter((o) => o !== line && winPercentage(o) === winPercentage(line));
        if (tied.length > 0) {
            standing.tiebreak = tied.some((o) => o.pointsFor === line.pointsFor)
                ? "unbroken"
                : "points_for";
        }
        return standing;
    });
}
/**
 * Whether the league's standings are as reported as of the fetch for every
 * week, not rebuilt through a week: median scoring or divisions.
 */
export function standingsAsReported(league) {
    return league.settings.median || league.settings.divisions > 0;
}
export function winPercentage(s) {
    const matchups = s.wins + s.losses + s.ties;
    return matchups === 0 ? 0 : (s.wins + s.ties / 2) / matchups;
}
/** Each team's W-L-T and points through `week`, from the scored regular-season matchups. */
function recount(league, week) {
    // Count in cents, so summing scores doesn't drift.
    const lines = new Map(league.teams.map((t) => [
        t.id,
        { team: t.id, wins: 0, losses: 0, ties: 0, pfCents: 0, paCents: 0 },
    ]));
    for (const w of league.weeks) {
        if (!w.scored || w.week > week)
            continue;
        for (const m of w.matchups) {
            if (m.kind !== "regular")
                continue;
            for (const [own, other] of [m.sides, [m.sides[1], m.sides[0]]]) {
                const line = lines.get(own.team);
                if (!line)
                    continue;
                line.pfCents += Math.round(own.score * 100);
                line.paCents += Math.round(other.score * 100);
                if (own.result === "W")
                    line.wins++;
                else if (own.result === "L")
                    line.losses++;
                else if (own.result === "T")
                    line.ties++;
            }
        }
    }
    return [...lines.values()].map(({ pfCents, paCents, ...line }) => ({
        ...line,
        pointsFor: pfCents / 100,
        pointsAgainst: paCents / 100,
    }));
}
//# sourceMappingURL=standings.js.map