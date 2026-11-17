import { z } from "zod";
import { type Outcome, type Stakes } from "./stakes.ts";
import { type Workspace } from "./workspace.ts";
/** Where the season's `league.md` lives. */
export declare function leagueFilePath(ws: Workspace): string;
/** What the season's `league.md` records. */
export interface LeagueFile {
    familyLeague: boolean;
    stakes: Stakes;
    /** What the body holds that isn't sent, by line. */
    warnings: string[];
}
/** `league.md`'s front matter. Its shape is versioned by `FORMAT`. */
export declare const leagueFileSchema: z.ZodObject<{
    league: z.ZodLiteral<1>;
    season: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
    "family-league": z.ZodOptional<z.ZodEnum<{
        off: "off";
        on: "on";
    }>>;
    stakes: z.ZodOptional<z.ZodLiteral<"none">>;
    "buy-in": z.ZodOptional<z.ZodString>;
    payouts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    "last-place": z.ZodOptional<z.ZodEnum<{
        "losers-bracket": "losers-bracket";
        standings: "standings";
    }>>;
    "house-rules": z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        trigger: z.ZodOptional<z.ZodEnum<{
            champion: "champion";
            "high-score": "high-score";
            "last-place": "last-place";
            "low-score": "low-score";
            "most-left-on-bench": "most-left-on-bench";
        }>>;
        per: z.ZodOptional<z.ZodEnum<{
            season: "season";
            week: "week";
        }>>;
        outcome: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
        spirit: z.ZodOptional<z.ZodEnum<{
            joke: "joke";
            serious: "serious";
        }>>;
        from: z.ZodOptional<z.ZodNumber>;
        until: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    "rivalry-weeks": z.ZodOptional<z.ZodArray<z.ZodObject<{
        week: z.ZodNumber;
        pairs: z.ZodArray<z.ZodTuple<[z.ZodString, z.ZodString], null>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/**
 * Reads a `league.md`'s text, refusing unknown keys, unknown tags and
 * malformed stakes. `handles` are `workspace.md`'s, which a rivalry week's
 * handles resolve through.
 */
export declare function readLeagueFile(text: string, handles?: Workspace["handles"]): LeagueFile;
/** The season's `league.md`; a missing file has the family league off and the stakes unrecorded. */
export declare function loadLeagueFile(ws: Workspace): Promise<LeagueFile>;
/** Whether the season's `league.md` turns the family league on. A missing file means off. */
export declare function familyLeague(ws: Workspace): Promise<boolean>;
/** `$N` is dollars, `N FAAB` is FAAB, anything else is words. */
export declare function outcomeOf(text: string): Outcome;
