import { type League, type TeamId } from "./league.ts";
import type { EvidenceValue } from "./validator/types.ts";
/**
 * A season's stakes as `league.md` records them: unrecorded (no file, no
 * stakes fields, or a placeholder), bragging rights only (`stakes: none`),
 * or the recorded fields.
 */
export type Stakes = {
    kind: "unrecorded";
} | {
    kind: "none";
} | RecordedStakes;
export interface RecordedStakes {
    kind: "recorded";
    /** Dollars per team, if recorded. */
    buyIn?: number;
    /** By final place, first place first. */
    payouts: Payout[];
    /** What a `last-place` trigger reads. */
    lastPlace: "standings" | "losers-bracket";
    houseRules: HouseRule[];
    rivalryWeeks: RivalryWeek[];
    /** The body's free-text rules, by heading. */
    sections: StakesSection[];
    /** The body's `## Log`, in the file's order. */
    log: LogEntry[];
}
/** A week in which pairs of managers, by handle, are meant to face each other. */
export interface RivalryWeek {
    week: number;
    pairs: [Rival, Rival][];
}
/** A rivalry's manager: the handle, and the accounts `workspace.md` links it to. */
export interface Rival {
    handle: string;
    accounts: string[];
}
/** One headed part of `league.md`'s body, cited as `{stakes=<name>}`. */
export interface StakesSection {
    name: string;
    entries: string[];
}
/** One bullet of the `## Log`, cited as `{log=w<week>}`. */
export interface LogEntry {
    week: number;
    /** The house rule it's about, by ID. */
    rule?: string;
    pinned: boolean;
    text: string;
}
/** One final place's payout: dollars, or a share of the pot in percent. */
export type Payout = {
    dollars: number;
} | {
    share: number;
};
/** Every trigger the tool can work out, as `league.md` names it. */
export declare const TRIGGER_KINDS: readonly ["high-score", "low-score", "most-left-on-bench", "last-place", "champion"];
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
export interface HouseRule {
    id: string;
    name: string;
    trigger?: {
        kind: TriggerKind;
        per: "week" | "season";
    };
    outcome: Outcome;
    /** Whether the rule is meant seriously or as a joke, if `league.md` says. */
    spirit?: "serious" | "joke";
    /** The first week the rule applies to. */
    from?: number;
    /** The last week the rule applies to. */
    until?: number;
}
/** A house rule's outcome, as written: dollars, FAAB, or anything in words. */
export type Outcome = {
    kind: "dollars";
    amount: number;
    text: string;
} | {
    kind: "faab";
    amount: number;
    text: string;
} | {
    kind: "text";
    text: string;
};
export declare const UNRECORDED: Stakes;
/** What the stakes add to the evidence pack for the ranking week. */
export interface StakesEvidence {
    league: Record<string, EvidenceValue>;
    teams: Record<TeamId, Record<string, EvidenceValue>>;
}
/**
 * The pot, each place's payout, and each computable house rule's trigger
 * winners for the ranking week (`wk.rule.<id>`), with every team's count and
 * winnings to date (`rule.<id>.count`, `rule.<id>.winnings`).
 */
export declare function stakesEvidence(stakes: Stakes, league: League, week: number): StakesEvidence;
/**
 * The stakes as a draft may send them: no accounts, rivalry weeks as the
 * teams they pair, and of the Log only the ranking week's and last week's
 * entries plus pinned ones, so an old fine doesn't keep resurfacing.
 */
export type SentStakes = {
    kind: "unrecorded";
} | {
    kind: "none";
} | {
    kind: "recorded";
    buyIn?: number;
    /** By place, first place first, as written: `$100` or `70%`. */
    payouts: string[];
    houseRules: (Omit<HouseRule, "outcome"> & {
        outcome: string;
    })[];
    rivalryWeeks: {
        week: number;
        pairs: [TeamId, TeamId][];
    }[];
    sections: StakesSection[];
    log: LogEntry[];
};
export declare function sentStakes(stakes: Stakes, league: League, week: number): SentStakes;
/**
 * What `{stakes=…}` and `{log=…}` may cite: each stakes section and house
 * rule by name, and each week `log` has an entry for, as `w<N>`. Pass a sent
 * stakes' Log to hold the LLM to what it was sent.
 */
export declare function stakesSectionNames(stakes: Stakes | SentStakes): {
    stakes: string[];
    log: string[];
};
/** The Log entries a draft of `week` may send: that week's and last week's, and pinned ones. */
export declare function sentLog(log: LogEntry[], week: number): LogEntry[];
/**
 * The warnings the stakes load with against the league: triggers to log by
 * hand, and rivalry pairs that name a handle with no team or that the
 * schedule doesn't pair.
 */
export declare function stakesWarnings(stakes: Stakes, league: League): string[];
/** Each house rule's outcome by ID, for a draft to record, or none without house rules. */
export declare function houseRuleOutcomes(stakes: Stakes): Record<string, string> | undefined;
/** One Log entry as a frozen copy records it: what a later change is measured by. */
export type RecordedLogEntry = {
    week: number;
    rule?: string | undefined;
    text: string;
};
/** The Log entries for `week` and earlier, for a frozen copy of `week` to record. */
export declare function logRecord(stakes: Stakes, week: number): RecordedLogEntry[];
/**
 * What loading `league.md` says against the last published week's frozen
 * copy: the changed-outcome warnings, then a Log-edit warning for each Log
 * entry it recorded that's no longer in the Log as it was. Pinning an entry
 * later, or appending one, changes nothing it recorded. None before the first
 * publish, and no Log-edit warning from a frozen copy with no Log record.
 */
export declare function leagueFileChangeWarnings(stakes: Stakes, published: {
    week: number;
    meta: {
        house_rule_outcomes?: Record<string, string> | undefined;
        log_entries?: RecordedLogEntry[] | undefined;
    };
} | undefined): string[];
/** One house rule's trigger winners that changed between two leagues' data. */
export interface TriggerWinnerChange {
    rule: HouseRule;
    week: number;
    from: TeamId[];
    to: TeamId[];
}
/** The trigger winners that differ from `old` to `next` through `throughWeek`. */
export declare function triggerWinnerChanges(stakes: Stakes, old: League, next: League, throughWeek: number): TriggerWinnerChange[];
/**
 * The stat line's part for a team's trigger this week: `[Weekly high
 * score]{ev=wk.rule.high-score} ([2]{ev=rule.high-score.count} this season) ·
 * [$20]{ev=rule.high-score.winnings} to date`, with ", tied with …" inside the
 * first tag for a tie, and the winnings only when the outcome is dollars or FAAB.
 * Then its rivalry: `Rivalry: [Pylon Patrol]{ev=rival}` this week, and
 * `Rivalry next week: [Pylon Patrol]{ev=next_rival}`.
 */
export declare function triggerParts(stakes: Stakes, team: TeamId, league: Record<string, EvidenceValue>, ev: Record<string, EvidenceValue>, names: Map<TeamId, string>): string[];
/**
 * The league stat line's part for each trigger this week, `[Weekly high
 * score: Gus Bus]{ev=wk.rule.high-score}`, then each of this week's
 * rivalries, `[Rivalry week: Gus Bus and Pylon Patrol]{ev=wk.rivalry.1}, won
 * by [Gus Bus]{ev=wk.rivalry.1.winner}`, with no winner for a tie.
 */
export declare function leagueTriggerParts(stakes: Stakes, league: Record<string, EvidenceValue>, names: Map<TeamId, string>): string[];
