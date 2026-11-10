/**
 * The points of the best possible lineup a team could have started from its
 * week's roster: every starting slot filled by an eligible player, each
 * player used once. A player is eligible by any of their positions in
 * `players` (the league's `players`), or by their lineup position. Exact,
 * not greedy, so multi-position players and flex slots can't mislead it.
 */
export function bestLineupPoints(lineup, slots, players) {
    const eligible = (e, slot) => (players[e.player]?.positions ?? [e.position]).some((p) => slot.positions.includes(p));
    // The most restrictive slots first, so the search prunes early.
    const ordered = [...slots].sort((a, b) => a.positions.length - b.positions.length);
    const candidates = ordered.map((slot) => lineup
        .map((e, i) => ({ i, cents: Math.round(e.points * 100), e }))
        .filter(({ e }) => eligible(e, slot))
        .sort((a, b) => b.cents - a.cents));
    // An upper bound on what the slots from `k` on can still add.
    const ceiling = candidates.map((c) => Math.max(0, c[0]?.cents ?? 0));
    const remaining = ceiling.map((_, k) => ceiling.slice(k).reduce((a, b) => a + b, 0));
    const used = new Set();
    let best = 0;
    const search = (k, total) => {
        if (k === ordered.length) {
            best = Math.max(best, total);
            return;
        }
        if (total + (remaining[k] ?? 0) <= best)
            return;
        let filled = false;
        for (const c of candidates[k] ?? []) {
            if (used.has(c.i))
                continue;
            filled = true;
            used.add(c.i);
            search(k + 1, total + c.cents);
            used.delete(c.i);
        }
        // No eligible player left: the slot stays empty.
        if (!filled)
            search(k + 1, total);
    };
    search(0, 0);
    return best / 100;
}
//# sourceMappingURL=lineup.js.map