import type { TeamId } from "./league.ts";
import { agrees, resolve } from "./validator/evidence.ts";
import {
  extract,
  type Found,
  playoffWant,
  units,
} from "./validator/extract.ts";
import {
  type Hit,
  idFor,
  judge,
  LOOSE_PLAYOFF_PHRASE,
  show,
  type Verdict,
} from "./validator/judge.ts";
import { namesTeam, type Span } from "./validator/names.ts";
import { wrongPlayer } from "./validator/players.ts";
import { stakesMentions, swears } from "./validator/swears.ts";
import { type Tag, unwrap } from "./validator/tags.ts";
import type {
  AutoTag,
  CheckedClaim,
  ClaimStatus,
  Ctx,
  EvidencePack,
  OrderEvidence,
  Swear,
  ValidationResult,
  ValidatorInput,
} from "./validator/types.ts";

/**
 * The validator: a pure check of every claim in a blurb or week intro against
 * the evidence pack and order evidence, plus the swearing word list. No I/O,
 * and nothing here knows about the ranking file or the workspace.
 */

export { CLINCHED_LABEL } from "./validator/evidence.ts";
export { normalize, wholeWords } from "./validator/names.ts";
export { applyAutoTags, stripTags } from "./validator/tags.ts";
export type {
  AutoTag,
  CheckedClaim,
  ClaimStatus,
  EvidencePack,
  EvidenceValue,
  OrderEvidence,
  Swear,
  Swearing,
  ValidationResult,
  ValidatorInput,
} from "./validator/types.ts";

// ---------- validate ----------

interface Claim {
  text: string;
  /** Plain-text offsets. */
  start: number;
  end: number;
  tag?: Tag;
  /** For an untagged claim: its shape and the teams its sentence names. */
  untagged?: { shape: Found; teams: TeamId[] };
}

function judgeClaim(ctx: Ctx, claim: Claim, section: TeamId | null): Verdict {
  if (claim.tag && claim.tag.kind !== "ev") {
    const { kind, value } = claim.tag;
    return ctx.input.sections[kind].includes(value)
      ? {
          status: "verified",
          reason: `the ${kind} section ${value} exists`,
          hits: [],
        }
      : {
          status: "unknown-id",
          reason: `cites the ${kind} section "${value}", which doesn't exist`,
          hits: [],
        };
  }
  if (claim.tag) {
    const id = claim.tag.value;
    if (/(^|\/)playoffs$/.test(id) && playoffWant(claim.text) === null) {
      return { status: "unchecked", reason: LOOSE_PLAYOFF_PHRASE, hits: [] };
    }
    const r = resolve(ctx, id, section);
    if (!r) {
      return {
        status: "unknown-id",
        reason: `cites "${id}", which isn't in the evidence pack`,
        hits: [],
      };
    }
    const other = wrongPlayer(ctx, r, claim.text);
    if (other) return { status: "wrong", reason: other, hits: [] };
    return agrees(ctx, r, claim.text)
      ? { status: "verified", reason: show(ctx, r), hits: [] }
      : { status: "wrong", reason: show(ctx, r), hits: [] };
  }
  const u = claim.untagged as NonNullable<Claim["untagged"]>;
  return judge(ctx, u.teams, claim.text, u.shape);
}

