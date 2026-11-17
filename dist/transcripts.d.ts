import type { LlmReply } from "./anthropic.ts";
import { type Workspace } from "./workspace.ts";
/** One LLM call, as its LLM transcript records it. Never the key. */
export interface Transcript {
    model: string;
    /** The tokens the API reported, if it answered with any. */
    usage?: LlmReply["usage"];
    /** What the reported tokens cost, in US dollars. */
    cost: number;
    system: string;
    prompt: string;
    /** The reply's text, or the error the call failed with. */
    outcome: {
        reply: string;
    } | {
        error: string;
    };
}
/** Where a draft's LLM transcripts go: the week, the draft's start time and the call. */
export interface TranscriptPlace {
    ws: Workspace;
    week: number;
    /** When the draft began, shared by all its calls. */
    at: Date;
}
/** The workspace's LLM transcripts folder, holding a folder per season. */
export declare function transcriptsDir(workspaceDir: string): string;
/**
 * Writes call number `call` of a draft as
 * `transcripts/<season>/week-NN-<time>-<call>.md`, the time in UTC.
 */
export declare function writeTranscript(place: TranscriptPlace, call: number, t: Transcript): Promise<void>;
/** Removes the workspace's LLM transcripts folder, with how many files it held. */
export declare function deleteTranscripts(workspaceDir: string): Promise<{
    path: string;
    files: number;
}>;
