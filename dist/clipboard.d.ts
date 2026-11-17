/** The clipboard. Library code copies text only through one of these. */
export interface Clipboard {
    /** Copies the text. Resolves false when no clipboard is available. */
    write(text: string): Promise<boolean>;
    /** The command that would copy, or undefined when there's no clipboard. */
    find(): Promise<string | undefined>;
}
/**
 * The production clipboard: `pbcopy` (macOS), `wl-copy` or `xclip` (Linux) or
 * `clip.exe` (WSL), whichever is present. With none, nothing is copied.
 */
export declare const systemClipboard: Clipboard;
/** No clipboard: copies nothing, as on a machine without one. */
export declare const noClipboard: Clipboard;
