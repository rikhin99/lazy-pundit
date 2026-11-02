import type { DraftContext, Persona } from "./draft-context.ts";
import type { TeamId } from "./league.ts";
import type { EvidenceValue } from "./validator/types.ts";

/**
 * The standing instructions for a first draft: the claim rules, what not to
 * say and the reply format. It holds nothing about the league, so it stays
 * the same from call to call.
 */
export const FIRST_DRAFT_SYSTEM = `You write the blurbs for a fantasy football league's weekly power ranking: one short blurb per team, plus a week intro about the whole league. A pundit in the league edits your draft, decides the order and publishes it to the league's group chat.

Claims must be cited
- A claim is any checkable statement of fact: a number, a score, a record, a rank, a streak, a result ("beat", "lost to"), a margin, a player's points, or a superlative ("the league's top scorer", "worst defence").
- Wrap every claim in square brackets and cite the evidence ID it comes from, straight after the bracket: [7-1]{ev=record}, [beat]{ev=w8.result} [Pirates]{ev=w8.opponent} by [5.5]{ev=w8.margin}, [Jaxson Dart]{ev=w8.top} put up [19.42]{ev=w8.top_points}.
- The bracketed words must state the evidence value: the number as given (rounding to one decimal place is fine), the record, the team's or player's name.
- In a team's blurb a bare ID is that team's stat. Cite another team's stat as <team id>/<id>, such as {ev=sleeper:4/record}, and a league-wide item by its wk. ID. In the week intro, cite every team stat in the <team id>/<id> form.
- A superlative needs a rank or league item behind it: [the league's top scorer]{ev=pf_rank} only when pf_rank is 1.
- Never write a claim without a citation, and never state a fact that isn't in the evidence. If the evidence doesn't support something, leave it out.
- Don't say where a team sits in this power ranking, how far it rose or fell, or which tier it's in: the pundit hasn't set the order yet. Standings ranks from the evidence (standing, pf_rank and the like) are fine.
- Say nothing about the managers as people beyond their names: no jobs, families, habits or history. Don't mention money, prizes or punishments.
- Opinions, jokes and predictions need no citation, as long as they claim no fact.

Reading the evidence
- record is wins-losses(-ties); allplay is the record had the team played every other team every week; streak is W, L or T and the run length.
- Every rank counts from the highest value: rank 1 has the most (for pa_rank, the most points scored against it). standing is the place in the league standings.
- w<N>. IDs are that week's stats; w<N>.top, .zeros and .benchmiss name players, with their points under _points.
- luck is actual wins minus the wins expected from all-play; form3 averages the last three weeks played.
- A value that names a team is shown as the team's name.

Reply format
Reply with nothing but the sections below, each a heading line then its text, in any order:
## {intro}
<the week intro>
## {team=<team id>}
<that team's blurb>
Write one section for every team listed, using its team id exactly as given.`;

/** The material for one first draft: the persona, the teams and their evidence. */
export function firstDraftPrompt(ctx: DraftContext): string {
  const names = new Map(ctx.teams.map((t) => [t.id, t.name]));
  const shown = (v: EvidenceValue) =>
    typeof v === "string" && names.has(v as TeamId)
      ? names.get(v as TeamId)
      : v;
  const lines = (ev: Record<string, EvidenceValue>) =>
    Object.entries(ev).map(([id, v]) => `${id}: ${shown(v)}`);

  const teams = ctx.teams.map((t) => {
    const by =
      t.managers.length > 0 ? `, managed by ${t.managers.join(" and ")}` : "";
    return [
      `### ${t.name} (team id ${t.id})${by}`,
      ...lines(ctx.evidence.teams[t.id] ?? {}),
    ].join("\n");
  });

  return [
    `League: ${ctx.league}, ${ctx.season} season, after week ${ctx.week}.`,
    "",
    "## Persona",
    personaInstructions(ctx.persona),
    "",
    "## League-wide items",
    ...lines(ctx.evidence.league),
    "",
    "## Teams",
    teams.join("\n\n"),
  ].join("\n");
}

/** The persona as instructions. */
function personaInstructions(p: Persona): string {
  const swearing = {
    off: "No swearing at all.",
    mild: "Mild swearing is fine.",
    on: "Swearing is fine.",
  }[p.swearing];
  const teasing = {
    none: "Don't tease anyone.",
    light: "Light, friendly teasing only.",
    roast: "Roast freely.",
  }[p.teasing];
  const formality = {
    formal: "Keep it polished.",
    casual: "Keep it conversational.",
    unhinged: "Go as wild as you like.",
  }[p.formality];
  const shape =
    p.shape === "prose"
      ? `Write each blurb and the intro as prose, ${p.length.min} to ${p.length.max} sentences.`
      : `Write each blurb and the intro as ${p.length.min} to ${p.length.max} bullets, each starting "- ".`;
  return [p.styleNote, swearing, teasing, formality, shape].join(" ");
}

/** The blurbs and intro a reply holds, by section. */
export interface WrittenProse {
  intro?: string;
  teams: Partial<Record<TeamId, string>>;
}

const SECTION = /^##\s*\{(intro|team=([^}\s]+))\}\s*$/;

/**
 * Reads a reply in the format the prompt asks for. Text before the first
 * heading, a team that isn't in the league and an empty section are dropped;
 * when a section comes twice, the first stands.
 */
export function readReply(text: string, ctx: DraftContext): WrittenProse {
  const known = new Set<string>(ctx.teams.map((t) => t.id));
  const sections: { key: string; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const heading = SECTION.exec(line.trim());
    if (heading) sections.push({ key: heading[2] ?? "intro", lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  const written: WrittenProse = { teams: {} };
  for (const { key, lines } of sections) {
    const body = lines.join("\n").trim();
    if (!body) continue;
    if (key === "intro") written.intro ??= body;
    else if (known.has(key)) written.teams[key as TeamId] ??= body;
  }
  return written;
}
