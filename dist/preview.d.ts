import type { Deps } from "./deps.ts";
export interface PreviewOptions {
    /** The port to try first, `PREVIEW_PORT` unless given. */
    port?: number;
}
export interface Preview {
    /** Where the page is served: `http://127.0.0.1:<port>`. */
    url: string;
    /** Stops serving and watching, and frees the port. */
    stop(): Promise<void>;
}
/**
 * Serves the preview page for the workspace's newest draft on 127.0.0.1, from
 * `opts.port` up to the first port that's free, and watches the season's
 * rankings folder. Each time the page is served it checks the draft as it is
 * on disk, with no auto-tags, so the file is never written, and fetches
 * nothing. Saving a draft (`week-NN.md`, the newest or a newer one) sends the
 * page one reload notice on `/events`; no other file does.
 */
export declare function startPreview(workspaceDir: string, _deps: Deps, opts?: PreviewOptions): Promise<Preview>;
