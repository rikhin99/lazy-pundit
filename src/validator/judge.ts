import type { TeamId } from "../league.ts";
import { agrees, kindOf, resolve } from "./evidence.ts";
import {
  edgeGroup,
  type Found,
  groupsOf,
  labelNumber,
  type ScoreWords,
} from "./extract.ts";
import { normalize } from "./names.ts";
import { numMatch } from "./numbers.ts";
import type { ClaimStatus, Ctx, Resolved } from "./types.ts";

// ---------- judging ----------

export interface Hit {
  team: TeamId | null;
  stat: string;
  /** Sub-span within the claim, for a score's two halves. */
  part?: { start: number; end: number };
}

export interface Verdict {
  status: ClaimStatus;
  reason: string;
  hits: Hit[];
}

export function teamName(ctx: Ctx, team: TeamId): string {
  return ctx.input.nicknames[team]?.[0] ?? team;
}

export function show(ctx: Ctx, r: Resolved): string {
  const who = r.team && r.team !== ctx.input.team ? `${r.team}/` : "";
  const value =
    r.kind === "team" ? teamName(ctx, String(r.value) as TeamId) : r.value;
  return `${who}${r.stat} is ${value}`;
}

export function judge(
  ctx: Ctx,
  teams: TeamId[],
  text: string,
  f: Found,
): Verdict {
  const week = ctx.evidence.week;
  const shape = f.shape;
  const none = (status: ClaimStatus, reason: string): Verdict => ({
    status,
    reason,
    hits: [],
  });

  if (shape.type === "result") {
    const subjects = teams.filter((t) => t !== shape.opponent);
    const want = shape.won ? "W" : "L";
    for (const t of subjects) {
      const opp = resolve(ctx, `w${week}.opponent`, t);
      const res = resolve(ctx, `w${week}.result`, t);
      if (opp?.value === shape.opponent && res?.value === want) {
        return {
          status: "verified",
          reason: `w${week}.result is ${want} against ${teamName(ctx, shape.opponent)}`,
          hits: [{ team: t, stat: `w${week}.result` }],
        };
      }
    }
    const me = subjects[0];
    if (!me) return none("unchecked", "no team to check this result against");
    const opp = resolve(ctx, `w${week}.opponent`, me);
    const res = resolve(ctx, `w${week}.result`, me);
    if (!opp || !res)
      return none("unchecked", `no week ${week} result in the evidence pack`);
    if (opp.value !== shape.opponent) {
      return none(
        "wrong",
        `w${week}.opponent is ${teamName(ctx, String(opp.value) as TeamId)}`,
      );
    }
    return none("wrong", `w${week}.result is ${res.value}`);
  }

  if (shape.type === "score")
    return judgeScore(ctx, teams, shape, f.end - f.start);

  if (shape.type === "place") {
    const hits: Hit[] = [];
    let first: Resolved | null = null;
    for (const t of teams) {
      const r = resolve(ctx, shape.key, t);
      if (!r || typeof r.value !== "number") continue;
      first ??= r;
      if (shape.test(r.value)) hits.push({ team: t, stat: shape.key });
    }
    if (hits.length)
      return { status: "verified", reason: verifiedReason(ctx, hits), hits };
    if (!first) return none("unchecked", `no ${shape.key} to check against`);
    return none("wrong", show(ctx, first));
  }

  if (shape.type === "move") {
    const t = teams[0];
    const r = t ? resolve(ctx, "move", t) : null;
    if (!t || !r) return none("unchecked", "no movement to check against");
    const ok = r.value === shape.by;
    if (ok)
      return {
        status: "verified",
        reason: verifiedReason(ctx, [{ team: t, stat: "move" }]),
        hits: [{ team: t, stat: "move" }],
      };
    if (r.value === "new")
      return none("wrong", "move is new: the team has no earlier place");
    return none("wrong", show(ctx, r));
  }

  if (shape.type === "group") {
    if (!groupsOf(ctx).length)
      return none("unchecked", "the ranking has no groups");
    const t = teams[0];
    const r = t ? resolve(ctx, "group", t) : null;
    if (!t) return none("unchecked", "no team to check this group against");
    const label = r ? String(r.value) : null;
    const ok =
      label !== null &&
      (shape.label !== undefined
        ? normalize(label) === normalize(shape.label)
        : shape.edge !== undefined
          ? label === edgeGroup(ctx, shape.edge)
          : labelNumber(label) === shape.tier);
    if (ok)
      return {
        status: "verified",
        reason: `group is ${label}`,
        hits: [{ team: t, stat: "group" }],
      };
    return none(
      "wrong",
      label ? `group is ${label}` : "the team isn't in a group",
    );
  }

  if (shape.type === "playoffs") {
    if (shape.want === null) {
      return none(
        "unchecked",
        "a loose playoff phrase; only clinched, a bye or eliminated is checked",
      );
    }
    for (const t of teams) {
      const r = resolve(ctx, "playoffs", t);
      const v = r?.value;
      const ok =
        v === shape.want || (shape.want === "clinched" && v === "clinched_bye");
      if (ok) {
        return {
          status: "verified",
          reason: verifiedReason(ctx, [{ team: t, stat: "playoffs" }]),
          hits: [{ team: t, stat: "playoffs" }],
        };
      }
    }
    const t = teams[0];
    const r = t ? resolve(ctx, "playoffs", t) : null;
    return none(
      "wrong",
      r
        ? show(ctx, r)
        : "no settled playoff status: it still depends on matchups to come",
    );
  }

  // a stat
  const matches = (r: Resolved): boolean => {
    if (shape.record)
      return r.kind === "record" && agrees(ctx, r, shape.record);
    if (
      shape.num &&
      (r.kind === "number" || r.kind === "luck" || r.kind === "ordinal")
    ) {
      if (typeof r.value !== "number") return false;
      if (r.kind === "ordinal" && (shape.num.dp || shape.hedge)) return false;
      const fact = r.kind === "luck" ? Math.abs(r.value) : r.value;
      return numMatch(shape.num, shape.hedge ?? null, fact);
    }
    if (r.kind === "streak") return agrees(ctx, r, text);
    return false;
  };
  const hitsFor = (keys: string[]): Hit[] => {
    const hits: Hit[] = [];
    for (const t of teams) {
      for (const k of keys) {
        const r = resolve(ctx, k, t);
        if (r && matches(r)) hits.push({ team: t, stat: k });
      }
    }
    return hits;
  };

  if (shape.keys.length) {
    const hits = hitsFor(shape.keys);
    if (hits.length)
      return { status: "verified", reason: verifiedReason(ctx, hits), hits };
    if (shape.score) {
      const v = judgeScore(ctx, teams, shape.score, f.end - f.start);
      if (v.status === "verified") return v;
    }
    const t = teams[0];
    const facts = t
      ? shape.keys
          .map((k) => resolve(ctx, k, t))
          .filter((r): r is Resolved => !!r)
      : [];
    if (!facts.length)
      return none(
        "unchecked",
        `no ${shape.keys.join(" or ")} to check against`,
      );
    return none("wrong", facts.map((r) => show(ctx, r)).join(", "));
  }

  // nothing says which stat: try every stat of the right shape
  const pool = new Set<string>();
  for (const t of teams) {
    for (const [k, v] of Object.entries(ctx.evidence.teams[t] ?? {})) {
      const kind = kindOf(k, v);
      if (
        shape.ordinal
          ? kind === "ordinal"
          : kind === "number" || (kind === "ordinal" && !shape.num?.dp)
      ) {
        pool.add(k);
      }
    }
    if (shape.ordinal && ctx.order[t]) pool.add("place");
  }
  const hits = hitsFor([...pool]);
  if (!shape.ordinal) {
    for (const [k, v] of Object.entries(ctx.evidence.league)) {
      if (
        typeof v === "number" &&
        shape.num &&
        numMatch(shape.num, shape.hedge ?? null, v)
      ) {
        hits.push({ team: null, stat: k });
      }
    }
  }
  if (hits.length) {
    return {
      status: "loose",
      reason: `matches ${verifiedReason(ctx, hits)}, but the sentence doesn't say which stat`,
      hits: [],
    };
  }
  return none("unchecked", "no stat in the evidence pack matches");
}

