import type { CheckedDraft } from "./check.ts";
/**
 * The preview page for a draft as `checkDraft` read it: the problems list,
 * then a tab for each form of the published ranking (Plain text, Tabloid,
 * Broadcast), each what `publish`
 * would write for the draft now, under a strip saying it isn't published.
 */
export declare function previewPage(checked: CheckedDraft): string;
/** The page for a draft that can't be read: the message the CLI prints, alone. */
export declare function unreadablePage(message: string): string;
