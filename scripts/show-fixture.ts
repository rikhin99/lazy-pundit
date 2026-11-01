/**
 * Prints one payload from a committed Sleeper fixture week as pretty JSON.
 *
 *   npm run fixture:show -- <week>            lists the week's payload paths
 *   npm run fixture:show -- <week> <path>     prints one, e.g. rosters, matchups/8, players/nfl
 *   npm run fixture:show -- <week> ""         prints the league payload
 *
 * --league <folder> picks another league under fixtures/sleeper
 * (default fear-the-turtle-2025).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readBlob, readManifest } from "../src/snapshot.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { league: { type: "string", default: "fear-the-turtle-2025" } },
});
const [week, rawPath] = positionals;
if (!week) {
  console.error(
    "usage: npm run fixture:show -- <week> [path] [--league <folder>]",
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
const manifest = await readManifest(dir, id);
const base = `https://api.sleeper.app/v1/league/${manifest.league_id}`;

if (rawPath === undefined) {
  console.log(`week ${week}: snapshot ${id}`);
  for (const r of manifest.requests) {
    const path = r.url.startsWith(base)
      ? r.url.slice(base.length).replace(/^\//, "") || '""  (league)'
      : r.url.replace("https://api.sleeper.app/v1/", "");
    console.log(`  ${path}`);
  }
} else {
  const path = rawPath.replace(/^\//, "");
  // The players file sits outside the league's URLs.
  const url = path.startsWith("players/")
    ? `https://api.sleeper.app/v1/${path}`
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
