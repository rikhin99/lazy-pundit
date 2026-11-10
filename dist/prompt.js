import { NO_STAKES_REASON, SWEAR_REASON } from "./check.js";
import { PRESETS } from "./persona.js";
/**
 * The standing instructions for a first draft: the claim rules, what not to
 * say and the reply format. It holds nothing about the league, so it stays
 * the same from call to call.
 */
export const FIRST_DRAFT_SYSTEM = `You write the blurbs for a fantasy football league's weekly power ranking: one short blurb per team, plus a week intro about the whole league unless the persona turns it off. A pundit in the league edits your draft, decides the order and publishes it to the league's group chat.

Claims must be cited
- A claim is any checkable statement of fact: a number, a score, a record, a rank, a streak, a result ("beat", "lost to"), a margin, a player's points, or a superlative ("the league's top scorer", "worst defence").
- Wrap every claim in square brackets and cite the evidence ID it comes from, straight after the bracket: [7-1]{ev=record}, [beat]{ev=w8.result} [Pirates]{ev=w8.opponent} by [5.5]{ev=w8.margin}, [Jaxson Dart]{ev=w8.top} put up [19.42]{ev=w8.top_points}.
- The bracketed words must state the evidence value: the number as given (rounding to one decimal place is fine), the record, the team's or player's name.
- In a team's blurb a bare ID is that team's stat. Cite another team's stat as <team id>/<id>, such as {ev=sleeper:4/record}, and a league-wide item by its wk. ID. In the week intro, cite every team stat in the <team id>/<id> form.
- A superlative needs a rank or league item behind it: [the league's top scorer]{ev=pf_rank} only when pf_rank is 1.
- Never write a claim without a citation, and never state a fact that isn't in the evidence or, for a personal fact, in the lore. If they don't support something, leave it out.
- Don't say where a team sits in this power ranking, how far it rose or fell, or which tier it's in: the pundit hasn't set the order yet. Standings ranks from the evidence (standing, pf_rank and the like) are fine.
- State a personal fact about a manager (a job, family, habit, relationship or history) only from the lore or the stakes in the prompt, and tag it with the section it came from, as {lore=<section>} or, from the stakes, {stakes=<section>} or {log=w<N>}: [the league's dentist]{lore=manager:bo}. With no lore on it, say nothing about the managers as people beyond their names. Never invent a personal fact.
- Money, prizes and punishments come only from the Stakes part of the prompt. With no Stakes part, say nothing about them either way. When it says bragging rights only, mention no money, prize or punishment at all. Otherwise cite a stakes number by its evidence ID, anything else under Stakes as {stakes=<section>} (a house rule's id or the name after ###), and a Log entry as {log=w<N>} for its week: [the bye-fine rule]{stakes=bye-fines}, [paid up last week]{log=w7}. A joke rule may be played for laughs; a serious one isn't mocked.
- Opinions, jokes and predictions need no citation, as long as they claim no fact.

Reading the evidence
- record is wins-losses(-ties); allplay is the record had the team played every other team every week; streak is W, L or T and the run length.
- Every rank counts from the highest value: rank 1 has the most (for pa_rank, the most points scored against it). standing is the place in the league standings.
- w<N>. IDs are that week's stats; w<N>.top, .zeros and .benchmiss name players, with their points under _points.
- luck is actual wins minus the wins expected from all-play; form3 averages the last three weeks played.
- A value that names a team is shown as the team's name. wk.clinched and wk.eliminated can name several: the teams whose playoff status changed this week. wk.knocked_out names the teams knocked out of the playoffs this week.
- stakes.pot is the pot and stakes.payout_<n> what final place n wins, in dollars. wk.rule.<id> names this week's trigger winners for house rule <id>, several when tied; rule.<id>.count is how many times the team has triggered it this season, and rule.<id>.winnings what those come to so far: a stat, not money paid or owed.
- rival is the team's rival in this week's rivalry week, next_rival its rival next week; wk.rivalry.<n> names the two teams of this week's rivalry n, and wk.rivalry.<n>.winner the one that won it.
- platform.playoff_spots, platform.playoff_start and platform.faab_budget are the platform's own settings: how many teams make the playoffs, the week they start and the FAAB budget.
- playoffs is clinched_bye, clinched or eliminated, and is there only when settled. A team with no playoffs ID has no status to state: playoff words about it are wrong claims. Say only clinched a spot, clinched a bye or eliminated; looser phrases such as "playoff lock" or "on the bubble" can never pass.
- knocked_out is the winners-bracket round the team lost in, and is there only once it's out. Such a team was eliminated, or knocked out of the playoffs, even though its playoffs still says it clinched; cite knocked_out for that.

Reply format
Reply with nothing but the sections below, each a heading line then its text, in any order:
## {intro}
<the week intro, left out with its heading when the persona turns it off>
## {team=<team id>}
<that team's blurb>
Write one section for every team listed, using its team id exactly as given.`;
/**
 * What the prompt says about the in-progress week whose stats the evidence
 * holds, or nothing when it holds none: those scores can still change, so
 * the week gets no result, only "so far".
 */
