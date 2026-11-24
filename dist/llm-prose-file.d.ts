import { z } from "zod";
import type { League } from "./league.ts";
import type { DraftProse } from "./ranking-file.ts";
/**
 * The LLM prose file (`week-NN.llm.md`) beside a draft: each section the LLM
 * wrote, word for word, under the draft's `created_at`, so a later read can
 * tell it belongs to that draft and not to one deleted before it.
 */
export interface LlmProseFile {
    createdAt: string;
    prose: DraftProse;
}
/** The LLM prose file's front matter. Its shape is versioned by `FORMAT`. */
export declare const llmProseFileSchema: z.ZodObject<{
    season: z.ZodNumber;
    week: z.ZodNumber;
    created_at: z.ZodString;
}, z.core.$strip>;
/** The LLM prose file's text: its front matter, then a section per section the LLM wrote. */
export declare function renderLlmProseFile(meta: z.infer<typeof llmProseFileSchema>, league: League, prose: DraftProse): string;
/** Reads an LLM prose file, refusing an unknown format version. */
export declare function parseLlmProseFile(file: string, text: string): LlmProseFile;
