import { z } from "zod";
import { WorkspaceFileError } from "./front-matter.ts";
import type { League, TeamId } from "./league.ts";
import type { RecordedLogEntry } from "./stakes.ts";
/**
 * A ranking file: a draft (`week-NN.md`) or its frozen copy
 * (`week-NN.published.md`). A team's place comes from section order only; a team
 * section's heading text is just a label, and its `{team=…}` tag says which
 * team it is.
 */
export interface RankingFile {
    meta: RankingMeta;
    intro?: string;
    /** Where the intro starts in the file text. */
    introStart?: number;
    entries: Entry[];
}
export type Entry = GroupEntry | TeamEntry;
/** A `#` heading labelling the run of places after it. */
export interface GroupEntry {
    kind: "group";
    label: string;
    line: number;
}
/** A `## <label> {team=<id>}` section. */
export interface TeamEntry {
    kind: "team";
    team: string;
    label: string;
    blurb: string;
    /** Where the blurb starts in the file text. */
    blurbStart: number;
    line: number;
}
/** A ranking file's front matter. Its shape is versioned by `FORMAT`. */
export declare const metaSchema: z.ZodObject<{
    season: z.ZodNumber;
    week: z.ZodNumber;
    in_progress_week: z.ZodOptional<z.ZodNumber>;
    pundit: z.ZodString;
    data_as_of: z.ZodString;
    checked_at: z.ZodString;
    snapshot: z.ZodString;
    earlier_snapshots: z.ZodOptional<z.ZodArray<z.ZodString>>;
    data_hash: z.ZodString;
    starting_order: z.ZodArray<z.ZodString>;
    power_score: z.ZodDiscriminatedUnion<[z.ZodObject<{
        method: z.ZodLiteral<"ramped-blend">;
        weights: z.ZodObject<{
            all_play: z.ZodNumber;
            form: z.ZodNumber;
            record: z.ZodNumber;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        method: z.ZodEnum<{
            "all-play": "all-play";
            ffmwr: "ffmwr";
            ffwrapped: "ffwrapped";
            form: "form";
            ppg: "ppg";
            standings: "standings";
        }>;
    }, z.core.$strict>], "method">;
    persona: z.ZodObject<{
        preset: z.ZodEnum<{
            banter: "banter";
            broadcast: "broadcast";
            family: "family";
            roast: "roast";
        }>;
        swearing: z.ZodEnum<{
            mild: "mild";
            off: "off";
            on: "on";
        }>;
        teasing: z.ZodEnum<{
            light: "light";
            none: "none";
            roast: "roast";
        }>;
        formality: z.ZodEnum<{
            casual: "casual";
            formal: "formal";
            unhinged: "unhinged";
        }>;
        shape: z.ZodEnum<{
            bullets: "bullets";
            prose: "prose";
        }>;
        length: z.ZodString;
        intro: z.ZodEnum<{
            off: "off";
            on: "on";
        }>;
        style_note: z.ZodOptional<z.ZodString>;
        family_league_relaxed: z.ZodBoolean;
    }, z.core.$strict>;
    house_rule_outcomes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    created_at: z.ZodString;
    edition: z.ZodOptional<z.ZodNumber>;
    first_published_at: z.ZodOptional<z.ZodString>;
    blurb_problems: z.ZodOptional<z.ZodObject<{
        hard: z.ZodNumber;
        soft: z.ZodNumber;
    }, z.core.$strip>>;
    log_entries: z.ZodOptional<z.ZodArray<z.ZodObject<{
        week: z.ZodNumber;
        rule: z.ZodOptional<z.ZodString>;
        text: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type RankingMeta = z.infer<typeof metaSchema>;
/** How many hard and soft blurb problems a frozen copy was published with. */
export type BlurbProblems = NonNullable<RankingMeta["blurb_problems"]>;
/** A ranking file that can't be read or doesn't place every team once. */
export declare class RankingFileError extends WorkspaceFileError {
    name: string;
    readonly problems: string[];
    constructor(file: string, problems: string[]);
}
/**
 * The season's last published ranking (`week-NN.published.md`) of a week
 * before `before`, or none before the first publish. One that can't be read is
 * refused, never passed over for an earlier one, with the fix: mend it, or
 * delete it and the next earlier frozen copy is read.
 */
export declare function lastPublished(dir: string, before: number): Promise<{
    week: number;
    ranking: RankingFile;
} | undefined>;
/**
 * The front matter of the season's newest frozen copy of a week up to and
 * including `through`, which `league.md`'s load warnings compare with. None
 * before the first publish, or when that frozen copy can't be read: it then
 * gives no warning rather than stopping the command.
 */
export declare function lastPublishedMeta(dir: string, through: number): Promise<{
    week: number;
    meta: RankingMeta;
} | undefined>;
/** What a frozen copy records of its publish, beside the draft's front matter. */
export interface PublishRecord {
    edition: number;
    firstPublishedAt: string;
    blurbProblems: BlurbProblems;
    /** The Log entries for the week and earlier, as `league.md` holds them now. */
    logEntries: RecordedLogEntry[];
    /** Each house rule's outcome now, when it isn't what the draft recorded. */
    houseRuleOutcomes?: Record<string, string>;
}
/**
 * A frozen copy of a checked draft's `text`: the same text, word for word, with
 * only the publish record's lines (`edition`, `first_published_at`,
 * `blurb_problems`, `log_entries`, and `house_rule_outcomes` when an outcome
 * changed since the draft) added or changed.
 */
export declare function frozenCopy(file: string, text: string, record: PublishRecord): string;
/** What a new draft's sections hold: the week intro and each team's blurb. */
export interface DraftProse {
    /** Empty for no intro section. */
    intro: string;
    blurbs: Partial<Record<TeamId, string>>;
}
/** A new draft: the intro, then the starting order, each team with its blurb. */
export declare function renderDraft(meta: RankingMeta, league: League, order: TeamId[], prose: DraftProse): string;
/** Reads a ranking file, refusing an unknown format version. */
export declare function parseRanking(file: string, text: string): RankingFile;
/**
 * Checks that the file places every team in the league exactly once. Problems
 * are reported, never fixed: the pundit owns the order.
 */
export declare function checkOrder(file: string, ranking: RankingFile, league: League): void;