function inProgressBlock(ctx) {
    const week = ctx.inProgressWeek;
    if (week === undefined)
        return "";
    return [
        "## In-progress week",
        `Week ${week} is still being played: its w${week}. stats are scores so far, and they can change before it's scored. Give no result for week ${week}: no "beat", "lost to", "won" or "lost". w${week}.margin is a lead or deficit so far and w${week}.rank a rank so far, not a margin of victory or a final rank. Say "so far" with any week ${week} number: [<the w${week}.points value>]{ev=w${week}.points} so far.`,
    ].join("\n");
}
/** The material for one first draft: the persona, the teams and their evidence. */
export function firstDraftPrompt(ctx) {
    const names = new Map(ctx.teams.map((t) => [t.id, t.name]));
    const shown = (v) => {
        if (typeof v !== "string")
            return v;
        const ids = v.split(",");
        return ids.every((id) => names.has(id))
            ? ids.map((id) => names.get(id)).join(", ")
            : v;
    };
    const lines = (ev) => Object.entries(ev).map(([id, v]) => `${id}: ${shown(v)}`);
    const teams = ctx.teams.map((t) => {
        const by = t.managers.length > 0 ? `, managed by ${t.managers.join(" and ")}` : "";
        const last = ctx.lastBlurbs?.blurbs[t.id];
        return [
            `### ${t.name} (team id ${t.id})${by}`,
            ...lines(ctx.evidence.teams[t.id] ?? {}),
            ...(last
                ? [
                    `Its blurb in the week ${ctx.lastBlurbs?.week} ranking, for continuity only. Its facts are from then: don't repeat them as this week's.`,
                    last,
                ]
                : []),
        ].join("\n");
    });
    const lore = loreBlock(ctx);
    const stakes = stakesBlock(ctx);
    const inProgress = inProgressBlock(ctx);
    return [
        `League: ${ctx.league}, ${ctx.season} season, after week ${ctx.week}.`,
        "",
        ...(inProgress ? [inProgress, ""] : []),
        "## Persona",
        personaInstructions(ctx.persona),
        "",
        ...(lore ? [lore, ""] : []),
        ...(stakes ? [stakes, ""] : []),
        "## League-wide items",
        ...lines(ctx.evidence.league),
        "",
        "## Teams",
        teams.join("\n\n"),
    ].join("\n");
}
/** A final place as words: 1st, 2nd, 3rd, 4th, 11th, 21st. */
function ordinal(n) {
    const teen = n % 100 >= 11 && n % 100 <= 13;
    const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
    return `${n}${suffix}`;
}
/**
 * The stakes as the prompt holds them: nothing when unrecorded, a line for
 * bragging rights only, or the recorded rules, rivalry weeks, stakes
 * sections and the Log entries sent.
 */
export function stakesBlock(ctx) {
    const { stakes } = ctx;
    if (stakes.kind === "unrecorded")
        return "";
    if (stakes.kind === "none") {
        return "## Stakes\nThis league plays for bragging rights only: there's no money, prize or punishment, so mention none.";
    }
    const nameOf = (id) => ctx.teams.find((t) => t.id === id)?.name ?? id;
    const rule = (r) => {
        const about = [
            ...(r.trigger
                ? [`trigger: ${r.trigger.kind}, per ${r.trigger.per}`]
                : []),
            ...(r.from ? [`from week ${r.from}`] : []),
            ...(r.until ? [`until week ${r.until}`] : []),
            ...(r.spirit === "joke" ? ["a joke"] : []),
            ...(r.spirit === "serious" ? ["meant seriously"] : []),
        ];
        return `- ${r.id}: ${r.name}, ${r.outcome}${about.length > 0 ? ` (${about.join("; ")})` : ""}`;
    };
    return [
        "## Stakes",
        "What the league plays for this season, as the pundits recorded it. Cite a number by its evidence ID, a house rule by its id or a section by the name after ### as {stakes=…}, and a Log entry as {log=w<N>}.",
        ...(stakes.buyIn === undefined
            ? []
            : [`Buy-in: $${stakes.buyIn} per team`]),
        `Payouts by final place: ${stakes.payouts.map((p, i) => `${ordinal(i + 1)} ${p}`).join(", ")}${stakes.buyIn === undefined ? "" : " of the pot"}`,
        ...(stakes.houseRules.length > 0
            ? ["House rules:", ...stakes.houseRules.map(rule)]
            : []),
        ...(stakes.rivalryWeeks.length > 0
            ? [
                "Rivalry weeks:",
                ...stakes.rivalryWeeks.map((w) => `- week ${w.week}: ${w.pairs.map(([a, b]) => `${nameOf(a)} v ${nameOf(b)}`).join(", ")}`),
            ]
            : []),
        ...stakes.sections.flatMap((s) => [
            "",
            `### ${s.name}`,
            ...s.entries.map((e) => `- ${e}`),
        ]),
        ...(stakes.log.length > 0
            ? [
                "",
                "### Log (this week's and last week's entries, and pinned ones)",
                ...stakes.log.map((e) => `- w${e.week}${e.rule ? ` (${e.rule})` : ""}: ${e.text}`),
            ]
            : []),
    ].join("\n");
}
/**
 * The lore as the prompt holds it, or nothing when there's none. A manager's
 * section says which team they manage, since lore names them by handle.
 */
