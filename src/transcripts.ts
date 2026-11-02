import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { LlmReply } from "./anthropic.ts";
import { writeFrontMatter } from "./front-matter.ts";
import { type Workspace, weekStem } from "./workspace.ts";
import { writeWorkspaceFile } from "./workspace-files.ts";

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
  outcome: { reply: string } | { error: string };
}

/** Where a draft's LLM transcripts go: the week, the draft's start time and the call. */
export interface TranscriptPlace {
  ws: Workspace;
  week: number;
  /** When the draft began, shared by all its calls. */
  at: Date;
}

/** The workspace's LLM transcripts folder, holding a folder per season. */
export function transcriptsDir(workspaceDir: string): string {
  return join(workspaceDir, "transcripts");
}

/**
 * Writes call number `call` of a draft as
 * `transcripts/<season>/week-NN-<time>-<call>.md`, the time in UTC.
 */
export async function writeTranscript(
  place: TranscriptPlace,
  call: number,
  t: Transcript,
): Promise<void> {
  const dir = join(transcriptsDir(place.ws.dir), place.ws.season.year);
  const time = place.at.toISOString().replace(/[-:]|\.\d+/g, "");
  await mkdir(dir, { recursive: true });
  await writeWorkspaceFile(
    join(dir, `${weekStem(place.week)}-${time}-${call}.md`),
    renderTranscript(place.week, call, t),
  );
}

/** The transcript as Markdown: model, tokens and cost in the front matter. */
function renderTranscript(week: number, call: number, t: Transcript): string {
  const front = writeFrontMatter({
    model: t.model,
    ...(t.usage && {
      input_tokens: t.usage.inputTokens,
      output_tokens: t.usage.outputTokens,
    }),
    cost_usd: Math.round(t.cost * 1e6) / 1e6,
  });
  return [
    `${front}\n# LLM transcript: week ${week}, call ${call}`,
    `## System\n\n${fenced(t.system)}`,
    `## Prompt\n\n${fenced(t.prompt)}`,
    "reply" in t.outcome
      ? `## Reply\n\n${fenced(t.outcome.reply)}`
      : `## Error\n\n${t.outcome.error}`,
  ]
    .join("\n\n")
    .concat("\n");
}

/** `text` in a fence longer than any run of tildes inside it. */
function fenced(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/~+/g) ?? []).map((r) => r.length),
  );
  const fence = "~".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** Removes the workspace's LLM transcripts folder, with how many files it held. */
export async function deleteTranscripts(
  workspaceDir: string,
): Promise<{ path: string; files: number }> {
  const path = transcriptsDir(workspaceDir);
  let files = 0;
  try {
    const entries = await readdir(path, {
      recursive: true,
      withFileTypes: true,
    });
    files = entries.filter((e) => e.isFile()).length;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await rm(path, { recursive: true, force: true });
  return { path, files };
}
