/**
 * Screenshots each page at phone width and prints each PNG's path, beside
 * its page. Headless Chrome won't lay out narrower than 500px, so each page
 * is framed in an iframe of the width asked for: a screenshot at 390px of the
 * page itself crops it, which looks like overflow.
 *
 *   npm run -s screenshot -- <page.html>... [--width 390] [--height 2000] [--label <name>]
 *
 * `--label` puts its name in each PNG's (`week-10.tabloid.no-llm.390.png`),
 * so a second run on the same pages, after an edit, keeps the first's.
 *
 * Needs Google Chrome; set CHROME to its binary if it isn't in the usual
 * place.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function stop(message: string): never {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
function option(name: string, fallback: number): number {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = Number(args[at + 1]);
  if (!Number.isInteger(value) || value <= 0) stop(`${name} takes a number`);
  args.splice(at, 2);
  return value;
}
const width = option("--width", 390);
const height = option("--height", 2000);
const labelAt = args.indexOf("--label");
const label = labelAt < 0 ? undefined : args[labelAt + 1];
if (labelAt >= 0) {
  if (!label || !/^[\w-]+$/.test(label)) {
    stop("--label takes a name of letters, digits, - and _");
  }
  args.splice(labelAt, 2);
}
if (args.length === 0) {
  stop(
    "usage: npm run -s screenshot -- <page.html>... [--width 390] [--height 2000] [--label <name>]",
  );
}

const chrome =
  process.env.CHROME ??
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((path) => existsSync(path));
if (!chrome) stop("No Chrome found; set CHROME to its binary.");

const frames = mkdtempSync(join(tmpdir(), "lazy-pundit-screenshot-"));
try {
  for (const arg of args) {
    const page = resolve(arg);
    if (!existsSync(page)) stop(`No such page: ${arg}`);
    const frame = join(frames, `${basename(page)}.frame.html`);
    writeFileSync(
      frame,
      `<!doctype html><body style="margin:0"><iframe src="${pathToFileURL(page).href}" width="${width}" height="${height}" style="border:0;display:block"></iframe>`,
    );
    const png = `${page.replace(/\.html$/, "")}${label ? `.${label}` : ""}.${width}.png`;
    const run = spawnSync(
      chrome,
      [
        "--headless=new",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        `--window-size=${Math.max(width, 500)},${height}`,
        `--screenshot=${png}`,
        pathToFileURL(frame).href,
      ],
      { encoding: "utf8" },
    );
    if (run.status !== 0 || !existsSync(png)) {
      stop(`Chrome failed on ${arg}:\n${run.stderr}`);
    }
    console.log(png);
  }
} finally {
  rmSync(frames, { recursive: true, force: true });
}
