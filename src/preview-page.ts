import type { CheckedDraft, Problem } from "./check.ts";
import { plainTextBlocks } from "./plain-text.ts";
import { problemLine, problemsHeading } from "./problems-list.ts";
import {
  esc,
  renderBroadcast,
  renderTabloid,
  stylePageInput,
} from "./style-pages.ts";

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
  const tabs: [name: string, label: string, content: string][] = [
    ["plain", "Plain text", `<pre>${blocks.join("\n\n")}\n</pre>`],
    ["tabloid", "Tabloid", frame("Tabloid", renderTabloid(input))],
    ["broadcast", "Broadcast", frame("Broadcast", renderBroadcast(input))],
  ];
  const buttons = tabs.map(
    ([name, label], i) =>
      `<button role="tab" aria-selected="${i === 0}" aria-controls="tab-${name}" data-tab="${name}">${label}</button>`,
  );
  const panels = tabs.map(
    ([name, , content], i) =>
      `<section role="tabpanel" id="tab-${name}"${i === 0 ? "" : " hidden"}>
<p class="strip">Draft: not published yet</p>
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
        : `<a href="#${entryId(p.team ?? "intro")}" data-entry>${words}</a>`;
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
  return `entry-${entry.replace(/[^A-Za-z0-9_-]/g, "-")}`;
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
      show("plain", true);
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
