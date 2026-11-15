import { z } from "zod";
import type {
  Claim,
  League,
  LeagueSettings,
  LineupEntry,
  LineupSlot,
  Matchup,
  MatchupKind,
  MatchupSide,
  NflPlayer,
  Result,
  RosterSpot,
  Team,
  TeamId,
  Trade,
  Transaction,
  Week,
} from "../league.ts";
import { BENCH } from "../league.ts";
import type { Snapshot } from "../snapshot.ts";
import { ESPN_VIEWS, espnViewUrl } from "./api.ts";

const name = z.string().trim().nullish();

const leagueSchema = z.object({
  id: z.number().int(),
  seasonId: z.number().int(),
  scoringPeriodId: z.number().int().nonnegative(),
  status: z.object({ finalScoringPeriod: z.number().int().positive() }),
  members: z.array(z.object({ id: z.string(), displayName: name })).default([]),
  settings: z.object({
    name: z.string(),
    acquisitionSettings: z.object({
      acquisitionBudget: z.number().default(0),
      isUsingAcquisitionBudget: z.boolean().default(false),
    }),
    draftSettings: z
      .object({
        keeperCount: z.number().default(0),
        leagueSubType: z.string().nullish(),
      })
      .default({ keeperCount: 0 }),
    rosterSettings: z.object({
      lineupSlotCounts: z.record(z.string(), z.number().int()),
    }),
    scoringSettings: z
      .object({
        playoffHomeTeamBonus: z.number().default(0),
        scoringType: z.string().nullish(),
      })
      .default({ playoffHomeTeamBonus: 0 }),
    scheduleSettings: z.object({
      matchupPeriodCount: z.number().int().positive(),
      playoffTeamCount: z.number().int().nonnegative(),
      playoffMatchupPeriodLength: z.number().int().default(1),
      consolationLadderDisabled: z.boolean().default(false),
      playoffSeedingRule: z.string().nullish(),
      divisions: z.array(z.object({ id: z.number().int() })).default([]),
    }),
  }),
  teams: z.array(
    z.object({
      id: z.number().int(),
      name,
      divisionId: z.number().int().nullish(),
      owners: z.array(z.string()).default([]),
      record: z.object({
        overall: z.object({
          wins: z.number().int().default(0),
          losses: z.number().int().default(0),
          ties: z.number().int().default(0),
          pointsFor: z.number().default(0),
          pointsAgainst: z.number().default(0),
        }),
      }),
    }),
  ),
});

const sideBase = z.object({
  teamId: z.number().int(),
  totalPoints: z.number().default(0),
});

const playerSchema = z.object({
  id: z.number().int(),
  fullName: z.string().nullish(),
  defaultPositionId: z.number().int().nullish(),
  proTeamId: z.number().int().nullish(),
  injuryStatus: z.string().nullish(),
  stats: z
    .array(
      z.object({
        scoringPeriodId: z.number().int(),
        statSourceId: z.number().int(),
        statSplitTypeId: z.number().int(),
        appliedTotal: z.number().default(0),
      }),
    )
    .default([]),
});

const entrySchema = z.object({
  playerId: z.number().int(),
  lineupSlotId: z.number().int(),
  playerPoolEntry: z.object({ player: playerSchema }),
});

const boxSideSchema = sideBase.extend({
  rosterForCurrentScoringPeriod: z
    .object({ entries: z.array(entrySchema) })
    .nullish(),
});

const winner = z.enum(["HOME", "AWAY", "TIE", "UNDECIDED"]);

const scheduleSchema = z.object({
  schedule: z.array(
    z.object({
      matchupPeriodId: z.number().int(),
      playoffTierType: z.string().nullish(),
      winner,
      home: sideBase,
      away: sideBase.optional(),
    }),
  ),
});

const boxScoresSchema = z.object({
  schedule: z.array(
    z.object({
      matchupPeriodId: z.number().int(),
      playoffTierType: z.string().nullish(),
      winner,
      home: boxSideSchema,
      away: boxSideSchema.optional(),
    }),
  ),
});

const rostersSchema = z.object({
  teams: z.array(
    z.object({
      id: z.number().int(),
      roster: z.object({
        entries: z.array(
          entrySchema.extend({
            playerPoolEntry: z.object({ player: playerSchema }),
          }),
        ),
      }),
    }),
  ),
});

