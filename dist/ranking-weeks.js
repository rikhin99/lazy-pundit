import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkspaceFileError } from "./front-matter.js";
import { parseLlmProseFile } from "./llm-prose-file.js";
import { parseRanking } from "./ranking-file.js";
import { punditDir } from "./workspace.js";
const RANKING_FILE = /^week-(\d+)(?:\.(published|llm))?\.md$/;
/**
 * Every ranking week the pundit has a draft, frozen copy or LLM prose file
 * for, in every season of the workspace, oldest first. It reads files only.
 */
export async function readRankingWeeks(ws) {
    const root = punditDir(ws);
    const seasons = (await readdir(root).catch(() => []))
        .filter((name) => /^\d{4}$/.test(name))
        .sort();
    const weeks = [];
    for (const season of seasons) {
        const dir = join(root, season);
        const byWeek = new Map();
        for (const name of (await readdir(dir)).sort()) {
            const match = RANKING_FILE.exec(name);
            if (!match)
                continue;
            const week = Number(match[1]);
            const entry = byWeek.get(week) ?? {
                season: Number(season),
                week,
                unreadable: [],
            };
            byWeek.set(week, entry);
            const kind = match[2] === "llm" ? "llmProse" : match[2] ? "frozenCopy" : "draft";
            const text = await readFile(join(dir, name), "utf8");
            try {
                if (kind === "llmProse")
                    entry.llmProse = parseLlmProseFile(name, text);
                else
                    entry[kind] = parseRanking(name, text);
            }
            catch (err) {
                if (!(err instanceof WorkspaceFileError))
                    throw err;
                const reason = err.message.replace(`${name}: `, "");
                entry.unreadable.push({ kind, file: `${season}/${name}`, reason });
            }
        }
        weeks.push(...[...byWeek.values()].sort((a, b) => a.week - b.week));
    }
    return weeks;
}
//# sourceMappingURL=ranking-weeks.js.map