export function judgeScore(
  ctx: Ctx,
  teams: TeamId[],
  shape: ScoreWords,
  length: number,
): Verdict {
  const week = ctx.evidence.week;
  const P = `w${week}.points`;
  const O = `w${week}.opp_points`;
  const first = { start: 0, end: shape.split };
  const second = { start: shape.split + 1, end: length };
  for (const t of teams) {
    const pts = resolve(ctx, P, t)?.value;
    const opp = resolve(ctx, O, t)?.value;
    if (typeof pts !== "number" || typeof opp !== "number") continue;
    if (numMatch(shape.a, null, pts) && numMatch(shape.b, null, opp)) {
      return {
        status: "verified",
        reason: `week ${week} score was ${pts}-${opp}`,
        hits: [
          { team: t, stat: P, part: first },
          { team: t, stat: O, part: second },
        ],
      };
    }
    if (numMatch(shape.a, null, opp) && numMatch(shape.b, null, pts)) {
      return {
        status: "verified",
        reason: `week ${week} score was ${opp}-${pts}, from the opponent's side`,
        hits: [
          { team: t, stat: O, part: first },
          { team: t, stat: P, part: second },
        ],
      };
    }
  }
  const t = teams[0];
  const pts = t ? resolve(ctx, P, t)?.value : undefined;
  const opp = t ? resolve(ctx, O, t)?.value : undefined;
  if (pts === undefined || opp === undefined) {
    return {
      status: "unchecked",
      reason: `no week ${week} score to check against`,
      hits: [],
    };
  }
  return {
    status: "wrong",
    reason: `week ${week} score was ${pts}-${opp}`,
    hits: [],
  };
}

export function idFor(ctx: Ctx, hit: Hit): string {
  return hit.team && hit.team !== ctx.input.team
    ? `${hit.team}/${hit.stat}`
    : hit.stat;
}

export function verifiedReason(ctx: Ctx, hits: Hit[]): string {
  return hits
    .map((h) => {
      const r = resolve(ctx, h.stat, h.team);
      return r ? show(ctx, r) : idFor(ctx, h);
    })
    .join(", ");
}
