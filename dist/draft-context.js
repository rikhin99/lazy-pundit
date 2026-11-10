/** The draft context for a new draft of the ranking week in `data`. */
export function draftContext(league, data, persona, lore, stakes, lastBlurbs) {
    return {
        league: league.name,
        season: league.season,
        week: data.week,
        ...(data.inProgressWeek !== undefined && {
            inProgressWeek: data.inProgressWeek,
        }),
        teams: league.teams.map((t) => ({
            id: t.id,
            name: t.name,
            managers: t.managers.map((m) => m.displayName),
        })),
        evidence: data.evidence,
        persona,
        lore,
        stakes,
        ...(lastBlurbs ? { lastBlurbs } : {}),
    };
}
//# sourceMappingURL=draft-context.js.map