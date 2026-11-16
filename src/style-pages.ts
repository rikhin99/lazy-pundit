import type { Award } from "./awards.ts";
import { formatRecord, type League, type TeamId } from "./league.ts";
import { type MovementBaseline, movementMark } from "./movement.ts";
import { credit, movementSince, weekTitle } from "./plain-text.ts";
import type { RankingFile } from "./ranking-file.ts";
import { type OrderEvidence, stripTags } from "./validator.ts";

/** What every style page renders: the frozen copy and what checking it found. */
export interface StylePageInput {
  ranking: RankingFile;
  league: League;
  order: Record<TeamId, OrderEvidence>;
  baseline: MovementBaseline | undefined;
  awards: Award[];
  /**
   * The stat lines `draft` writes when there's no LLM: the league's, as the
   * intro, and each team's, as its blurb. Tags and all.
   */
  statLines: { intro: string; teams: Record<string, string> };
}

/** Whether `written` is still `generated`, whatever its tags. */
function unchanged(written: string, generated: string | undefined): boolean {
  return (
    generated !== undefined &&
    stripTags(written).trim() === stripTags(generated).trim()
  );
}

/**
 * The week intro split for the style pages: each line citing a
 * `w<N>.correction` item goes to the correction note, and the rest is the
 * intro. Read from the frozen copy's text, since the pundit may have edited
 * or deleted a line; tags are stripped after the split.
 */
function splitIntro(intro: string | undefined): {
  corrections: string[];
  rest: string;
} {
  const corrections: string[] = [];
  const rest: string[] = [];
  for (const line of (intro ?? "").split("\n")) {
    if (/\{ev=w\d+\.correction\}/.test(line)) {
      corrections.push(stripTags(line).trim());
    } else rest.push(line);
  }
  return { corrections, rest: stripTags(rest.join("\n")).trim() };
}

/** `text`'s first sentence, and what follows it. */
function firstSentence(text: string): [string, string] {
  const at = text.search(/(?<=[.!?…])\s/);
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at).trim()];
}

/** One team's row on a style page. */
interface PlaceRow {
  kind: "team";
  place: number;
  name: string;
  record: string;
  /** Movement, absent at week 0 or with nothing to compare to. */
  move: number | "new" | undefined;
  /**
   * The blurb's first sentence as a quote, or a stat line `draft` wrote with
   * no LLM, whole: it has no sentence to quote. Absent for an empty blurb.
   */
  line: { kind: "quote" | "statline"; text: string } | undefined;
}

/** What every publish style shows, worked out once from its input. */
interface StylePageParts {
  /** "after Week N" or "Preseason". */
  title: string;
  /** Who wrote the ranking, for the byline. */
  pundit: string;
  /** The "Movement since" line, if any. */
  since: string | undefined;
  /**
   * The week intro without its correction lines, tags stripped; empty for no
   * intro, or one that is still the league stat line `draft` wrote with no
   * LLM, since the awards say what it says.
   */
  intro: string;
  corrections: string[];
  awards: Award[];
  rows: (PlaceRow | { kind: "group"; label: string })[];
}

function stylePageParts(input: StylePageInput): StylePageParts {
  const { ranking, league, order, baseline, awards, statLines } = input;
  const { week } = ranking.meta;
  const teams = new Map(league.teams.map((t) => [t.id as string, t]));
  const { corrections, rest } = splitIntro(ranking.intro);

  const rows: StylePageParts["rows"] = [];
  let place = 0;
  for (const entry of ranking.entries) {
    if (entry.kind === "group") {
      rows.push({ kind: "group", label: entry.label });
      continue;
    }
    place += 1;
    const team = teams.get(entry.team);
    if (!team) throw new Error(`No team ${entry.team} in the league`);
    const blurb = stripTags(entry.blurb).trim();
    rows.push({
      kind: "team",
      place,
      name: team.name,
      record: formatRecord(team.standing),
      move: week > 0 ? order[team.id]?.move : undefined,
      line: !blurb
        ? undefined
        : unchanged(blurb, statLines.teams[team.id])
          ? { kind: "statline", text: blurb }
          : { kind: "quote", text: firstSentence(blurb)[0] },
    });
  }

  return {
    title: weekTitle(week),
    pundit: ranking.meta.pundit,
    since: movementSince(week, baseline),
    intro: unchanged(rest, statLines.intro) ? "" : rest,
    corrections,
    awards,
    rows,
  };
}

