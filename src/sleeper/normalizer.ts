import { z } from "zod";
import type {
  League,
  Matchup,
  MatchupSide,
  Result,
  Team,
  TeamId,
  Week,
} from "../league.ts";
import type { Snapshot } from "../snapshot.ts";
import { SLEEPER_API } from "./fetcher.ts";

const leagueSchema = z.object({
  league_id: z.string(),
  name: z.string(),
  season: z.string(),
  settings: z.object({
    leg: z.number().int().nonnegative().optional(),
    last_scored_leg: z.number().int().nonnegative().nullish(),
  }),
});

const usersSchema = z.array(
  z.object({
    user_id: z.string(),
    display_name: z.string().nullish(),
    metadata: z.object({ team_name: z.string().nullish() }).nullish(),
  }),
);

const rostersSchema = z.array(
  z.object({
    roster_id: z.number().int(),
    owner_id: z.string().nullish(),
    settings: z.object({
      wins: z.number().int().default(0),
      losses: z.number().int().default(0),
      ties: z.number().int().default(0),
      fpts: z.number().int().default(0),
      fpts_decimal: z.number().int().default(0),
    }),
  }),
);

const matchupsSchema = z.array(
  z.object({
    roster_id: z.number().int(),
    matchup_id: z.number().int().nullish(),
    points: z.number().nullish(),
    custom_points: z.number().nullish(),
  }),
);

/** Turns one Sleeper snapshot into the league model. Pure. */
export function normalizeSleeper(snapshot: Snapshot): League {
  const base = `${SLEEPER_API}/league/${snapshot.manifest.league_id}`;
  const payload = <T>(path: string, schema: z.ZodType<T>): T => {
    const url = `${base}${path}`;
    const parsed = schema.safeParse(snapshot.json(url));
    if (!parsed.success) {
      throw new Error(
        `Snapshot ${snapshot.id}: ${url} isn't a Sleeper payload we understand`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  };

  const league = payload("", leagueSchema);
  const users = new Map(
    payload("/users", usersSchema).map((u) => [u.user_id, u]),
  );
  const lastScoredWeek = league.settings.last_scored_leg ?? 0;
  const teamId = (rosterId: number): TeamId => `sleeper:${rosterId}`;

  const teams: Team[] = payload("/rosters", rostersSchema).map((r) => {
    const manager = r.owner_id ? users.get(r.owner_id) : undefined;
    return {
      id: teamId(r.roster_id),
      name:
        manager?.metadata?.team_name ||
        manager?.display_name ||
        `Team ${r.roster_id}`,
      standing: {
        wins: r.settings.wins,
        losses: r.settings.losses,
        ties: r.settings.ties,
        pointsFor: r.settings.fpts + r.settings.fpts_decimal / 100,
      },
    };
  });

  const weekCount = Math.max(league.settings.leg ?? 0, lastScoredWeek);
  const weeks: Week[] = [];
  for (let week = 1; week <= weekCount; week++) {
    const path = `/matchups/${week}`;
    if (!snapshot.has(`${base}${path}`)) continue;
    const scored = week <= lastScoredWeek;
    const byMatchup = new Map<number, MatchupSide[]>();
    const byes: TeamId[] = [];
    for (const m of payload(path, matchupsSchema)) {
      if (m.matchup_id == null) {
        byes.push(teamId(m.roster_id));
        continue;
      }
      const side: MatchupSide = {
        team: teamId(m.roster_id),
        score: m.custom_points ?? m.points ?? 0,
      };
      byMatchup.set(m.matchup_id, [
        ...(byMatchup.get(m.matchup_id) ?? []),
        side,
      ]);
    }
    const matchups: Matchup[] = [...byMatchup].map(([id, sides]) => {
      const [a, b] = sides;
      if (sides.length !== 2 || !a || !b) {
        throw new Error(
          `Snapshot ${snapshot.id}: week ${week} matchup ${id} has ${sides.length} teams`,
        );
      }
      if (scored) {
        a.result = result(a.score, b.score);
        b.result = result(b.score, a.score);
      }
      return { sides: [a, b] };
    });
    weeks.push({ week, scored, matchups, byes });
  }

  return {
    platform: "sleeper",
    leagueId: league.league_id,
    season: league.season,
    name: league.name,
    lastScoredWeek,
    teams,
    weeks,
  };
}

function result(own: number, other: number): Result {
  return own > other ? "W" : own < other ? "L" : "T";
}
