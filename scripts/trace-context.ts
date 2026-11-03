/**
 * Prints where a session's context went: its size at each stage of a ticket,
 * then the largest jumps and the calls whose results caused them. Stops at the
 * first compaction, since the size resets there.
 *
 *   npm run trace [-- <session.jsonl>]
 *
 * With no path, reads this project's most recent session log.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface Turn {
  size: number;
  calls: { tool: string; target: string }[];
}

const k = (n: number) => `${(n / 1000).toFixed(1)}k`.padStart(7);

async function latestLog(): Promise<string> {
  const dir = join(
    homedir(),
    ".claude/projects",
    process.cwd().replace(/[/.]/g, "-"),
  );
  const logs = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const dated = await Promise.all(
    logs.map(async (f) => ({
      path: join(dir, f),
      at: (await stat(join(dir, f))).mtimeMs,
    })),
  );
  const latest = dated.sort((a, b) => b.at - a.at)[0];
  if (!latest) throw new Error(`No session logs in ${dir}`);
  return latest.path;
}

/** One entry per model turn; a turn's parallel calls share its context size. */
function turnsOf(log: string): Turn[] {
  const turns = new Map<string, Turn>();
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (entry.subtype === "compact_boundary") break;
    const message = entry.message;
    if (entry.type !== "assistant" || !message?.usage) continue;
    const u = message.usage;
    const size =
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    const turn: Turn = turns.get(message.id) ?? { size, calls: [] };
    for (const c of message.content ?? []) {
      if (c.type !== "tool_use") continue;
      const i = c.input;
      const target = i.file_path ?? i.command ?? i.description ?? i.skill ?? "";
      turn.calls.push({
        tool: c.name,
        target: String(target)
          .replaceAll("\n", " ")
          .replace(`${process.cwd()}/`, "")
          .slice(0, 70),
      });
    }
    turns.set(message.id, turn);
  }
  return [...turns.values()];
}

const STAGES: [string, (c: Turn["calls"][number]) => boolean][] = [
  [
    "first test written",
    (c) => /Write|Edit/.test(c.tool) && /(^|\/)test\//.test(c.target),
  ],
  ["review starts", (c) => c.tool === "Agent" && /review/i.test(c.target)],
  ["commit", (c) => c.tool === "Bash" && /git (\S+ )*commit/.test(c.target)],
  ["sweep starts", (c) => c.tool === "Agent" && /sweep/i.test(c.target)],
];

const turns = turnsOf(
  await readFile(process.argv[2] ?? (await latestLog()), "utf8"),
);
console.log(`${k(turns[0]?.size ?? 0)}  start`);
for (const [name, matches] of STAGES) {
  const turn = turns.find((t) => t.calls.some(matches));
  console.log(`${turn ? k(turn.size) : "      -"}  ${name}`);
}
console.log(`${k(turns.at(-1)?.size ?? 0)}  last turn before any compaction\n`);

console.log("Largest jumps, with the calls whose results caused them:");
const jumps = turns
  .slice(1)
  .map((t, i) => ({
    by: t.size - (turns[i] as Turn).size,
    at: t.size,
    calls: (turns[i] as Turn).calls,
  }))
  .sort((a, b) => b.by - a.by)
  .slice(0, 8);
for (const { by, at, calls } of jumps) {
  console.log(`+${k(by).trim()} to ${k(at).trim()}`);
  for (const c of calls) console.log(`    ${c.tool}: ${c.target}`);
}