/** The Tabloid style page: masthead, intro as headline, awards box, pull quotes. */
export function renderTabloid(input: StylePageInput): string {
  const { league } = input;
  const { title, pundit, since, intro, corrections, awards, rows } =
    stylePageParts(input);
  const parts: string[] = [];

  parts.push(
    `<header class="masthead"><h1>${esc(league.name)}</h1><p>${esc(title)} · Power Rankings · by ${esc(pundit)}</p>${since ? `<p>${esc(since)}</p>` : ""}</header>`,
  );
  if (intro) {
    const [headline, more] = firstSentence(intro);
    parts.push(
      `<section class="story"><h2 class="headline">${esc(headline)}</h2>${more ? `<div class="standfirst">${paragraphs(more)}</div>` : ""}</section>`,
    );
  }
  if (corrections.length > 0) {
    parts.push(
      `<p class="correction">${corrections.map(esc).join("<br>")}</p>`,
    );
  }
  if (awards.length > 0) {
    parts.push(
      `<ul class="awards">${awards.map((a) => `<li><b>${esc(a.label)}</b>${esc(a.says)}</li>`).join("")}</ul>`,
    );
  }

  const items = rows.map((row) => {
    if (row.kind === "group") return `<li class="group">${esc(row.label)}</li>`;
    const under = !row.line
      ? ""
      : row.line.kind === "statline"
        ? `<span class="statline">${esc(row.line.text)}</span>`
        : `<span class="quote">“${esc(row.line.text)}”</span>`;
    return `<li class="row"><span class="place">${row.place}</span><span class="name">${esc(row.name)} <span class="record">${esc(row.record)}</span></span>${moveSpan(row.move)}${under}</li>`;
  });
  parts.push(`<ol class="places">${items.join("")}</ol>`);
  parts.push(`<footer class="credit">${esc(credit(league))}</footer>`);

  return page(
    `${league.name} power rankings, ${title}`,
    TABLOID_CSS,
    `<main class="tabloid">${parts.join("\n")}</main>`,
  );
}

/**
 * The Broadcast style page: a sports-show graphic with "The week" strip (the
 * intro and its correction note), award chips and slanted rows with big place
 * numbers.
 */
export function renderBroadcast(input: StylePageInput): string {
  const { league } = input;
  const { title, pundit, since, intro, corrections, awards, rows } =
    stylePageParts(input);
  const parts: string[] = [];

  parts.push(
    `<header class="banner"><h1>Power<br>Rankings</h1><p>${esc(league.name)} · ${esc(title)} · by ${esc(pundit)}</p>${since ? `<p>${esc(since)}</p>` : ""}</header>`,
  );
  if (intro || corrections.length > 0) {
    parts.push(
      `<section class="week"><h2>The week</h2>${intro ? `<div class="intro">${paragraphs(intro)}</div>` : ""}${corrections.length > 0 ? `<p class="correction">${corrections.map(esc).join("<br>")}</p>` : ""}</section>`,
    );
  }
  if (awards.length > 0) {
    parts.push(
      `<ul class="chips">${awards.map((a) => `<li><b>${esc(a.label)}</b>${esc(a.says)}</li>`).join("")}</ul>`,
    );
  }

  const items = rows.map((row) => {
    if (row.kind === "group") return `<li class="group">${esc(row.label)}</li>`;
    const under = row.line
      ? `<span class="${row.line.kind === "statline" ? "statline" : "quote"}">${esc(row.line.text)}</span>`
      : "";
    return `<li class="row"><span class="place">${row.place}</span><span class="team"><span class="name">${esc(row.name)} <span class="record">${esc(row.record)}</span></span>${under}</span>${moveSpan(row.move)}</li>`;
  });
  parts.push(`<ol class="places">${items.join("")}</ol>`);
  parts.push(`<footer class="credit">${esc(credit(league))}</footer>`);

  return page(
    `${league.name} power rankings, ${title}`,
    BROADCAST_CSS,
    `<main class="broadcast">${parts.join("\n")}</main>`,
  );
}

/** A row's movement mark, or an empty cell to keep the grid. */
function moveSpan(move: number | "new" | undefined): string {
  return move === undefined
    ? "<span></span>"
    : `<span class="move ${moveClass(move)}">${esc(movementMark(move))}</span>`;
}

function moveClass(move: number | "new"): string {
  if (move === "new") return "new";
  if (move === 0) return "same";
  return move > 0 ? "up" : "down";
}

function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("");
}

