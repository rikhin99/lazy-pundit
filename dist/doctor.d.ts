import type { Deps } from "./deps.ts";
export interface DoctorCheck {
    /** What was checked: `Node`, `config.yaml`, `workspace <slug>` and so on. */
    subject: string;
    /** `note` is something to know that needs no fixing. */
    status: "ok" | "note" | "warn" | "fail";
    message: string;
    /** What to do about a `warn` or `fail`, or how to change a `note`. */
    fix?: string;
}
export interface DoctorResult {
    checks: DoctorCheck[];
    /** True when no check failed. */
    ok: boolean;
}
/**
 * Checks the operator's setup: Node, each of their files, each credential
 * with one live call, and every workspace `config.yaml` lists. A listed
 * folder that has gone is dropped from the list; no folder is ever touched.
 */
export declare function doctor(deps: Deps): Promise<DoctorResult>;
