import { z } from "zod";
import type { Deps } from "./deps.ts";
declare const setupStatus: z.ZodEnum<{
    default: "default";
    done: "done";
    skipped: "skipped";
}>;
/** `workspace.md`'s front matter. Its shape is versioned by `FORMAT`. */
export declare const workspaceSchema: z.ZodObject<{
    pundit: z.ZodString;
    seasons: z.ZodRecord<z.ZodString, z.ZodObject<{
        platform: z.ZodLiteral<"sleeper">;
        league_id: z.ZodString;
    }, z.core.$strip>>;
    handles: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    setup: z.ZodOptional<z.ZodObject<{
        handles: z.ZodOptional<z.ZodEnum<{
            default: "default";
            done: "done";
            skipped: "skipped";
        }>>;
        lore: z.ZodOptional<z.ZodEnum<{
            default: "default";
            done: "done";
            skipped: "skipped";
        }>>;
        stakes: z.ZodOptional<z.ZodEnum<{
            default: "default";
            done: "done";
            skipped: "skipped";
        }>>;
        method: z.ZodOptional<z.ZodEnum<{
            default: "default";
            done: "done";
            skipped: "skipped";
        }>>;
        persona: z.ZodOptional<z.ZodEnum<{
            default: "default";
            done: "done";
            skipped: "skipped";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SetupStatus = z.infer<typeof setupStatus>;
/** A setup step whose status `workspace.md` records, since it belongs to the league. */
export type LeagueStep = keyof NonNullable<z.output<typeof workspaceSchema>["setup"]>;
export interface Workspace {
    dir: string;
    pundit: string;
    /** The latest season the workspace names. */
    season: {
        year: string;
        platform: "sleeper";
        leagueId: string;
    };
    /** Each manager handle's linked platform accounts. */
    handles: Record<string, string[]>;
    /** How each league-level setup step went. A step it doesn't name wasn't recorded. */
    setup: NonNullable<z.output<typeof workspaceSchema>["setup"]>;
}
/** Reads `workspace.md`. */
export declare function readWorkspace(dir: string): Promise<Workspace>;
/**
 * The workspace a command acts on: the one `config.yaml` lists under
 * `league`, or else the folder `cwd` is in that holds a `workspace.md`,
 * searching upwards as git does.
 */
export declare function findWorkspace(deps: Pick<Deps, "configDir">, opts: {
    cwd: string;
    league?: string;
}): Promise<string>;
/** The workspace's snapshot folder. */
export declare function snapshotsDir(ws: Workspace): string;
/** The pundit's own folder: their persona and their rankings by season. */
export declare function punditDir(ws: Workspace): string;
/** The folder holding the pundit's ranking files for the season. */
export declare function rankingsDir(ws: Workspace): string;
/** The latest season's shared folder, holding its `league.md`. */
export declare function seasonDir(ws: Workspace): string;
/** `week-08` */
export declare function weekStem(week: number): string;
export {};
