/**
 * Prints one payload from a committed Sleeper fixture week as pretty JSON.
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
 * --league <folder> picks another league under fixtures/sleeper
 * (default fear-the-turtle-2025).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatRecord, isStarter } from "../src/league.ts";
import { SLEEPER_API } from "../src/sleeper/api.ts";
import { normalizeSleeper } from "../src/sleeper/normalizer.ts";
import { readBlob, readManifest, readSnapshot } from "../src/snapshot.ts";
import { standingsThrough } from "../src/standings.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    league: { type: "string", default: "fear-the-turtle-2025" },
    model: { type: "boolean", default: false },
    lineups: { type: "boolean", default: false },
  },
});
const [week, rawPath] = positionals;
if (!week) {
  console.error(
    "usage: npm run fixture:show -- <week> [path | --model | --lineups [<scored week>]] [--league <folder>]",
  );
  process.exit(2);
}

const dir = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "sleeper",
  values.league,
);
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
  const league = normalizeSleeper(await readSnapshot(dir, id));
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
      console.log(
        `  ${names.get(side.team)} (${side.team})  score ${side.score}${side.result ? ` ${side.result}` : ""}  starters' points ${Math.round(sum * 100) / 100}`,
      );
      for (const e of side.lineup) {
        const p = league.players[e.player];
        const positions = (p?.positions ?? [e.position]).join("/");
        console.log(
          `    ${e.slot.padEnd(5)} ${(p?.name ?? e.player).padEnd(24)} ${positions.padEnd(8)} ${e.points}`,
        );
      }
    }
  }
  process.exit(0);
}
if (values.model) {
  const league = normalizeSleeper(await readSnapshot(dir, id));
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
const base = `${SLEEPER_API}/league/${manifest.league_id}`;

if (rawPath === undefined) {
  console.log(`week ${week}: snapshot ${id}`);
  for (const r of manifest.requests) {
    const path = r.url.startsWith(base)
      ? r.url.slice(base.length).replace(/^\//, "") || '""  (league)'
      : r.url.replace(`${SLEEPER_API}/`, "");
    console.log(`  ${path}`);
  }
} else {
  const path = rawPath.replace(/^\//, "");
  // The players file sits outside the league's URLs.
  const url = path.startsWith("players/")
    ? `${SLEEPER_API}/${path}`
    : path
      ? `${base}/${path}`
      : base;
  const request = manifest.requests.find((r) => r.url === url);
  if (!request) {
    console.error(`No ${path || "league"} payload in week ${week}`);
    process.exit(1);
  }
  const body = new TextDecoder().decode(await readBlob(dir, request.sha256));
  console.log(JSON.stringify(JSON.parse(body), null, 2));
}
