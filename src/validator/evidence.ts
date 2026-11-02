import type { TeamId } from "../league.ts";
import { namesTeam } from "./names.ts";
import { firstNum, hedgeBefore, numMatch } from "./numbers.ts";
import type { Ctx, EvidenceValue, Kind, Resolved } from "./types.ts";

// ---------- evidence ----------

/** The stat an ID names, without its `w<N>.` week prefix. */
export function statOf(id: string): string {
  return id.replace(/^w\d+\./, "");
}

/**
 * Stats whose value is a team ID, checked by the team's names: an opponent,
 * a trade partner, and league items such as `wk.high_team` or `wk.upset`.
 */
const TEAM_STATS =
  /^(opponent|trade\.\d+\.with|wk\.\w+_team|wk\.upset|wk\.upset_over|wk\.robbed)$/;

export function kindOf(id: string, value: EvidenceValue): Kind {
  const stat = statOf(id);
  if (stat === "record" || stat === "allplay") return "record";
  if (stat === "streak") return "streak";
  if (stat === "result") return "result";
  if (TEAM_STATS.test(stat)) return "team";
  if (stat === "place" || stat === "standing" || stat === "seed")
    return "ordinal";
  if (stat === "rank" || stat.endsWith("_rank")) return "ordinal";
  if (stat === "luck") return "luck";
  if (stat === "move") return "move";
  if (stat === "group") return "group";
  if (stat === "playoffs") return "playoffs";
  return typeof value === "number" ? "number" : "text";
}

/** Looks an evidence ID up for the section team (or another team, or the league). */
export function resolve(
  ctx: Ctx,
  id: string,
  section: TeamId | null,
): Resolved | null {
  if (id.startsWith("wk.") || /^w\d+\.correction$/.test(id)) {
    const value = ctx.evidence.league[id];
    return value === undefined
      ? null
      : { team: null, stat: id, value, kind: kindOf(id, value) };
  }
  let team = section;
  let stat = id;
  const slash = id.lastIndexOf("/");
  if (slash >= 0) {
    team = id.slice(0, slash) as TeamId;
    stat = id.slice(slash + 1);
  }
  if (!team) return null;
  let value: EvidenceValue | undefined;
  if (stat === "place" || stat === "move" || stat === "group") {
    value = ctx.order[team]?.[stat];
  } else {
    value = ctx.evidence.teams[team]?.[stat];
  }
  return value === undefined
    ? null
    : { team, stat, value, kind: kindOf(stat, value) };
}

// ---------- does text agree with one fact? ----------

export const WIN_WORDS =
  /\b(beat|beats|edged|edges|crushed|smoked|won|wins|win|took down|squeaked past|handled|blew out|outlasted)\b/;
export const LOSS_WORDS = /\b(lost|loses|loss|fell|dropped one|lose)\b/;

export function agrees(ctx: Ctx, r: Resolved, words: string): boolean {
  const t = words.toLowerCase();
  const { value } = r;
  switch (r.kind) {
    case "record": {
      const m = t.match(/(\d+)\s*[-–]\s*(\d+)(?:\s*[-–]\s*(\d+))?/);
      if (!m) return false;
      const written = [m[1], m[2], m[3]].filter((x) => x !== undefined);
      const fact = String(value).split("-");
      if (fact.length === 3 && fact[2] === "0" && written.length === 2) {
        fact.pop();
      }
      return written.join("-") === fact.join("-");
    }
    case "team":
      return namesTeam(ctx, String(value) as TeamId, t);
    case "result": {
      const won = WIN_WORDS.test(t);
      const lost = LOSS_WORDS.test(t);
      if (value === "W") return won && !lost;
      if (value === "L") return lost && !won;
      return /\b(tie|tied|draw)\b/.test(t);
    }
    case "streak": {
      const n = firstNum(t);
      if (!n) return false;
      const fact = String(value);
      const dir = /\b(loss|losses|losing|skid|l's)\b/.test(t)
        ? "L"
        : /\b(win|wins|winning|heater|w's)\b/.test(t)
          ? "W"
          : null;
      return n.num.n === Number(fact.slice(1)) && (!dir || dir === fact[0]);
    }
    case "ordinal": {
      if (typeof value !== "number") return false;
      const n = firstNum(t);
      if (!n) {
        if (
          /\b(lead|leads|leading|top|best|highest|most)\b|week[- ]high/.test(t)
        )
          return value === 1;
        if (/\b(last|worst|lowest|fewest)\b|week[- ]low/.test(t))
          return value === ctx.teamCount;
        return false;
      }
      return n.num.n === value;
    }
    case "luck":
    case "number": {
      if (typeof value !== "number") return false;
      const n = firstNum(t);
      if (!n) return false;
      const fact = r.kind === "luck" ? Math.abs(value) : value;
      return numMatch(n.num, hedgeBefore(t.slice(0, n.index)), fact);
    }
    default:
      return t.includes(String(value).toLowerCase());
  }
}