/** A self-contained page: no script, no font or file from the network. */
function page(title: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
const HEAVY = '"Arial Black",Impact,"Helvetica Neue",sans-serif';

const TABLOID_CSS = `
*{box-sizing:border-box}
body{margin:0;padding:16px;background:#e9e7e1;color:#111}
.tabloid{max-width:440px;margin:0 auto;background:#fff;border:3px solid #111;font-family:Georgia,"Times New Roman",serif}
.masthead{border-bottom:3px double #111;padding:10px 14px 6px;text-align:center}
.masthead h1{margin:0;font:900 30px/1 ${HEAVY};letter-spacing:-.02em;text-transform:uppercase}
.masthead p{margin:4px 0 0;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.story{padding:10px 14px;border-bottom:1px solid #111}
.headline{margin:0;font:900 22px/1.05 ${HEAVY};text-transform:uppercase}
.standfirst p{margin:6px 0 0;font-size:14px;line-height:1.35}
.correction{margin:0;padding:8px 14px;border-bottom:1px solid #111;font-size:12px;line-height:1.35;background:#fff6d6}
.awards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #111}
.awards li{padding:7px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc;font-size:12px;line-height:1.25}
.awards li:last-child:nth-child(odd){grid-column:1/-1}
.awards b{display:block;font:700 10px/1.2 ${SANS};text-transform:uppercase;letter-spacing:.08em;color:#b0201a}
.places{list-style:none;margin:0;padding:6px 14px 10px}
.group{display:inline-block;margin-top:8px;padding:4px 6px;font:700 10px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;background:#111;color:#fff}
.row{display:grid;grid-template-columns:26px 1fr auto;gap:2px 8px;padding:6px 0;border-bottom:1px dotted #999;font-size:13px;line-height:1.3}
.place{font:900 18px/1 ${HEAVY}}
.name{font-weight:700}
.record{font-weight:400;color:#555}
.move{font:700 11px/1.4 ${SANS};white-space:nowrap}
.move.up{color:#1f8a4c}.move.down{color:#c0392b}.move.same{color:#9a9480}.move.new{color:#2f6fdb}
.quote{grid-column:2/4;font-style:italic;color:#333}
.statline{grid-column:2/4;font:12px/1.3 ${SANS};color:#555}
.credit{padding:8px 14px;border-top:1px solid #111;font:11px/1.3 ${SANS};color:#555;text-align:center}
`;

const NARROW = '"Arial Narrow","Helvetica Neue",Arial,sans-serif';

const BROADCAST_CSS = `
*{box-sizing:border-box}
body{margin:0;padding:16px;background:#05090f;color:#fff}
.broadcast{max-width:440px;margin:0 auto;background:#0e1726;border-radius:6px;overflow:hidden;font-family:${NARROW};overflow-wrap:anywhere}
.banner{padding:16px 16px 12px;background:linear-gradient(100deg,#0e1726 70%,#c8102e 70.2%,#c8102e 84%,#f2a900 84.2%)}
.banner h1{margin:0;font:italic 900 34px/.95 ${HEAVY};text-transform:uppercase;letter-spacing:-.01em}
.banner p{margin:4px 0 0;max-width:62%;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.85}
.week{padding:8px 16px;background:#16233a;border-left:4px solid #f2a900;font-size:13px;line-height:1.35}
.week h2{margin:0;font:700 11px/1.4 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:#f2a900}
.intro p{margin:2px 0 0}
.correction{margin:6px 0 0;font-size:11.5px;color:#c3cbe0}
.chips{list-style:none;display:flex;flex-wrap:wrap;gap:4px;margin:0;padding:8px 16px;background:#16233a;border-top:1px solid #24334f}
.chips li{font-size:11px;line-height:1.3;background:#24334f;border-radius:3px;padding:2px 6px}
.chips b{margin-right:4px;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#f2a900}
.places{list-style:none;margin:0;padding:4px 0 6px}
.group{padding:10px 16px 4px;font:700 10px/1 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:#f2a900}
.row{display:grid;grid-template-columns:46px 1fr auto;align-items:center;margin:4px 10px;background:#1b2a45;clip-path:polygon(0 0,100% 0,97% 100%,0 100%)}
.place{align-self:stretch;display:flex;align-items:center;justify-content:center;background:#c8102e;font:italic 900 26px/1 ${HEAVY}}
.team{padding:6px 10px;min-width:0}
.name{display:block;font-weight:700;font-size:15px;line-height:1.1;text-transform:uppercase}
.record{font-weight:400;font-size:12px;color:#c3cbe0}
.quote,.statline{display:block;margin-top:2px;font-size:11.5px;line-height:1.3;color:#c3cbe0}
.move{padding:0 14px 0 4px;font:700 12px/1 ${SANS};white-space:nowrap}
.move.up{color:#5be08a}.move.down{color:#ff7a6b}.move.same{color:#8a94ad}.move.new{color:#7fb2ff}
.credit{padding:10px 16px;font:10px/1.3 ${SANS};color:#8a94ad}
`;
