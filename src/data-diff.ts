import { isDeepStrictEqual } from "node:util";
import { coveredData } from "./data-hash.ts";
import type {
  League,
  LeagueSettings,
  Result,
  TeamId,
  Transaction,
} from "./league.ts";
import { standingsAsReported, type TeamStanding } from "./standings.ts";

/** One difference between two snapshots through a ranking week. */
export type DataChange =
  | {
      kind: "result-flipped";
      week: number;
      team: TeamId;
      from: Result | undefined;
      to: Result | undefined;
    }
  | {
      kind: "score-changed";
      week: number;
      team: TeamId;
      from: number;
      to: number;
    }
  | { kind: "lineup-changed"; week: number; team: TeamId }
  /** The pairings, byes or bracket details differ, not only a team's numbers. */
  | { kind: "matchups-changed"; week: number }
  | {
      kind: "standing-changed";
      team: TeamId;
      from: TeamStanding | undefined;
      to: TeamStanding | undefined;
    }
  | { kind: "transaction-added"; transaction: Transaction }
  | { kind: "transaction-removed"; transaction: Transaction }
  | {
      kind: "setting-changed";
      setting: keyof Pick<
        LeagueSettings,
        "playoffTeams" | "regularSeasonWeeks"
      >;
      from: number;
      to: number;
    };

type Covered = ReturnType<typeof coveredData>;
type CoveredWeek = Covered["weeks"][number];

/**
 * The data changes from `old` to `next` through `throughWeek`, over what the
 * data hash covers, plus `inProgressWeek`'s matchups for a draft that let it
 * in. No changes means "data changed" doesn't apply.
 *
 * With median scoring or divisions, standings are as reported as of the fetch
 * (`standingsThrough`), so they move whenever a later week is scored. They
 * aren't compared there; a correction still shows in its week's scores.
 */
export function diff(
  old: League,
  next: League,
  throughWeek: number,
  inProgressWeek?: number,
): DataChange[] {
  const a = coveredData(old, throughWeek, inProgressWeek);
  const b = coveredData(next, throughWeek, inProgressWeek);
  return [
    ...settingChanges(a, b),
    ...weekChanges(a, b),
    ...(standingsAsReported(old) || standingsAsReported(next)
      ? []
      : standingChanges(a, b)),
    ...transactionChanges(a, b),
  ];
}

function settingChanges(a: Covered, b: Covered): DataChange[] {
  return (["playoffTeams", "regularSeasonWeeks"] as const).flatMap((setting) =>
    a[setting] === b[setting]
      ? []
      : [
          {
            kind: "setting-changed" as const,
            setting,
            from: a[setting],
            to: b[setting],
          },
        ],
  );
}

function weekChanges(a: Covered, b: Covered): DataChange[] {
  const weeks = [...new Set([...a.weeks, ...b.weeks].map((w) => w.week))].sort(
    (x, y) => x - y,
  );
  return weeks.flatMap((week) => {
    const was = a.weeks.find((w) => w.week === week);
    const now = b.weeks.find((w) => w.week === week);
    if (isDeepStrictEqual(was, now)) return [];
    const changes = was && now ? sideChanges(was, now) : [];
    return changes.length > 0 ? changes : [{ kind: "matchups-changed", week }];
  });
}

/**
 * What changed for each team in a week whose pairings still match, in side
 * order. Anything else about the week differing leaves this empty.
 */
function sideChanges(was: CoveredWeek, now: CoveredWeek): DataChange[] {
  const { week } = was;
  const sides = (w: CoveredWeek) => w.matchups.flatMap((m) => [...m.sides]);
  const before = new Map(sides(was).map((s) => [s.team, s]));
  const changes: DataChange[] = [];
  for (const side of sides(now)) {
    const { team } = side;
    const prior = before.get(team);
    if (!prior) continue;
    if (prior.result !== side.result) {
      changes.push({
        kind: "result-flipped",
        week,
        team,
        from: prior.result,
        to: side.result,
      });
    }
    if (prior.score !== side.score) {
      changes.push({
        kind: "score-changed",
        week,
        team,
        from: prior.score,
        to: side.score,
      });
    }
    if (!isDeepStrictEqual(prior.lineup, side.lineup)) {
      changes.push({ kind: "lineup-changed", week, team });
    }
  }
  return changes;
}

function standingChanges(a: Covered, b: Covered): DataChange[] {
  const teams = [
    ...new Set([...a.standings, ...b.standings].map((s) => s.team)),
  ];
  return teams.flatMap((team) => {
    const from = a.standings.find((s) => s.team === team);
    const to = b.standings.find((s) => s.team === team);
    return isDeepStrictEqual(from, to)
      ? []
      : [{ kind: "standing-changed" as const, team, from, to }];
  });
}

function transactionChanges(a: Covered, b: Covered): DataChange[] {
  const missing = (from: Transaction[], other: Transaction[]) =>
    from.filter((t) => !other.some((o) => isDeepStrictEqual(o, t)));
  return [
    ...missing(a.transactions, b.transactions).map((transaction) => ({
      kind: "transaction-removed" as const,
      transaction,
    })),
    ...missing(b.transactions, a.transactions).map((transaction) => ({
      kind: "transaction-added" as const,
      transaction,
    })),
  ];
}
