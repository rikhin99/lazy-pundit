import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFrontMatter } from "./front-matter.js";
import { weekStem } from "./workspace.js";
import { writeWorkspaceFile } from "./workspace-files.js";
/** The workspace's LLM transcripts folder, holding a folder per season. */
export function transcriptsDir(workspaceDir) {
    return join(workspaceDir, "transcripts");
}
/**
 * Writes call number `call` of a draft as
 * `transcripts/<season>/week-NN-<time>-<call>.md`, the time in UTC.
 */
export async function writeTranscript(place, call, t) {
    const dir = join(transcriptsDir(place.ws.dir), place.ws.season.year);
    const time = place.at.toISOString().replace(/[-:]|\.\d+/g, "");
    await mkdir(dir, { recursive: true });
    await writeWorkspaceFile(join(dir, `${weekStem(place.week)}-${time}-${call}.md`), renderTranscript(place.week, call, t));
}
/** The transcript as Markdown: model, tokens and cost in the front matter. */
function renderTranscript(week, call, t) {
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
function fenced(text) {
    const longest = Math.max(0, ...(text.match(/~+/g) ?? []).map((r) => r.length));
    const fence = "~".repeat(Math.max(3, longest + 1));
    return `${fence}\n${text}\n${fence}`;
}
/** Removes the workspace's LLM transcripts folder, with how many files it held. */
export async function deleteTranscripts(workspaceDir) {
    const path = transcriptsDir(workspaceDir);
    let files = 0;
    try {
        const entries = await readdir(path, {
            recursive: true,
            withFileTypes: true,
        });
        files = entries.filter((e) => e.isFile()).length;
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
    }
    await rm(path, { recursive: true, force: true });
    return { path, files };
}
//# sourceMappingURL=transcripts.js.map