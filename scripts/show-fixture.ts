/**
 * Prints one payload from a committed fixture week as pretty JSON.
 *
 *   npm run fixture:show -- <week>            lists the week's payload paths
 *   npm run fixture:show -- <week> <path>     prints one, e.g. rosters, matchups/8, players/nfl
 *   npm run fixture:show -- <week> ""         prints the league payload
 *   npm run fixture:show -- <week> --model    prints the normalized model:
 *     teams (scrubbed names, managers, standings as reported, then rank,
 *     seed and tiebreak through the last scored week) and every week's scores,
 *     the values hand-checked test literals should come from
 *   npm run fixture:show -- <week> --lineups [<scored week>]
 *     prints every team's lineup in a scored week (default <week>), by
 *     matchup: slot, player, eligible positions and points, with the
 *     starters' sum. No derived stats, so a best lineup or efficiency is
 *     still worked by hand from it.
 *
 * --platform espn reads fixtures/espn instead of fixtures/sleeper (default
 * sleeper). Its leagues are hot-takery-2025 (the default) and
 * family-league-2025. An ESPN payload's path is its views joined by `+`,
 * then `@` and the scoring period for a week's box scores or transactions:
 * `mSettings+mTeam+mStatus+mNav` is the league payload,
 * `mMatchupScore+mScoreboard@10` week 10's box scores,
 * `mTransactions2@10` its transactions. ESPN's --lineups marks a player in
 * the IR slot `ir`, and gives a side's playoff home bonus, part of the
 * matchup score but not of players' points.
 *
 * --league <folder> picks another league under the platform's folder
 * (default fear-the-turtle-2025 on Sleeper).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { normalizeEspn } from "../src/espn/normalizer.ts";
import { formatRecord, isStarter, type League } from "../src/league.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { normalizeSleeper } from "../src/sleeper/normalizer.ts";
import {
  type Manifest,
  type ManifestRequest,
  readBlob,
  readManifest,
  readSnapshot,
  type Snapshot,
} from "../src/snapshot.ts";
import { standingsThrough } from "../src/standings.ts";

interface FixturePlatform {
  /** The league folder read when `--league` is left out. */
  league: string;
  normalize: (snapshot: Snapshot) => League;
  /** The path a request is listed by and printed with. */
  pathOf: (request: ManifestRequest, manifest: Manifest) => string;
}

const PLATFORMS = new Map<string, FixturePlatform>([
  [
    "sleeper",
    {
      league: "fear-the-turtle-2025",
      normalize: normalizeSleeper,
      // The URL past the league's, or past the API's for the players file.
      pathOf: (r, manifest) => {
        const base = `${SLEEPER_API}/league/${manifest.league_id}`;
        return r.url.startsWith(base)
          ? r.url.slice(base.length).replace(/^\//, "")
          : r.url.replace(`${SLEEPER_API}/`, "");
      },
    },
  ],
  [
    "espn",
    {
      league: "hot-takery-2025",
      normalize: normalizeEspn,
      // The views, then the scoring period where the request names one.
      pathOf: (r) => {
        const views = new URL(r.url).searchParams.getAll("view").join("+");
        const period = r.params.scoringPeriodId;
        return period === undefined ? views : `${views}@${period}`;
      },
    },
  ],
]);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    platform: { type: "string", default: "sleeper" },
    league: { type: "string" },
    model: { type: "boolean", default: false },
    lineups: { type: "boolean", default: false },
  },
});
const [week, rawPath] = positionals;
if (!week) {
  console.error(
    "usage: npm run fixture:show -- <week> [path | --model | --lineups [<scored week>]] [--platform espn] [--league <folder>]",
  );
  process.exit(2);
}