export function loreBlock(ctx) {
    const { type, sections } = ctx.lore;
    if (!type && sections.length === 0)
        return "";
    const nameOf = (id) => ctx.teams.find((t) => t.id === id)?.name ?? id;
    const blocks = sections.map((s) => {
        const about = s.teams.map(nameOf).join(" and ");
        const heading = !about
            ? s.name
            : s.name.startsWith("manager:")
                ? `${s.name} (manages ${about})`
                : `${s.name} (${about})`;
        return [
            `### ${heading}`,
            ...(s.nicknames.length > 0
                ? [`Nicknames: ${s.nicknames.join(", ")}`]
                : []),
            ...s.entries.map((e) => `- ${e}`),
        ].join("\n");
    });
    return [
        "## Lore",
        "What the pundits have written about the league and its people: with the stakes, the only source for personal facts. A number here is no stat. Cite a section by the name after ###.",
        ...(type ? [`League type: ${type}`] : []),
        "",
        blocks.join("\n\n"),
    ].join("\n");
}
/**
 * A retry after the LLM gate: the first draft's material, then each failing
 * section as it was written with the validator's complaints, asking for
 * those sections alone.
 */
export function rewritePrompt(ctx, failing) {
    const names = new Map(ctx.teams.map((t) => [t.id, t.name]));
    const sections = failing.map((f) => {
        const which = f.key === "intro"
            ? "The week intro, section {intro}"
            : `${names.get(f.key)} (team id ${f.key}), section {team=${f.key}}`;
        return [
            `### ${which}`,
            "You wrote:",
            f.text,
            "The check found:",
            ...complaints(f).map((c) => `- ${c}`),
        ].join("\n");
    });
    return [
        firstDraftPrompt(ctx),
        "",
        "## Sections to rewrite",
        "Your draft's other sections passed the check. These didn't. Rewrite each one so every claim is cited and matches its evidence, keeping to the persona, and reply with only these sections in the reply format.",
        "",
        sections.join("\n\n"),
    ].join("\n");
}
/** Each fault in a section, as the LLM is told it on a retry. */
function complaints(f) {
    return [
        ...f.claims.map((c) => {
            if (c.tagged)
                return `"${c.text}" (cites ${c.id}): ${c.status}, ${c.reason}`;
            return c.status === "verified" && c.id
                ? `"${c.text}": no citation; it matches ${c.id} (${c.reason}), so cite that`
                : `"${c.text}": no citation, and ${c.reason}`;
        }),
        ...f.swears.map((s) => `"${s.word}": ${SWEAR_REASON}`),
        ...f.stakesMentions.map((s) => `"${s.word}": ${NO_STAKES_REASON}`),
    ];
}
/** The persona as instructions. */
function personaInstructions(p) {
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
    const what = p.intro ? "each blurb and the intro" : "each blurb";
    const count = p.length.min === p.length.max
        ? `${p.length.min}`
        : `${p.length.min} to ${p.length.max}`;
    const shape = p.shape === "prose"
        ? `Write ${what} as prose, ${count} sentences.`
        : `Write ${what} as ${count} bullets, each starting "- ".`;
    const intro = p.intro
        ? ""
        : "Write no week intro: leave out the {intro} section.";
    return [
        PRESETS[p.preset].styleNote,
        p.styleNote,
        swearing,
        teasing,
        formality,
        shape,
        intro,
    ]
        .filter(Boolean)
        .join(" ");
}
const SECTION = /^##\s*\{(intro|team=([^}\s]+))\}\s*$/;
/**
 * Reads a reply in the format the prompt asks for. Text before the first
 * heading, a team that isn't in the league, an intro the persona turns off
 * and an empty section are dropped; when a section comes twice, the first
 * stands.
 */
export function readReply(text, ctx) {
    const known = new Set(ctx.teams.map((t) => t.id));
    const sections = [];
    for (const line of text.split("\n")) {
        const heading = SECTION.exec(line.trim());
        if (heading)
            sections.push({ key: heading[2] ?? "intro", lines: [] });
        else
            sections.at(-1)?.lines.push(line);
    }
    const written = { teams: {} };
    for (const { key, lines } of sections) {
        const body = lines.join("\n").trim();
        if (!body)
            continue;
        if (key === "intro") {
            if (ctx.persona.intro)
                written.intro ??= body;
        }
        else if (known.has(key))
            written.teams[key] ??= body;
    }
    return written;
}
//# sourceMappingURL=prompt.js.map