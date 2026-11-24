import type { AutoTag } from "./types.ts";
export declare const TAG: RegExp;
export interface Tag {
    /** Offsets of the whole `[…]{…}` in the input text. */
    start: number;
    end: number;
    inner: string;
    kind: "ev" | "lore" | "stakes" | "log";
    value: string;
    /** Offsets of the inner words in the plain text. */
    plainStart: number;
    plainEnd: number;
}
/**
 * The text with every tag unwrapped, the tags, and a map from each plain
 * offset back to the input text.
 */
export declare function unwrap(text: string): {
    plain: string;
    tags: Tag[];
    toInput: number[];
};
/** `[7-1]{ev=record}` → `7-1`: tags are for the tool, not the league. */
export declare function stripTags(text: string): string;
/** The text with each auto-tag added around its words; no word changes. */
export declare function applyAutoTags(text: string, tags: AutoTag[]): string;