export function validate(input: ValidatorInput): ValidationResult {
  const ctxFor = (
    evidence: EvidencePack,
    order: Record<TeamId, OrderEvidence>,
  ): Ctx => ({
    input,
    evidence,
    order,
    teamCount: Object.keys(evidence.teams).length,
  });
  const ctx = ctxFor(input.evidence, input.order);
  const { plain, tags, toInput } = unwrap(input.text);
  /** A plain-text span's place in the text as written. */
  const written = (start: number, end: number): Span => ({
    start: toInput[start] as number,
    end: (toInput[end - 1] as number) + 1,
  });

  const found: Claim[] = [];
  for (const tag of tags) {
    found.push({
      text: tag.inner,
      start: tag.plainStart,
      end: tag.plainEnd,
      tag,
    });
  }
  for (const { s, start } of units(plain)) {
    const named = (Object.keys(input.nicknames) as TeamId[]).filter(
      (t) => t !== input.team && namesTeam(ctx, t, s),
    );
    const teams = input.team ? [input.team, ...named] : named;
    for (const f of extract(ctx, s)) {
      const a = start + f.start;
      const b = start + f.end;
      if (tags.some((t) => a < t.plainEnd && t.plainStart < b)) continue;
      found.push({
        text: s.slice(f.start, f.end),
        start: a,
        end: b,
        untagged: { shape: f, teams },
      });
    }
  }
  found.sort((a, b) => a.start - b.start);

  const claims: CheckedClaim[] = [];
  const autoTags: AutoTag[] = [];
  for (const claim of found) {
    let verdict = judgeClaim(ctx, claim, input.team);
    let cause: CheckedClaim["cause"];
    if (verdict.status === "wrong" && input.before) {
      const tries: [Ctx | null, "refresh" | "reorder"][] = [
        ...(input.before.evidence ?? []).map((earlier): [Ctx, "refresh"] => [
          ctxFor(earlier, input.order),
          "refresh",
        ]),
        [
          input.before.order
            ? ctxFor(input.evidence, input.before.order)
            : null,
          "reorder",
        ],
      ];
      for (const [then, why] of tries) {
        if (!then) continue;
        const was = judgeClaim(then, claim, input.team);
        if (was.status === "verified") {
          verdict = {
            status: "stale",
            reason: `true when written (${was.reason}); now ${verdict.reason}`,
            hits: [],
          };
          cause = why;
          break;
        }
      }
    }
    const out: CheckedClaim = {
      text: claim.text,
      ...(claim.tag
        ? { start: claim.tag.start, end: claim.tag.end }
        : written(claim.start, claim.end)),
      tagged: !!claim.tag,
      status: verdict.status,
      reason: verdict.reason,
    };
    if (claim.tag) {
      out.id =
        claim.tag.kind === "ev"
          ? claim.tag.value
          : `${claim.tag.kind}=${claim.tag.value}`;
    }
    if (cause) out.cause = cause;

    const own = verdict.hits.filter((h) => h.team === input.team);
    const hits = own.length && !own.some((h) => h.part) ? own : verdict.hits;
    const single =
      hits.length === 1 || (hits.length === 2 && hits.every((h) => h.part));
    if (!claim.tag && verdict.status === "verified" && single) {
      if (hits.length === 1) out.id = idFor(ctx, hits[0] as Hit);
      for (const h of hits) {
        const from = claim.start + (h.part?.start ?? 0);
        const to = h.part ? claim.start + h.part.end : claim.end;
        const words = plain.slice(from, to);
        autoTags.push({
          ...written(
            from + (words.length - words.trimStart().length),
            // Trailing punctuation reads as the sentence's, not the claim's.
            to - (/[\s,;:.!?]*$/.exec(words)?.[0].length ?? 0),
          ),
          id: idFor(ctx, h),
        });
      }
    }
    claims.push(out);
  }

  return {
    claims,
    autoTags,
    swears:
      input.swearing === "off"
        ? swears(ctx, plain).map((w) => ({ ...w, ...written(w.start, w.end) }))
        : [],
    stakesMentions: input.noStakes
      ? stakesMentions(ctx, plain).map((w) => ({
          ...w,
          ...written(w.start, w.end),
        }))
      : [],
  };
}

/** Hard problems block nothing on their own, but publish asks before going ahead. */
export function isHard(status: ClaimStatus): boolean {
  return status === "wrong" || status === "stale" || status === "unknown-id";
}

/**
 * The LLM gate: an LLM draft passes only if every claim is tagged and
 * verified, the word list is clean and, under `stakes: none`, nothing
 * mentions money, a prize or a punishment.
 */
export function gateLlm(result: ValidationResult): {
  pass: boolean;
  claims: CheckedClaim[];
  swears: Swear[];
  stakesMentions: Swear[];
} {
  const claims = result.claims.filter(
    (c) => !c.tagged || c.status !== "verified",
  );
  return {
    pass:
      claims.length === 0 &&
      result.swears.length === 0 &&
      result.stakesMentions.length === 0,
    claims,
    swears: result.swears,
    stakesMentions: result.stakesMentions,
  };
}
