import { z } from "zod";
import { readFrontMatter, WorkspaceFileError, writeFrontMatter, } from "./front-matter.js";
/** The LLM prose file's front matter. Its shape is versioned by `FORMAT`. */
export const llmProseFileSchema = z.object({
    season: z.number().int(),
    week: z.number().int().nonnegative(),
    created_at: z.string(),
});
/** The LLM prose file's text: its front matter, then a section per section the LLM wrote. */
export function renderLlmProseFile(meta, league, prose) {
    const names = new Map(league.teams.map((t) => [t.id, t.name]));
    const sections = Object.entries(prose.blurbs).map(([id, blurb]) => `## ${names.get(id) ?? id} {team=${id}}\n${blurb}\n`);
    if (prose.intro)
        sections.unshift(`## Intro {intro}\n${prose.intro}\n`);
    return `${writeFrontMatter({ ...meta })}\n${sections.join("\n")}`;
}
const HEADING = /^## .*\{(?:intro|team=([^}\s]+))\}[ \t]*$/gm;
/** Reads an LLM prose file, refusing an unknown format version. */
export function parseLlmProseFile(file, text) {
    const { data, body } = readFrontMatter(file, text, "format");
    const parsed = llmProseFileSchema.safeParse(data);
    if (!parsed.success) {
        throw new WorkspaceFileError(`${file}: ${z.prettifyError(parsed.error)}`);
    }
    const meta = parsed.data;
    const prose = { intro: "", blurbs: {} };
    const headings = [...body.matchAll(HEADING)];
    headings.forEach((h, i) => {
        const start = h.index + h[0].length;
        const end = headings[i + 1]?.index ?? body.length;
        const words = body.slice(start, end).trim();
        if (h[1] === undefined)
            prose.intro = words;
        else
            prose.blurbs[h[1]] = words;
    });
    return { createdAt: meta.created_at, prose };
}
//# sourceMappingURL=llm-prose-file.js.map