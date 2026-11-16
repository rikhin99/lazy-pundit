import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOT_TAKERY_ID } from "../../scripts/scrub-espn.ts";
import { ESPN_VIEWS, espnLeagueUrl, espnViewUrl } from "../../src/espn/api.ts";
import { type Deps, fileTransport } from "../../src/index.ts";
import { type Patch, patchingTransport } from "./workspace.ts";

export { HOT_TAKERY_ID };

/** The committed Hot Takery 2025 set. */
const HOT_TAKERY = join(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
  "espn",
  "hot-takery-2025",
);

/** Hot Takery's league request, which ESPN answers 401 or 404 when it refuses. */
export const HOT_TAKERY_LEAGUE_URL = espnViewUrl(
  espnLeagueUrl("2025", HOT_TAKERY_ID),
  ESPN_VIEWS.league,
);

/**
 * The same deps, replaying Hot Takery's committed snapshot for `week`.
 * `status` answers the league request with that status and no payload;
 * `privateTo` makes it a private league that only that cookie reads (401
 * otherwise); `league` patches the league payload, which leaves the standings
 * as they are, since they're rebuilt from the matchups. `correction` is a stat
 * correction, the data change a `refresh` run needs: that week's first home
 * score `points` higher, in its box scores.
 */
export function hotTakeryAt(
  deps: Deps,
  week: number,
  opts: {
    status?: number;
    privateTo?: string;
    league?: Patch;
    correction?: { week: number; points: number };
  } = {},
): Deps {
  const weeks = JSON.parse(
    readFileSync(join(HOT_TAKERY, "weeks.json"), "utf8"),
  );
  const inner = patchingTransport(
    fileTransport(HOT_TAKERY, weeks[String(week)] ?? ""),
    opts.league ? { [HOT_TAKERY_LEAGUE_URL]: opts.league } : {},
  );
  const refused = { status: 401, body: new Uint8Array() };
  return {
    ...deps,
    transport: {
      async request(req) {
        if (req.url === HOT_TAKERY_LEAGUE_URL && opts.status !== undefined) {
          return { status: opts.status, body: new Uint8Array() };
        }
        if (
          opts.privateTo !== undefined &&
          req.headers?.Cookie !== `espn_s2=${opts.privateTo}`
        ) {
          return refused;
        }
        const res = await inner.request(req);
        const { correction } = opts;
        // By hand: every week's box scores share one URL, told apart by
        // `scoringPeriodId`, and `patchingTransport` matches the URL alone.
        if (
          !correction ||
          req.url !== HOT_TAKERY_BOX_SCORES_URL ||
          req.params?.scoringPeriodId !== String(correction.week)
        ) {
          return res;
        }
        const box = JSON.parse(new TextDecoder().decode(res.body));
        box.schedule.find(
          (g: { matchupPeriodId: number }) =>
            g.matchupPeriodId === correction.week,
        ).home.totalPoints += correction.points;
        return { ...res, body: new TextEncoder().encode(JSON.stringify(box)) };
      },
    },
  };
}

const HOT_TAKERY_BOX_SCORES_URL = espnViewUrl(
  espnLeagueUrl("2025", HOT_TAKERY_ID),
  ESPN_VIEWS.boxscores,
);
