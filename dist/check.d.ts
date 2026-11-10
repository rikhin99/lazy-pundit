import type { Deps } from "./deps.ts";
import type { League, TeamId } from "./league.ts";
import type { FailedSection } from "./llm-gate.ts";
import { type Lore } from "./lore.ts";
import { type MovementBaseline } from "./movement.ts";
import { type RankingFile } from "./ranking-file.ts";
import { type Stakes } from "./stakes.ts";
import { type ClaimStatus, type OrderEvidence } from "./validator.ts";
import { type Workspace } from "./workspace.ts";
/**
 * One item in the problems list: something in the draft the pundit should
 * see before publishing. The same list backs `check`, `draft`, `publish` and
 * the editing view; the CLI only formats it.
 */
export interface Problem {
    severity: "hard" | "soft";
    /** The section's team, or null for the intro or a league item. */
    team: TeamId | null;
    /** The team's name in the league, "Intro", or "League" for a league item. */
    section: string;
    /** The file line the words are on, or null for a league item, which has none. */
    line: number | null;
    /** The words at fault, as the league would read them. Empty for a league item. */
    text: string;
    /**
     * `moved`: a moved team, away from its starting place. `small-sample`: the
     * small-sample flag, a league item. `no-stakes`: the no-stakes flag.
     * `failed-fetch`: the failed-fetch item, a league item only the command
     * that fetched lists. `provisional`: a provisional claim.
     * `correction-timing`: the correction-timing reminder, a league item.
     */
    kind: Exclude<ClaimStatus, "verified"> | "swear" | "no-stakes" | "unreadable-tag" | "moved" | "small-sample" | "failed-fetch" | "provisional" | "correction-timing";
    /** Why, in words the pundit reads. */
    reason: string;
    /** For a stale claim: what changed since it held. */
    cause?: "refresh" | "reorder";
    /** The evidence ID cited or matched. */
    id?: string;
    /**
     * A gate failure: LLM prose that never passed the LLM gate was written as
     * its best attempt with this fault in it. Only the new draft's list has it.
     */
    gate?: true;
}
export interface CheckResult {
    week: number;
    /** The draft checked. */
    path: string;
    /** Hard first, then in file order. */
    problems: Problem[];
    /** How many claims were auto-tagged in the file. */
    autoTagged: number;
    /** What reading the lore has to say, personal data included. */
    warnings: string[];
}
/**
 * Re-checks the latest draft: every blurb and the intro against the evidence
 * pack and the order as it stands, writing auto-tags back without changing
 * a word. Problems are reported, never fixed.
 */
export declare function check(workspaceDir: string, _deps: Deps): Promise<CheckResult>;
/** A draft as `check` left it, for publish to freeze. */
export interface CheckedDraft extends CheckResult {
    stem: string;
    dir: string;
    /** The draft's text, auto-tags included. */
    text: string;
    ranking: RankingFile;
    league: League;
    /** The workspace's lore and handles, to name teams in a later league. */
    lore: Lore;
    /** The season's stakes, for evidence on a later league. */
    stakes: Stakes;
    handles: Workspace["handles"];
    /** Each team's order evidence in the checked order. */
    order: Record<TeamId, OrderEvidence>;
    /** What movement was measured against, or none before the first publish. */
    baseline?: MovementBaseline;
    /**
     * A warning, also in `warnings`, for each lore nickname that reads as
     * another team's name in the draft's snapshot and so was left out.
     */
    clashWarnings: string[];
}
/**
 * Reads, checks and auto-tags the latest draft in the workspace's season.
 * With `autoTag: false` the file is left alone, and an untagged claim that
 * could be auto-tagged is simply verified.
 */
export declare function checkDraft(workspaceDir: string, opts?: {
    autoTag?: boolean;
}): Promise<CheckedDraft>;
/**
 * The claims in a checked draft that hold on the data of `from` and fail on the
 * data of `to`: the ones a move between the two makes stale. A nickname that
 * clashes with a name in `to` is left out, as `checkDraft` leaves one out.
 */
export declare function claimsGoingStale(checked: CheckedDraft, from: League, to: League): Problem[];
/** Why a word-list hit is a problem. */
export declare const SWEAR_REASON = "on the word list, and swearing is off";
/** Why a mention of money, a prize or a punishment is a problem under `stakes: none`. */
export declare const NO_STAKES_REASON = "mentions money, a prize or a punishment, and league.md says stakes: none (bragging rights only)";
/**
 * A problems list with a league item only the command knows, such as the
 * failed-fetch item, in its place in the list's order.
 */
export declare function withLeagueItem(problems: Problem[], item: Problem | undefined): Problem[];
/**
 * Whether a problem is a blurb problem: one the validator finds in a blurb or
 * the intro. Named by kind, so a new league item isn't counted by accident.
 */
export declare function isBlurbProblem(p: Problem): boolean;
/** A soft league item: about the whole league, at no team or line. */
export declare function leagueItem(kind: Problem["kind"], reason: string): Problem;
/**
 * A new draft's problems list with each fault of prose that never passed the
 * LLM gate marked as a gate failure where the check lists it: a claim by its
 * text, a word-list hit by its word. A claim the check auto-tagged now cites
 * its evidence and is verified, so it isn't one.
 */
export declare function withGateFailures(checked: CheckedDraft, failed: FailedSection[]): Problem[];
