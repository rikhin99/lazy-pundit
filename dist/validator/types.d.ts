import type { TeamId } from "../league.ts";
/** One evidence value: a number, or text such as `7-1`, `W3`, `W` or a team ID. */
export type EvidenceValue = number | string;
/** The stats a claim may cite, by evidence ID, as the ranking week saw them. */
export interface EvidencePack {
    /** The ranking week: untagged weekly claims are read as `w<week>.…`. */
    week: number;
    /** Each team's stats by bare evidence ID (`record`, `w8.points`). */
    teams: Record<TeamId, Record<string, EvidenceValue>>;
    /** League-wide items by evidence ID (`wk.high`). */
    league: Record<string, EvidenceValue>;
}
/** A team's place, movement and group, read from the draft's current order. */
export interface OrderEvidence {
    place: number;
    /**
     * Places climbed since the movement baseline (negative for a fall), or
     * `new` for a team with no place in it or with no baseline at all. Absent
     * (a first draft's LLM gate) leaves movement wording unchecked.
     */
    move?: number | "new";
    /** The text of the enclosing group heading, if any. */
    group?: string;
}
export type Swearing = "off" | "mild" | "on";
export interface ValidatorInput {
    /** A blurb or week intro, as written in the draft. */
    text: string;
    /** The team whose section this is, or null for the week intro. */
    team: TeamId | null;
    evidence: EvidencePack;
    /** Order evidence per team. Empty when the text was drafted without it. */
    order: Record<TeamId, OrderEvidence>;
    /** Every name a team goes by: its name, its managers' names and lore nicknames. */
    nicknames: Record<TeamId, string[]>;
    /** The lore, stakes and log sections that exist, as `{lore=…}` and friends cite them. */
    sections: {
        lore: string[];
        stakes: string[];
        log: string[];
    };
    swearing: Swearing;
    /**
     * The league's stakes say bragging rights only (`stakes: none`), so any
     * mention of money, a prize or a punishment is flagged.
     */
    noStakes?: boolean;
    /**
     * The evidence and order the text was earlier checked against, when they
     * differ from now, newest evidence first. A claim that held then and fails
     * now is stale.
     */
    before?: {
        evidence?: EvidencePack[];
        order?: Record<TeamId, OrderEvidence>;
    };
}
export type ClaimStatus = "verified" | "wrong" | "stale" | "unknown-id" | "loose" | "unchecked";
export interface CheckedClaim {
    /** The claim's words, without any tag. */
    text: string;
    /** Where the claim sits in the input text, tag included when it has one. */
    start: number;
    end: number;
    tagged: boolean;
    /** The evidence ID cited, or for an untagged claim the one it matched. */
    id?: string;
    status: ClaimStatus;
    /** Why, in words the pundit reads. */
    reason: string;
    /** For a stale claim: what changed since it held. */
    cause?: "refresh" | "reorder";
}
/** An evidence tag to add around `[start, end)` of the input text. */
export interface AutoTag {
    start: number;
    end: number;
    id: string;
}
export interface Swear {
    word: string;
    start: number;
    end: number;
}
export interface ValidationResult {
    claims: CheckedClaim[];
    autoTags: AutoTag[];
    swears: Swear[];
    /** Under `noStakes`, each mention of money, a prize or a punishment. */
    stakesMentions: Swear[];
}
export type Kind = "record" | "streak" | "result" | "team" | "teams" | "ordinal" | "luck" | "move" | "group" | "playoffs" | "knocked_out" | "player" | "number" | "text";
export interface Ctx {
    input: ValidatorInput;
    evidence: EvidencePack;
    order: Record<TeamId, OrderEvidence>;
    teamCount: number;
}
export interface Resolved {
    team: TeamId | null;
    stat: string;
    value: EvidenceValue;
    kind: Kind;
    /** For a league item cited in a team's section: that team. */
    section?: TeamId | null;
}
