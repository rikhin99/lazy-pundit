import { readdirSync, watch } from "node:fs";
import { createServer, } from "node:http";
import { checkDraft } from "./check.js";
import { WorkspaceFileError } from "./front-matter.js";
import { previewPage, unreadablePage } from "./preview-page.js";
import { rankingsDir, readWorkspace } from "./workspace.js";
/** The port the preview page tries first; it takes the next one up when that's taken. */
const PREVIEW_PORT = 4790;
/** A draft's file name, `week-NN.md`: what a save of it looks like to the watcher. */
const DRAFT_NAME = /^week-(\d+)\.md$/;
/** How long a save's burst of file events is gathered into one reload notice. */
const SETTLE_MS = 50;
/** How often a rankings folder that isn't there yet is looked for again. */
const RETRY_MS = 500;
/**
 * Serves the preview page for the workspace's newest draft on 127.0.0.1, from
 * `opts.port` up to the first port that's free, and watches the season's
 * rankings folder. Each time the page is served it checks the draft as it is
 * on disk, with no auto-tags, so the file is never written, and fetches
 * nothing. Saving a draft (`week-NN.md`, the newest or a newer one) sends the
 * page one reload notice on `/events`; no other file does.
 */
export async function startPreview(workspaceDir, _deps, opts = {}) {
    const folder = rankingsDir(await readWorkspace(workspaceDir));
    const listeners = new Set();
    const server = createServer((req, res) => {
        void respond(workspaceDir, listeners, req, res);
    });
    const port = await listenFrom(server, opts.port ?? PREVIEW_PORT);
    const watcher = watchDrafts(folder, () => {
        for (const res of listeners)
            res.write("event: reload\ndata: saved\n\n");
    });
    return {
        url: `http://127.0.0.1:${port}`,
        stop: async () => {
            watcher.close();
            for (const res of listeners)
                res.end();
            server.closeAllConnections();
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
async function respond(workspaceDir, listeners, req, res) {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/events") {
        res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
        });
        res.write(": watching the draft\n\n");
        listeners.add(res);
        res.on("close", () => listeners.delete(res));
        return;
    }
    if (path !== "/") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found\n");
        return;
    }
    let html;
    try {
        html = await page(workspaceDir);
    }
    catch (err) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(`${err.message}\n`);
        return;
    }
    res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
    });
    res.end(html);
}
/** The page for the newest draft now, or the message for one that can't be read. */
async function page(workspaceDir) {
    try {
        return previewPage(await checkDraft(workspaceDir, { autoTag: false }));
    }
    catch (err) {
        if (err instanceof WorkspaceFileError)
            return unreadablePage(err.message);
        throw err;
    }
}
/** Listens on 127.0.0.1 at `port`, or the next port up that's free; gives the port. */
async function listenFrom(server, port) {
    for (let p = port;; p += 1) {
        try {
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(p, "127.0.0.1", () => {
                    server.off("error", reject);
                    resolve();
                });
            });
            return p;
        }
        catch (err) {
            const taken = err.code === "EADDRINUSE";
            if (!taken || p >= 65535)
                throw err;
        }
    }
}
/**
 * Whether `name` in `folder` is a draft the page shows or would show: the
 * newest `week-NN.md` there, a newer one just written, or the newest just
 * deleted (no draft in the folder is newer). An older week's draft isn't.
 */
function newestDraft(folder, name) {
    const week = draftWeek(name);
    if (week === undefined)
        return false;
    let names;
    try {
        names = readdirSync(folder);
    }
    catch {
        return true;
    }
    return names.every((n) => (draftWeek(n) ?? 0) <= week);
}
/** The ranking week of a draft's file name, `week-NN.md`, or undefined for any other file. */
function draftWeek(name) {
    const found = DRAFT_NAME.exec(name);
    return found ? Number(found[1]) : undefined;
}
/**
 * Calls `saved` once for each save of the newest draft in `folder`, the burst of file
 * events a save makes gathered into one. A folder that isn't there (no draft
 * so far, or the folder deleted) is looked for again until it is, and its
 * appearing counts as a save, since a draft may have come with it.
 */
function watchDrafts(folder, saved) {
    let watcher;
    let timer;
    let closed = false;
    const start = (again) => {
        if (closed)
            return;
        try {
            watcher = watch(folder, (_event, name) => {
                if (name !== null && !newestDraft(folder, name))
                    return;
                clearTimeout(timer);
                timer = setTimeout(saved, SETTLE_MS);
            });
        }
        catch {
            timer = setTimeout(() => start(true), RETRY_MS);
            return;
        }
        watcher.on("error", () => {
            watcher?.close();
            timer = setTimeout(() => start(true), RETRY_MS);
        });
        if (again)
            saved();
    };
    start(false);
    return {
        close() {
            closed = true;
            clearTimeout(timer);
            watcher?.close();
        },
    };
}
//# sourceMappingURL=preview.js.map