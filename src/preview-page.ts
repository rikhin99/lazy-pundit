import type { CheckedDraft, Problem, ProblemClaim } from "./check.ts";
import type { Injury } from "./evidence-pack.ts";
import type { TeamId } from "./league.ts";
import { movementMark, shownMove } from "./movement.ts";
import { movementSince, plainTextBlocks } from "./plain-text.ts";
import { problemLine, problemsHeading } from "./problems-list.ts";
import {
  decimal,
  STAT_COLUMNS,
  STATS_KEY,
  type StatsTableRow,
  statsTableFrom,
} from "./stats-table.ts";
import {
  esc,
  renderBroadcast,
  renderTabloid,
  stylePageInput,
} from "./style-pages.ts";
import { stripTags } from "./validator.ts";

/**
 * The preview page for a draft as `checkDraft` read it: the problems list,
 * then a tab for each form of the published ranking (Plain text, Tabloid,
 * Broadcast), each what `publish`
 * would write for the draft now, under a strip saying it isn't published.
 */
export function previewPage(checked: CheckedDraft): string {
  const { ranking, league, order, baseline } = checked;
  const blocks = plainTextBlocks(ranking, league, order, baseline).map((b) =>
    b.entry === null
      ? esc(b.text)
      : `<span id="${entryId(b.entry)}">${esc(b.text)}</span>`,
  );
  const input = stylePageInput(checked);
  const strip = `<p class="strip">Draft: not published yet</p>\n`;
  const tabs: [name: string, label: string, content: string][] = [
    ["plain", "Plain text", `${strip}<pre>${blocks.join("\n\n")}\n</pre>`],
    ["tabloid", "Tabloid", strip + frame("Tabloid", renderTabloid(input))],
    [
      "broadcast",
      "Broadcast",
      strip + frame("Broadcast", renderBroadcast(input)),
    ],
    // The editing view: what the league never sees, so no strip.
    ["check", "Check", checkTab(checked)],
  ];
  const buttons = tabs.map(
    ([name, label], i) =>
      `<button role="tab" aria-selected="${i === 0}" aria-controls="tab-${name}" data-tab="${name}">${label}</button>`,
  );
  const panels = tabs.map(
    ([name, , content], i) =>
      `<section role="tabpanel" id="tab-${name}"${i === 0 ? "" : " hidden"}>
${content}
</section>`,
  );
  return shell(
    `${problemsList(checked.problems, checked.warnings)}
<nav role="tablist" aria-label="What the league would get">${buttons.join("")}</nav>
${panels.join("\n")}`,
  );
}

/** The page for a draft that can't be read: the message the CLI prints, alone. */
export function unreadablePage(message: string): string {
  return shell(`<p class="unreadable">${esc(message)}</p>`);
}

/**
 * The problems list, above the tabs: `check`'s heading and lines, hard first as the library
 * orders them, then the warnings. A team's or the intro's item links to its
 * entry; a league item (no line) has no link.
 */
function problemsList(problems: Problem[], warnings: string[]): string {
  const lines = problems.map((p) => {
    const words = esc(problemLine(p));
    const item =
      p.line === null
        ? words
        : `<a href="#${checkId(p.team ?? "intro")}" data-entry>${words}</a>`;
    return `<li class="${p.severity}">${item}</li>`;
  });
  const list = lines.length > 0 ? `\n<ul>${lines.join("")}</ul>` : "";
  const notes = warnings.map((w) => `\n<p class="warning">! ${esc(w)}</p>`);
  return `<section class="problems" aria-label="Problems">
<h1>${esc(problemsHeading(problems))}</h1>${list}${notes.join("")}
</section>`;
}

/** The Plain text tab's anchor for a team's entry or the intro. */
function entryId(entry: string): string {
  return `entry-${anchor(entry)}`;
}

/** The Check tab's anchor for a team's block or the intro's. */
function checkId(entry: string): string {
  return `check-${anchor(entry)}`;
}

function anchor(entry: string): string {
  return entry.replace(/[^A-Za-z0-9_-]/g, "-");
}

/**
 * The Check tab, the editing view: the power-score method, then the week
 * intro and each team in the draft's order as the league reads them, each
 * claim with a problem underlined, a team's place beside its starting place
 * and its stats.
 */
