import type { Problem } from "./check.ts";
/**
 * The problems list's heading: "Problems: 1 hard, 1 soft", or "No problems."
 * for an empty list.
 */
export declare function problemsHeading(problems: Problem[]): string;
/**
 * One item of the problems list in words, with its mark: `✗` for a hard
 * problem, `·` for a soft one. A league item (`line` null) has no line or
 * words at fault.
 */
export declare function problemLine(p: Problem): string;
