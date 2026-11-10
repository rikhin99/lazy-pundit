import { z } from "zod";
import { BENCH } from "../league.js";
import { SLEEPER_API, SLEEPER_PLAYERS_URL } from "./api.js";
const leagueSchema = z.object({
    league_id: z.string(),
    name: z.string(),
    season: z.string(),
    roster_positions: z.array(z.string()).default([]),
    settings: z.object({
        leg: z.number().int().nonnegative().optional(),
        last_scored_leg: z.number().int().nonnegative().nullish(),
        playoff_teams: z.number().int().nonnegative(),
        playoff_week_start: z.number().int().positive(),
        /** 0: one week a round; 1: a two-week final; 2: two weeks a round. */
        playoff_round_type: z.number().int().default(0),
        /** 2 is FAAB. */
        waiver_type: z.number().int().default(0),
        waiver_budget: z.number().int().default(0),
        league_average_match: z.number().int().default(0),
        divisions: z.number().int().nullish(),
        /** 0 redraft, 1 keeper, 2 dynasty. */
        type: z.number().int().default(0),
    }),
});
const usersSchema = z.array(z.object({
    user_id: z.string(),
    display_name: z.string().nullish(),
    metadata: z.object({ team_name: z.string().nullish() }).nullish(),
}));
const playerIds = z.array(z.string()).nullish();
const rostersSchema = z.array(z.object({
    roster_id: z.number().int(),
    owner_id: z.string().nullish(),
    co_owners: z.array(z.string()).nullish(),
    players: playerIds,
    starters: playerIds,
    reserve: playerIds,
    taxi: playerIds,
    settings: z.object({
        wins: z.number().int().default(0),
        losses: z.number().int().default(0),
        ties: z.number().int().default(0),
        fpts: z.number().int().default(0),
        fpts_decimal: z.number().int().default(0),
        fpts_against: z.number().int().default(0),
        fpts_against_decimal: z.number().int().default(0),
        division: z.number().int().nullish(),
    }),
}));
const matchupsSchema = z.array(z.object({
    roster_id: z.number().int(),
    matchup_id: z.number().int().nullish(),
    points: z.number().nullish(),
    custom_points: z.number().nullish(),
    starters: playerIds,
    players: playerIds,
    players_points: z.record(z.string(), z.number()).nullish(),
}));
const bracketSchema = z.array(z.object({
    r: z.number().int(),
    m: z.number().int(),
    t1: z.number().int().nullish(),
    t2: z.number().int().nullish(),
    w: z.number().int().nullish(),
    l: z.number().int().nullish(),
    /** The place this matchup decides (1 the final, 3 third place, …). */
    p: z.number().int().nullish(),
}));
const rosterIdMap = z.record(z.string(), z.number().int()).nullish();
const transactionsSchema = z.array(z.object({
    transaction_id: z.string(),
    type: z.enum(["trade", "waiver", "free_agent", "commissioner"]),
    status: z.string(),
    leg: z.number().int(),
    status_updated: z.number(),
    roster_ids: z.array(z.number().int()).default([]),
    adds: rosterIdMap,
    drops: rosterIdMap,
    settings: z.object({ waiver_bid: z.number().int().nullish() }).nullish(),
    waiver_budget: z
        .array(z.object({
        sender: z.number().int(),
        receiver: z.number().int(),
        amount: z.number().int(),
    }))
        .nullish(),
    draft_picks: z
        .array(z.object({
        season: z.string(),
        round: z.number().int(),
        roster_id: z.number().int(),
        previous_owner_id: z.number().int(),
        owner_id: z.number().int(),
    }))
        .nullish(),
}));
const playersSchema = z.record(z.string(), z.object({
    full_name: z.string().nullish(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    position: z.string().nullish(),
    fantasy_positions: z.array(z.string()).nullish(),
    team: z.string().nullish(),
    injury_status: z.string().nullish(),
    injury_body_part: z.string().nullish(),
}));
/** The positions each Sleeper starting slot accepts, where it isn't its own name. */
const FLEX_SLOTS = {
    FLEX: ["RB", "WR", "TE"],
    WRRB_FLEX: ["RB", "WR"],
    REC_FLEX: ["WR", "TE"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"],
    IDP_FLEX: ["DL", "LB", "DB"],
};
/** `roster_positions` entries that aren't starting slots. */
const NON_STARTING = new Set(["BN", "IR", "TAXI"]);
/** Turns one Sleeper snapshot into the league model. Pure. */
export function normalizeSleeper(snapshot) {
    const base = `${SLEEPER_API}/league/${snapshot.manifest.league_id}`;
    const payload = (url, schema) => {
        const parsed = schema.safeParse(snapshot.json(url));
        if (!parsed.success) {
            throw new Error(`Snapshot ${snapshot.id}: ${url} isn't a Sleeper payload we understand`, { cause: parsed.error });
        }
        return parsed.data;
    };
    const fail = (what) => new Error(`Snapshot ${snapshot.id}: ${what}`);
    const league = payload(base, leagueSchema);
    const users = new Map(payload(`${base}/users`, usersSchema).map((u) => [u.user_id, u]));
    const rosters = payload(`${base}/rosters`, rostersSchema);
    const winners = payload(`${base}/winners_bracket`, bracketSchema);
    const losers = payload(`${base}/losers_bracket`, bracketSchema);
    const players = nflPlayers(payload(SLEEPER_PLAYERS_URL, playersSchema));
    const lastScoredWeek = league.settings.last_scored_leg ?? 0;
    const teamId = (rosterId) => `sleeper:${rosterId}`;
    const positionOf = (id) => players[id]?.position ?? "";
    const s = league.settings;
    const lineupSlots = league.roster_positions
        .filter((slot) => !NON_STARTING.has(slot))
        .map((slot) => ({ slot, positions: FLEX_SLOTS[slot] ?? [slot] }));
    const settings = {
        playoffTeams: s.playoff_teams,
        playoffStartWeek: s.playoff_week_start,
        regularSeasonWeeks: s.playoff_week_start - 1,
        faabBudget: s.waiver_type === 2 ? s.waiver_budget : null,
        losersBracket: losers.length > 0,
        median: s.league_average_match === 1,
        divisions: s.divisions ?? 0,
        keepers: s.type === 1 ? "keeper" : s.type === 2 ? "dynasty" : null,
        lineupSlots,
    };
    const teams = rosters.map((r) => {
        const managers = [r.owner_id, ...(r.co_owners ?? [])]
            .filter((id) => !!id)
            .map((id) => ({
            accountId: id,
            displayName: users.get(id)?.display_name || id,
        }));
        const mainManager = r.owner_id ? users.get(r.owner_id) : undefined;
        const team = {
            id: teamId(r.roster_id),
            name: mainManager?.metadata?.team_name ||
                managers[0]?.displayName ||
                `Team ${r.roster_id}`,
            managers,
            standing: {
                wins: r.settings.wins,
                losses: r.settings.losses,
                ties: r.settings.ties,
                pointsFor: fromParts(r.settings.fpts, r.settings.fpts_decimal),
                pointsAgainst: fromParts(r.settings.fpts_against, r.settings.fpts_against_decimal),
            },
            roster: rosterSpots(r),
        };
        if (settings.divisions > 0 && r.settings.division != null) {
            team.division = r.settings.division;
        }
        return team;
    });
    const bracketMatchups = [
        ...winners.map((g) => ({ ...g, bracket: "winners" })),
        ...losers.map((g) => ({ ...g, bracket: "losers" })),
    ];
    const maxRound = Math.max(0, ...bracketMatchups.map((g) => g.r));
    const roundOf = (week) => {
        const n = week - s.playoff_week_start;
        if (s.playoff_round_type === 2)
            return Math.floor(n / 2) + 1;
        if (s.playoff_round_type === 1)
            return Math.min(n + 1, maxRound);
        return n + 1;
    };
    const weekCount = Math.max(s.leg ?? 0, lastScoredWeek);
    const weeks = [];
    for (let week = 1; week <= weekCount; week++) {
        const url = `${base}/matchups/${week}`;
        if (!snapshot.has(url))
            continue;
        const scored = week <= lastScoredWeek;
        const byMatchup = new Map();
        const byes = [];
        for (const m of payload(url, matchupsSchema)) {
            if (m.matchup_id == null) {
                byes.push(teamId(m.roster_id));
                continue;
            }
            const side = {
                team: teamId(m.roster_id),
                score: m.custom_points ?? m.points ?? 0,
                lineup: lineup(m, lineupSlots, positionOf),
            };
            byMatchup.set(m.matchup_id, [
                ...(byMatchup.get(m.matchup_id) ?? []),
                side,
            ]);
        }
        const matchups = [...byMatchup].map(([id, sides]) => {
            const [a, b] = sides;
            if (sides.length !== 2 || !a || !b) {
                throw fail(`week ${week} matchup ${id} has ${sides.length} teams`);
            }
            if (week < s.playoff_week_start) {
                if (scored) {
                    a.result = result(a.score, b.score);
                    b.result = result(b.score, a.score);
                }
                return { kind: "regular", sides: [a, b] };
            }
            const round = roundOf(week);
            const pair = new Set([a.team, b.team]);
            const entry = bracketMatchups.find((g) => g.r === round &&
                g.t1 != null &&
                g.t2 != null &&
                pair.has(teamId(g.t1)) &&
                pair.has(teamId(g.t2)));
            if (!entry) {
                throw fail(`week ${week} has a playoff matchup between ${a.team} and ${b.team} that isn't in either bracket's round ${round}`);
            }
            const kind = entry.bracket === "losers"
                ? "losers"
                : entry.p == null || entry.p === 1
                    ? "winners"
                    : "consolation";
            // A two-week round isn't decided by one week's score: wait for the bracket.
            const singleWeekRound = s.playoff_round_type === 0;
            if (scored && (entry.w != null || singleWeekRound)) {
                for (const [own, other] of [
                    [a, b],
                    [b, a],
                ]) {
                    // The bracket's winner stands, including one decided by a tiebreak.
                    own.result =
                        entry.w != null
                            ? teamId(entry.w) === own.team
                                ? "W"
                                : "L"
                            : result(own.score, other.score);
                    if (entry.w != null && own.score === other.score) {
                        own.tiebreak = true;
                    }
                }
            }
            return { kind, round, sides: [a, b] };
        });
        weeks.push({ week, scored, matchups, byes });
    }
    const transactions = [];
    for (let week = 1; week <= weekCount; week++) {
        const url = `${base}/transactions/${week}`;
        if (!snapshot.has(url))
            continue;
        for (const t of payload(url, transactionsSchema)) {
            if (t.status !== "complete")
                continue;
            const moves = (m) => Object.entries(m ?? {}).map(([player, rosterId]) => ({
                player,
                team: teamId(rosterId),
            }));
            const common = {
                id: t.transaction_id,
                week: t.leg,
                at: new Date(t.status_updated).toISOString(),
                adds: moves(t.adds),
                drops: moves(t.drops),
            };
            if (t.type === "trade") {
                const trade = {
                    ...common,
                    kind: "trade",
                    teams: t.roster_ids.map(teamId),
                    faab: (t.waiver_budget ?? []).map((b) => ({
                        from: teamId(b.sender),
                        to: teamId(b.receiver),
                        amount: b.amount,
                    })),
                    draftPicks: (t.draft_picks ?? []).map((p) => ({
                        season: p.season,
                        round: p.round,
                        team: teamId(p.roster_id),
                        from: teamId(p.previous_owner_id),
                        to: teamId(p.owner_id),
                    })),
                };
                transactions.push(trade);
            }
            else {
                const rosterId = t.roster_ids[0];
                if (rosterId === undefined) {
                    throw fail(`transaction ${t.transaction_id} names no team`);
                }
                const claim = {
                    ...common,
                    kind: t.type,
                    team: teamId(rosterId),
                };
                const bid = t.settings?.waiver_bid;
                if (settings.faabBudget !== null &&
                    t.type === "waiver" &&
                    bid != null) {
                    claim.faabBid = bid;
                }
                transactions.push(claim);
            }
        }
    }
    transactions.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    return {
        platform: "sleeper",
        leagueId: league.league_id,
        season: league.season,
        name: league.name,
        settings,
        lastScoredWeek,
        teams,
        weeks,
        transactions,
        players,
    };
}
/** A matchup's roster: starters in slot order, then everyone else on the bench. */
function lineup(m, slots, positionOf) {
    const points = m.players_points ?? {};
    const entry = (player, slot) => ({
        player,
        position: positionOf(player),
        slot,
        points: points[player] ?? 0,
    });
    const starters = (m.starters ?? []).flatMap((player, i) => {
        const slot = slots[i];
        // "0" is an empty slot.
        return player === "0" || !slot ? [] : [entry(player, slot.slot)];
    });
    const started = new Set(starters.map((e) => e.player));
    const bench = (m.players ?? [])
        .filter((p) => !started.has(p))
        .map((p) => entry(p, BENCH));
    return [...starters, ...bench];
}
function rosterSpots(r) {
    const status = new Map();
    for (const p of r.players ?? [])
        status.set(p, "bench");
    for (const p of r.starters ?? [])
        if (p !== "0")
            status.set(p, "starter");
    for (const p of r.reserve ?? [])
        status.set(p, "IR");
    for (const p of r.taxi ?? [])
        status.set(p, "taxi");
    return [...status].map(([player, s]) => ({ player, status: s }));
}
function nflPlayers(raw) {
    const players = {};
    for (const [id, p] of Object.entries(raw)) {
        const positions = p.fantasy_positions ?? (p.position ? [p.position] : []);
        players[id] = {
            id,
            name: p.full_name ||
                [p.first_name, p.last_name].filter(Boolean).join(" ") ||
                id,
            position: p.position || positions[0] || "",
            positions,
            nflTeam: p.team ?? null,
            injuryStatus: p.injury_status ?? null,
            injuryBodyPart: p.injury_body_part ?? null,
        };
    }
    return players;
}
/** Sleeper splits a points total into an integer and hundredths. */
function fromParts(whole, hundredths) {
    return (whole * 100 + hundredths) / 100;
}
function result(own, other) {
    return own > other ? "W" : own < other ? "L" : "T";
}
//# sourceMappingURL=normalizer.js.map