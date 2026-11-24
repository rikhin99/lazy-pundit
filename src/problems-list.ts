import type { Problem } from "./check.ts";

/** Each kind of problem as the pundit reads it, in `check` and on the preview page. */
const KINDS: Record<Problem["kind"], string> = {
  wrong: "wrong",
  stale: "stale",
  "unknown-id": "unknown ID",
  "empty-tag": "empty tag",
  loose: "loose",
  unchecked: "unchecked",
  swear: "word list",
  "no-stakes": "bragging rights only",
  "unreadable-tag": "unreadable tag",
  moved: "you moved this team",
  "small-sample": "small sample",
  "no-starting-order": "preseason",
  "failed-fetch": "fetch failed",
  provisional: "provisional",
  "correction-timing": "correction timing",
  "cant-compare": "can't compare",
  "correction-missing": "correction not in the draft",
  "relaxed-persona": "relaxed persona",
};

/**
 * The problems list's heading: "Problems: 1 hard, 1 soft", or "No problems."
 * for an empty list.
 */
export function problemsHeading(problems: Problem[]): string {
  if (problems.length === 0) return "No problems.";
  const hard = problems.filter((p) => p.severity === "hard").length;
  return `Problems: ${hard} hard, ${problems.length - hard} soft`;
}

/**
 * One item of the problems list in words, with its mark: `✗` for a hard
 * problem, `·` for a soft one. A league item (`line` null) has no line or
 * words at fault.
 */
export function problemLine(p: Problem): string {
  const mark = p.severity === "hard" ? "✗" : "·";
  if (p.line === null)
    return `${mark} ${p.section}: ${KINDS[p.kind]}: ${p.reason}`;
  const cause = p.cause ? `, after a ${p.cause}` : "";
  const gate = p.gate ? ", gate failure" : "";
  return `${mark} line ${p.line} ${p.section}: "${p.text}" ${KINDS[p.kind]}${cause}${gate}: ${p.reason}`;
}