function checkTab(checked: CheckedDraft): string {
  const { ranking, order, baseline, problemClaims } = checked;
  const { week } = ranking.meta;
  const table = statsTableFrom(checked);
  const rows = new Map(table.rows.map((r) => [r.team, r]));
  const marked = (team: TeamId | null, text: string) =>
    underlined(
      stripTags(text),
      problemClaims.filter((c) => c.team === team),
    );
  const head = [
    `<p class="method">Power-score method: ${esc(table.method)}</p>`,
    ...STATS_KEY.map((line) => `<p class="key">${esc(line)}</p>`),
  ];
  const since = movementSince(week, baseline);
  if (since) head.push(`<p class="since">${esc(since)}</p>`);
  const blocks: string[] = [];
  if (ranking.intro) {
    blocks.push(`<article class="entry intro" id="${checkId("intro")}"><div class="body"><h2>Week intro</h2>
<p class="blurb">${marked(null, ranking.intro)}</p></div></article>`);
  }
  for (const entry of ranking.entries) {
    if (entry.kind === "group") {
      blocks.push(`<h3 class="group">${esc(entry.label)}</h3>`);
      continue;
    }
    const team = entry.team as TeamId;
    const row = rows.get(team);
    if (!row) throw new Error(`No team ${team} in the league`);
    const move = shownMove(week, order, team);
    const mark =
      move === undefined
        ? ""
        : ` <span class="mark">${esc(movementMark(move))}</span>`;
    const blurb = entry.blurb
      ? `\n<p class="blurb">${marked(team, entry.blurb)}</p>`
      : "";
    blocks.push(`<article class="entry" id="${checkId(team)}"><div class="places"><span class="place" title="Place">${row.place}</span><span class="start" title="Starting place">start ${row.start}</span></div>
<div class="body"><h2>${esc(row.name)}${mark}</h2>${blurb}</div>
${statsPanel(row)}</article>`);
  }
  return `<header class="check">${head.join("")}</header>
${blocks.join("\n")}`;
}

/**
 * `text` with each claim's words underlined, solid for a hard problem and
 * dashed for a soft one. A claim overlapping one before it is left plain.
 */
function underlined(text: string, claims: ProblemClaim[]): string {
  let out = "";
  let at = 0;
  for (const c of [...claims].sort((a, b) => a.start - b.start)) {
    if (c.start < at || c.end <= c.start) continue;
    out += `${esc(text.slice(at, c.start))}<u class="${c.severity}">${esc(text.slice(c.start, c.end))}</u>`;
    at = c.end;
  }
  return out + esc(text.slice(at));
}

/** A team's stats panel: each stat as the Stats table prints it, then points for and injuries. */
function statsPanel(row: StatsTableRow): string {
  const stats: [label: string, values: string[]][] = [
    ...STAT_COLUMNS.map((c): [string, string[]] => [c.heading, [c.cell(row)]]),
    ["Points for", [decimal(row.pointsFor)]],
    // An empty list is a known answer, not a stat still to come.
    ["Injuries", row.injuries.length > 0 ? row.injuries.map(injury) : ["none"]],
  ];
  const items = stats.map(
    ([label, values]) =>
      `<dt>${label}</dt>${values.map((v) => `<dd>${esc(v)}</dd>`).join("")}`,
  );
  return `<dl class="stats">${items.join("")}</dl>`;
}

/** "Alec Pierce (IR, Heel)", or "(IR)" alone without a body part. */
function injury({ name, status, bodyPart }: Injury): string {
  return `${name} (${bodyPart ? `${status}, ${bodyPart}` : status})`;
}