const transactionsSchema = z.object({
  transactions: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        status: z.string().nullish(),
        teamId: z.number().int(),
        scoringPeriodId: z.number().int().default(0),
        proposedDate: z.number(),
        processDate: z.number().nullish(),
        bidAmount: z.number().default(0),
        items: z
          .array(
            z.object({
              type: z.string(),
              playerId: z.number().int(),
              fromTeamId: z.number().int(),
              toTeamId: z.number().int(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/** ESPN's lineup slot IDs: the starting slots and the positions each accepts. */
const SLOTS: Record<number, LineupSlot> = {
  0: { slot: "QB", positions: ["QB"] },
  2: { slot: "RB", positions: ["RB"] },
  3: { slot: "RB/WR", positions: ["RB", "WR"] },
  4: { slot: "WR", positions: ["WR"] },
  5: { slot: "WR/TE", positions: ["WR", "TE"] },
  6: { slot: "TE", positions: ["TE"] },
  7: { slot: "OP", positions: ["QB", "RB", "WR", "TE"] },
  16: { slot: "DEF", positions: ["DEF"] },
  17: { slot: "K", positions: ["K"] },
  23: { slot: "FLEX", positions: ["RB", "WR", "TE"] },
};
const BENCH_SLOT = 20;
const IR_SLOT = 21;

const POSITIONS: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DEF",
};

const NFL_TEAMS: Record<number, string> = {
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

const INJURIES: Record<string, string | null> = {
  ACTIVE: null,
  NORMAL: null,
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  INJURY_RESERVE: "IR",
  SUSPENSION: "Suspended",
};

const teamId = (id: number): TeamId => `espn:${id}`;

/**
 * The last week whose head-to-head matchups all have a winner, counting from
 * week 1. ESPN has no finality field, and a bye (a home side only) never gets
 * a winner. The fetcher and the normalizer both use this one rule.
 */
export function lastScoredWeekOf(schedule: {
  schedule: { matchupPeriodId: number; winner: string; away?: unknown }[];
}): number {
  const decided = new Map<number, boolean>();
  for (const m of schedule.schedule) {
    if (m.away === undefined) continue;
    decided.set(
      m.matchupPeriodId,
      (decided.get(m.matchupPeriodId) ?? true) && m.winner !== "UNDECIDED",
    );
  }
  let week = 0;
  while (decided.get(week + 1)) week++;
  return week;
}

/** Turns one ESPN snapshot into the league model. Pure. */
export function normalizeEspn(snapshot: Snapshot): League {
  // The URL every request was made on, whatever season the league payload names.
  const first = snapshot.manifest.requests[0];
  if (!first) throw new Error(`Snapshot ${snapshot.id} holds no requests`);
  const base = first.url.split("?")[0] as string;
  const leagueUrl = espnViewUrl(base, ESPN_VIEWS.league);
  const scheduleUrl = espnViewUrl(base, ESPN_VIEWS.schedule);
  const boxScoresUrl = espnViewUrl(base, ESPN_VIEWS.boxscores);
  const transactionsUrl = espnViewUrl(base, ESPN_VIEWS.transactions);
  const payload = <T>(
    url: string,
    schema: z.ZodType<T>,
    params?: Record<string, string>,
  ): T => {
    const parsed = schema.safeParse(snapshot.json(url, params));
    if (!parsed.success) {
      throw new Error(
        `Snapshot ${snapshot.id}: ${url} isn't an ESPN payload we understand`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  };
  const fail = (what: string) => new Error(`Snapshot ${snapshot.id}: ${what}`);

  const league = payload(leagueUrl, leagueSchema);
  const schedule = payload(scheduleUrl, scheduleSchema);
  const sched = league.settings.scheduleSettings;
  // A categories or roto league has no matchup scores to rank by.
  const scoring = league.settings.scoringSettings.scoringType;
  if (scoring != null && scoring !== "H2H_POINTS") {
    throw fail(
      `it's scored by ${scoring}, and Lazy Pundit ranks only head-to-head points leagues`,
    );
  }
  if (sched.playoffMatchupPeriodLength !== 1) {
    throw fail(
      `its playoff rounds last ${sched.playoffMatchupPeriodLength} weeks, and this version reads one-week rounds only`,
    );
  }
  // The standings order (win percentage, then points for) is the one rule
  // confirmed against ESPN's own seeds, so any other would put teams in the wrong seats.
  const seeding = sched.playoffSeedingRule;
  if (seeding != null && seeding !== "TOTAL_POINTS_SCORED") {
    throw fail(
      `it seeds by ${seeding}, and this version reads total points scored as the tiebreak only`,
    );
  }
  const members = new Map(league.members.map((m) => [m.id, m]));
  const lastScoredWeek = lastScoredWeekOf(schedule);
  const weekCount = Math.max(
    Math.min(league.scoringPeriodId, league.status.finalScoringPeriod),
    lastScoredWeek,
  );

  const lineupSlots = Object.entries(
    league.settings.rosterSettings.lineupSlotCounts,
  )
    .map(([id, count]) => ({ id: Number(id), count }))
    .filter(({ id }) => SLOTS[id] !== undefined)
    .sort((a, b) => a.id - b.id)
    .flatMap(({ id, count }) =>
      Array.from({ length: count }, () => SLOTS[id] as LineupSlot),
    );
  const slotOrder = (id: number) => {
    const slot = SLOTS[id];
    return slot ? lineupSlots.indexOf(slot) : -1;
  };
  const playoffHomeBonus = league.settings.scoringSettings.playoffHomeTeamBonus;
  const budget = league.settings.acquisitionSettings;
  const draft = league.settings.draftSettings;
  const settings: LeagueSettings = {
    playoffTeams: sched.playoffTeamCount,
    playoffStartWeek: sched.matchupPeriodCount + 1,
    regularSeasonWeeks: sched.matchupPeriodCount,
    faabBudget: budget.isUsingAcquisitionBudget
      ? budget.acquisitionBudget
      : null,
    losersBracket: !sched.consolationLadderDisabled,
    median: false,
    divisions: sched.divisions.length > 1 ? sched.divisions.length : 0,
    keepers:
      draft.leagueSubType === "DYNASTY"
        ? "dynasty"
        : draft.leagueSubType === "KEEPER" || draft.keeperCount > 0
          ? "keeper"
          : null,
    lineupSlots,
  };

  const players: Record<string, NflPlayer> = {};
  const notePlayer = (p: z.infer<typeof playerSchema>) => {
    const position = POSITIONS[p.defaultPositionId ?? 0] ?? "";
    players[String(p.id)] = {
      id: String(p.id),
      name: p.fullName?.trim() || String(p.id),
      position,
      positions: position ? [position] : [],
      nflTeam: NFL_TEAMS[p.proTeamId ?? 0] ?? null,
      injuryStatus: injury(p.injuryStatus),
      injuryBodyPart: null,
    };
  };

  const rosters = new Map(
    payload(espnViewUrl(base, ESPN_VIEWS.rosters), rostersSchema).teams.map(
      (t) => [t.id, t.roster.entries],
    ),
  );
  const teams: Team[] = league.teams.map((t) => {
    const managers = t.owners.map((id) => ({
      accountId: id,
      displayName: members.get(id)?.displayName || id,
    }));
    const roster: RosterSpot[] = (rosters.get(t.id) ?? []).map((e) => {
      notePlayer(e.playerPoolEntry.player);
      return {
        player: String(e.playerId),
        status:
          e.lineupSlotId === BENCH_SLOT
            ? "bench"
            : e.lineupSlotId === IR_SLOT
              ? "IR"
              : "starter",
      };
    });
    const o = t.record.overall;
    const team: Team = {
      id: teamId(t.id),
      name: t.name || managers[0]?.displayName || `Team ${t.id}`,
      managers,
      standing: {
        wins: o.wins,
        losses: o.losses,
        ties: o.ties,
        pointsFor: o.pointsFor,
        pointsAgainst: o.pointsAgainst,
      },
      roster,
    };
    if (settings.divisions > 0 && t.divisionId != null) {
      team.division = t.divisionId;
    }
    return team;
  });

  const weeks: Week[] = [];
  for (let week = 1; week <= weekCount; week++) {
    if (!snapshot.has(boxScoresUrl, { scoringPeriodId: String(week) }))
      continue;
    const scored = week <= lastScoredWeek;
    const box = payload(boxScoresUrl, boxScoresSchema, {
      scoringPeriodId: String(week),
    });
    const sideOf = (s: z.infer<typeof boxSideSchema>): MatchupSide => ({
      team: teamId(s.teamId),
      score: s.totalPoints,
      lineup: lineup(s.rosterForCurrentScoringPeriod?.entries ?? [], week),
    });
    const byes: TeamId[] = [];
    const matchups: Matchup[] = [];
    for (const g of box.schedule) {
      if (g.matchupPeriodId !== week) continue;
      if (!g.away) {
        byes.push(teamId(g.home.teamId));
        continue;
      }
      const a = sideOf(g.home);
      const b = sideOf(g.away);
      const kind = kindOf(
        g.playoffTierType,
        week > settings.regularSeasonWeeks,
      );
      const matchup: Matchup = { kind, sides: [a, b] };
      if (kind !== "regular") {
        matchup.round = week - settings.regularSeasonWeeks;
        // `a` is the home side, whose `totalPoints` includes the playoff
        // home bonus, in every bracket.
        if (playoffHomeBonus !== 0) a.homeBonus = playoffHomeBonus;
      }
      if (scored && g.winner !== "UNDECIDED") {
        const results: [Result, Result] =
          g.winner === "HOME"
            ? ["W", "L"]
            : g.winner === "AWAY"
              ? ["L", "W"]
              : ["T", "T"];
        a.result = results[0];
        b.result = results[1];
        // ESPN's winner already applies the league's tie rule, so a tied
        // score with a winner is a tiebreak whatever the rule is.
        if (g.winner !== "TIE" && a.score === b.score) {
          a.tiebreak = true;
          b.tiebreak = true;
        }
      }
      matchups.push(matchup);
    }
    weeks.push({ week, scored, matchups, byes });
  }

  const seen = new Set<string>();
  const transactions: Transaction[] = [];
  for (let week = 1; week <= weekCount; week++) {
    if (!snapshot.has(transactionsUrl, { scoringPeriodId: String(week) }))
      continue;
    for (const t of payload(transactionsUrl, transactionsSchema, {
      scoringPeriodId: String(week),
    }).transactions) {
      // An answer for one week can hold another's, so each ID counts once.
      if (seen.has(t.id)) continue;
      const made = transaction(t, week, settings.faabBudget !== null);
      if (!made) continue;
      seen.add(t.id);
      if (made.week <= weekCount) transactions.push(made);
    }
  }
  transactions.sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );

  return {
    platform: "espn",
    leagueId: String(league.id),
    season: String(league.seasonId),
    name: league.settings.name,
    settings,
    lastScoredWeek,
    teams,
    weeks,
    transactions,
    players,
  };

  function lineup(
    entries: z.infer<typeof entrySchema>[],
    week: number,
  ): LineupEntry[] {
    const made = entries.map((e) => {
      const p = e.playerPoolEntry.player;
      notePlayer(p);
      const starting = SLOTS[e.lineupSlotId];
      const entry: LineupEntry = {
        player: String(e.playerId),
        position: players[String(p.id)]?.position ?? "",
        slot: starting?.slot ?? BENCH,
        // Projections (`statSourceId` 1) never count: only the week's actual line.
        points:
          p.stats.find(
            (s) =>
              s.scoringPeriodId === week &&
              s.statSourceId === 0 &&
              s.statSplitTypeId === 1,
          )?.appliedTotal ?? 0,
      };
      if (e.lineupSlotId === IR_SLOT) entry.ir = true;
      return { entry, order: starting ? slotOrder(e.lineupSlotId) : Infinity };
    });
    return made.sort((a, b) => a.order - b.order).map((m) => m.entry);
  }
}

function kindOf(
  tier: string | null | undefined,
  playoffs: boolean,
): MatchupKind {
  if (!playoffs) return "regular";
  if (tier === "LOSERS_CONSOLATION_LADDER") return "losers";
  if (tier === "WINNERS_CONSOLATION_LADDER") return "consolation";
  if (tier === "WINNERS_BRACKET" || tier == null) return "winners";
  throw new Error(
    `a playoff matchup of tier ${tier}, which this version doesn't read`,
  );
}

function injury(status: string | null | undefined): string | null {
  if (!status) return null;
  return status in INJURIES ? (INJURIES[status] ?? null) : status;
}

/** One ESPN transaction as a trade or claim, or undefined when it isn't one that went through. */
function transaction(
  t: z.infer<typeof transactionsSchema>["transactions"][number],
  requestWeek: number,
  faab: boolean,
): Transaction | undefined {
  const week = t.scoringPeriodId || requestWeek;
  const common = {
    id: t.id,
    week,
    at: new Date(t.processDate ?? t.proposedDate).toISOString(),
    adds: t.items
      .filter((i) => i.type === "ADD" || i.type === "TRADE")
      .map((i) => ({
        player: String(i.playerId),
        team: teamId(i.toTeamId),
      })),
    drops: t.items
      .filter((i) => i.type === "DROP" || i.type === "TRADE")
      .map((i) => ({
        player: String(i.playerId),
        team: teamId(i.fromTeamId),
      })),
  };
  if (t.status !== "EXECUTED") return undefined;
  if (t.type === "TRADE_PROPOSAL") {
    const teams = [
      ...new Set(
        t.items.flatMap((i) => [i.fromTeamId, i.toTeamId]).map(teamId),
      ),
    ];
    const trade: Trade = {
      ...common,
      kind: "trade",
      teams,
      faab: [],
      draftPicks: [],
    };
    return trade;
  }
  const kind =
    t.type === "WAIVER"
      ? "waiver"
      : t.type === "FREEAGENT" || t.type === "ROSTER"
        ? "free_agent"
        : undefined;
  if (!kind) return undefined;
  if (!t.items.some((i) => i.type === "ADD" || i.type === "DROP"))
    return undefined;
  const claim: Claim = { ...common, kind, team: teamId(t.teamId) };
  if (faab && kind === "waiver") claim.faabBid = t.bidAmount;
  return claim;
}
