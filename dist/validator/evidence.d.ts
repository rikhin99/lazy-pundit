import type { TeamId } from "../league.ts";
import type { Ctx, EvidenceValue, Kind, Resolved } from "./types.ts";
/** The stat an ID names, without its `w<N>.` week prefix. */
export declare function statOf(id: string): string;
/** What the league stat line's `wk.clinched` tag says before the teams. */
export declare const CLINCHED_LABEL = "Clinched this week:";
export declare function kindOf(id: string, value: EvidenceValue): Kind;
/** Looks an evidence ID up for the section team (or another team, or the league). */
export declare function resolve(ctx: Ctx, id: string, section: TeamId | null): Resolved | null;
export declare const WIN_WORDS: RegExp;
export declare const LOSS_WORDS: RegExp;
export declare function agrees(ctx: Ctx, r: Resolved, words: string): boolean;