/** A style page whole, in a frame of its own so its styles stay inside it. */
function frame(title: string, html: string): string {
  const doc = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<iframe title="${title}" srcdoc="${doc}"></iframe>`;
}

function shell(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lazy Pundit preview</title>
<style>${CSS}</style>
</head>
<body>
${body}
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const CSS = `
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--hard:#c1121f;--warn:#9a6700;--strip:#fff4ce;--strip-fg:#5c4400;--tab:#f2f2f5}
@media (prefers-color-scheme: dark){:root{--bg:#1c1c1e;--fg:#f2f2f7;--muted:#a1a1a6;--line:#3a3a3c;--hard:#ff6b6b;--warn:#f2c94c;--strip:#3d3418;--strip-fg:#f2dc9b;--tab:#2c2c2e}}
*{box-sizing:border-box}
body{margin:0 auto;max-width:900px;padding:12px 16px 32px;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.problems{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:13px}
.problems h1{font-size:14px;margin:0 0 4px}
.problems ul{list-style:none;margin:0;padding:0}
.problems li{padding:2px 0;overflow-wrap:anywhere}
.problems li.hard{color:var(--hard)}
.problems a{color:inherit}
.problems .warning{margin:4px 0 0;color:var(--warn);overflow-wrap:anywhere}
[role=tablist]{display:flex;gap:4px;border-bottom:1px solid var(--line)}
[role=tab]{font:inherit;color:inherit;background:none;border:1px solid transparent;border-bottom:none;border-radius:6px 6px 0 0;padding:6px 12px;cursor:pointer}
[role=tab][aria-selected=true]{background:var(--tab);border-color:var(--line);font-weight:600}
.strip{margin:8px 0;padding:4px 10px;border-radius:4px;background:var(--strip);color:var(--strip-fg);font-size:13px;font-weight:600}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre :target{background:var(--strip)}
iframe{display:block;width:100%;min-height:400px;border:1px solid var(--line);border-radius:4px;background:#fff}
.check{margin:8px 0;font-size:13px;color:var(--muted)}
.check p{margin:0}
.entry{display:grid;grid-template-columns:44px minmax(0,1fr) 190px;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);align-items:start}
.entry.intro{grid-template-columns:minmax(0,1fr)}
.entry h2{font-size:15px;margin:0 0 4px}
.entry .mark{font-weight:400;color:var(--muted)}
.places{display:flex;flex-direction:column;align-items:center}
.place{font:800 22px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.start{font-size:11px;color:var(--muted);white-space:nowrap}
.blurb{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.blurb u{text-decoration-thickness:2px;text-underline-offset:3px}
.blurb u.hard{text-decoration-line:underline;text-decoration-style:solid;text-decoration-color:var(--hard)}
.blurb u.soft{text-decoration-line:underline;text-decoration-style:dashed;text-decoration-color:var(--warn)}
.stats{display:grid;grid-template-columns:auto minmax(0,1fr);gap:1px 8px;margin:0;font-size:12px}
.stats dt{grid-column:1;color:var(--muted)}
.stats dd{grid-column:2;margin:0;overflow-wrap:anywhere}
.group{margin:14px 0 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
:target{scroll-margin-top:8px}
.entry:target{background:var(--strip)}
@media (max-width:640px){.entry{grid-template-columns:44px minmax(0,1fr)}.entry .stats{grid-column:2}}
.unreadable{padding:12px;border:1px solid var(--hard);border-radius:8px;color:var(--hard);overflow-wrap:anywhere}
`;

// Shows the tab remembered in the browser's storage (Plain text without it),
// sizes each frame to its page, and reloads on the server's notice that the
// draft was saved.
const SCRIPT = `
(() => {
  const KEY = "lazy-pundit-preview-tab";
  const tabs = [...document.querySelectorAll("[role=tab]")];
  const fit = (f) => {
    try { f.style.height = f.contentDocument.documentElement.scrollHeight + "px"; } catch {}
  };
  const show = (name, remember) => {
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", String(on));
      const panel = document.getElementById("tab-" + t.dataset.tab);
      panel.hidden = !on;
      if (on) panel.querySelectorAll("iframe").forEach(fit);
    }
    if (remember) { try { localStorage.setItem(KEY, name); } catch {} }
  };
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  if (tabs.some((t) => t.dataset.tab === saved)) show(saved, false);
  for (const t of tabs) t.addEventListener("click", () => show(t.dataset.tab, true));
  for (const a of document.querySelectorAll("a[data-entry]")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      show("check", true);
      const id = a.getAttribute("href").slice(1);
      history.replaceState(null, "", "#" + id);
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
  }
  for (const f of document.querySelectorAll("iframe")) f.addEventListener("load", () => fit(f));
  addEventListener("resize", () => document.querySelectorAll("iframe").forEach(fit));
  new EventSource("/events").addEventListener("reload", () => location.reload());
})();
`;
