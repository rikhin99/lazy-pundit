import { type Workspace } from "./workspace.ts";
/**
 * Retention for the workspace's snapshot folder: keeps every snapshot a draft
 * or frozen copy names (as its snapshot or one of its earlier snapshots) and
 * the latest of each season, deletes the others fetched more
 * than 14 days before `now`, then every blob no snapshot left lists.
 */
export declare function applyRetention(ws: Workspace, now: Date): Promise<void>;
