import { z } from "zod";
import { type League, type Team, type TeamId } from "./league.ts";
import { type Stakes } from "./stakes.ts";
import { type ValidatorInput } from "./validator.ts";
import type { Workspace } from "./workspace.ts";
/** `lore.md`'s front matter. Its shape is versioned by `FORMAT`. */
export declare const loreSchema: z.ZodObject<{
    lore: z.ZodNumber;
}, z.core.$strict>;
declare const LEAGUE_TYPES: readonly ["work", "family", "friends", "other"];
export type LeagueType = (typeof LEAGUE_TYPES)[number];
export interface LoreSection {
    /**
     * What a `{lore=…}` tag cites: `manager:bo`, `team:sleeper:3`, or the
     * heading in lower case with dashes, such as `running-jokes`.
     */
    name: string;
    line: number;
    nicknames: string[];
    /** Each lore entry: every other line of text, without its bullet. */
    entries: string[];
}
export interface Lore {
    type?: LeagueType;
    sections: LoreSection[];
    /** The lines with a `{local}` on them. */
    localLines: number[];
    /** Personal data it seems to hold, and text no section holds. */
    warnings: string[];
}
/**
 * What naming a league's teams needs of it: its platform and each team's name
 * and managers, which setup has before any snapshot is written.
 */
export type LeagueNames = Pick<League, "platform"> & {
    teams: Pick<Team, "id" | "name" | "managers">[];
};
/** The names `validate` takes: what a team goes by, and what may be cited. */
export type ValidatorNames = Pick<ValidatorInput, "nicknames" | "sections" | "noStakes">;
/**
 * Reads the workspace's `lore.md`, refusing an unknown tag or a malformed
 * reserved line. With no file, the lore is empty. Markdown comments aren't
 * lore: their tags mean nothing and their text is no entry.
 */
export declare function loadLore(ws: Workspace): Promise<Lore>;
/** A `## ` heading line, capturing its text; a `###` is no heading. */
export declare const HEADING: RegExp;
/** A comment's text removed, its line breaks kept so line numbers hold. */
export declare function withoutComments(body: string): string;
/** A heading as a tag can cite it, since a tag holds no spaces. */
export declare function headingName(heading: string): string;
/** Every name lore gives a manager: each handle and its nicknames. */
export declare function managerNames(lore: Lore): string[];
/** A lore section as the draft context holds it. */
export interface SentLoreSection {
    name: string;
    /** The teams in this league it's about, for a manager or team section. */
    teams: TeamId[];
    nicknames: string[];
    entries: string[];
}
/** The lore a draft may send. */
export interface SentLore {
    type?: LeagueType;
    sections: SentLoreSection[];
}
/**
 * What a draft may send of the lore, and why anything written was held back.
 * A manager with no team in this league isn't sent: a departed manager's lore
 * is simply kept, and a handle with no link can't be told from one, nor placed
 * on a team, so it's held back with a warning. A section with nothing in it
 * says nothing.
 */
export declare function sentLore(lore: Lore, league: League, handles: Workspace["handles"]): {
    lore: SentLore;
    warnings: string[];
};
/** Stops a draft on any `{local}`: no entry marked so may reach the LLM. */
export declare function refuseLocal(lore: Lore): void;
/** Stops on any `{local}` at these lines of `file`, which isn't supported yet. */
export declare function refuseLocalLines(file: string, lines: number[]): void;
/**
 * Every team's names for the validator: its name, its managers' display names
 * and lore's nicknames, plus the lore sections a tag may cite. A nickname that
 * would read as two holders' is a load error naming both, unless they come to
 * one team, as a manager and their own team do. Given `onLeagueClash`, one
 * that reads as another team's name is told to it and left out instead, since
 * that league can't be edited and the name counts only for its own team.
 */
export declare function validatorNames(lore: Lore, league: LeagueNames, handles: Workspace["handles"], stakes?: Stakes, onLeagueClash?: (clash: NicknameClash) => void): ValidatorNames;
/** A lore nickname that reads as another team's name in one version of the league. */
export interface NicknameClash {
    nickname: string;
    /** The lore section giving the nickname. */
    section: string;
    /** The team whose name it reads as, with its ID. */
    team: string;
}
/** The start of every clash's message: the nickname and both holders. */
export declare function clashText(c: NicknameClash): string;
/** What a command with fresh data says of a clash that `draft` would stop on. */
export declare function freshClashWarning(c: NicknameClash): string;
export {};