const platform = PLATFORMS.get(values.platform);
if (!platform) {
  console.error(
    `No platform ${values.platform}; platforms: ${[...PLATFORMS.keys()].join(", ")}`,
  );
  process.exit(1);
}
const platformDir = join(
  import.meta.dirname,
  "..",
  "fixtures",
  values.platform,
);
const leagueFolder = values.league ?? platform.league;
const leagues = (await readdir(platformDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
if (!leagues.includes(leagueFolder)) {
  console.error(
    `No league ${leagueFolder} in fixtures/${values.platform}; its leagues: ${leagues.join(", ")}`,
  );
  process.exit(1);
}
const dir = join(platformDir, leagueFolder);
const weeks: Record<string, string> = JSON.parse(
  await readFile(join(dir, "weeks.json"), "utf8"),
);
const id = weeks[week];
if (!id) {
  console.error(
    `No week ${week}; committed weeks: ${Object.keys(weeks).join(", ")}`,
  );
  process.exit(1);
}
if (values.lineups) {
  const league = platform.normalize(await readSnapshot(dir, id));
  const shown = Number(rawPath ?? week);
  const w = league.weeks.find((x) => x.week === shown);
  if (!w) {
    console.error(`No week ${shown} in week ${week}'s snapshot`);
    process.exit(1);
  }
  const names = new Map(league.teams.map((t) => [t.id, t.name]));
  console.log(
    `week ${shown} lineups from week ${week}'s snapshot${w.scored ? "" : " (in progress)"}; slots ${league.settings.lineupSlots.map((x) => (x.positions.join("/") === x.slot ? x.slot : `${x.slot}=${x.positions.join("/")}`)).join(" ")}`,
  );
  for (const m of w.matchups) {
    const kind = m.kind === "regular" ? "" : `  [${m.kind} r${m.round}]`;
    console.log(
      `${m.sides.map((x) => names.get(x.team)).join("  v  ")}${kind}`,
    );
    for (const side of m.sides) {
      const starters = side.lineup.filter(isStarter);
      const sum = starters.reduce((t, e) => t + e.points, 0);
      const bonus =
        side.homeBonus === undefined ? "" : `  home bonus ${side.homeBonus}`;
      console.log(
        `  ${names.get(side.team)} (${side.team})  score ${side.score}${side.result ? ` ${side.result}` : ""}${bonus}  starters' points ${Math.round(sum * 100) / 100}`,
      );
      for (const e of side.lineup) {
        const p = league.players[e.player];
        const positions = (p?.positions ?? [e.position]).join("/");
        console.log(
          `    ${e.slot.padEnd(5)} ${(p?.name ?? e.player).padEnd(24)} ${positions.padEnd(8)} ${e.points}${e.ir ? "  ir" : ""}`,
        );
      }
    }
  }
  process.exit(0);
}
if (values.model) {
  const league = platform.normalize(await readSnapshot(dir, id));
  console.log(
    `${league.name} ${league.season}, week ${week} snapshot ${id}: last scored week ${league.lastScoredWeek}`,
  );
  const names = new Map(league.teams.map((t) => [t.id, t.name]));
  const through = new Map(
    standingsThrough(league, league.lastScoredWeek).map((s) => [s.team, s]),
  );
  for (const t of league.teams) {
    const s = t.standing;
    const managers = t.managers.map((m) => m.displayName).join(", ");
    const st = through.get(t.id);
    const place = st
      ? `  rank ${st.rank ?? "-"}  seed ${st.seed ?? "-"}${st.tiebreak ? `  (${st.tiebreak})` : ""}`
      : "";
    console.log(
      `  ${t.id}  ${t.name} (${managers || "no manager"})  ${formatRecord(s)}  pf ${s.pointsFor}  pa ${s.pointsAgainst}${place}`,
    );
  }
  for (const w of league.weeks) {
    console.log(`week ${w.week}${w.scored ? "" : " (in progress)"}`);
    for (const m of w.matchups) {
      const [a, b] = m.sides;
      const side = (x: typeof a) =>
        `${names.get(x.team)} ${x.score}${x.result ? ` ${x.result}` : ""}`;
      const kind = m.kind === "regular" ? "" : `  [${m.kind} r${m.round}]`;
      console.log(`  ${side(a)}  v  ${side(b)}${kind}`);
    }
    if (w.byes.length) {
      console.log(`  byes: ${w.byes.map((t) => names.get(t)).join(", ")}`);
    }
  }
  process.exit(0);
}

const manifest = await readManifest(dir, id);
const pathOf = (r: ManifestRequest) => platform.pathOf(r, manifest);

if (rawPath === undefined) {
  console.log(`week ${week}: snapshot ${id}`);
  for (const r of manifest.requests) {
    console.log(`  ${pathOf(r) || '""  (league)'}`);
  }
} else {
  const path = rawPath.replace(/^\//, "");
  const request = manifest.requests.find((r) => pathOf(r) === path);
  if (!request) {
    console.error(`No ${path || "league"} payload in week ${week}`);
    process.exit(1);
  }
  const body = new TextDecoder().decode(await readBlob(dir, request.sha256));
  console.log(JSON.stringify(JSON.parse(body), null, 2));
}
