import type { CheckedClaim, ClaimStatus, Swear, ValidationResult, ValidatorInput } from "./validator/types.ts";
/**
 * The validator: a pure check of every claim in a blurb or week intro against
 * the evidence pack and order evidence, plus the swearing word list. No I/O,
 * and nothing here knows about the ranking file or the workspace.
 */
export { CLINCHED_LABEL } from "./validator/evidence.ts";
export { normalize, wholeWords } from "./validator/names.ts";
export { applyAutoTags, stripTags } from "./validator/tags.ts";
export type { AutoTag, CheckedClaim, ClaimStatus, EvidencePack, EvidenceValue, OrderEvidence, Swear, Swearing, ValidationResult, ValidatorInput, } from "./validator/types.ts";
export declare function validate(input: ValidatorInput): ValidationResult;
/** Hard problems block nothing on their own, but publish asks before going ahead. */
export declare function isHard(status: ClaimStatus): boolean;
/**
 * The LLM gate: an LLM draft passes only if every claim is tagged and
 * verified, the word list is clean and, under `stakes: none`, nothing
 * mentions money, a prize or a punishment.
 */
export declare function gateLlm(result: ValidationResult): {
    pass: boolean;
    claims: CheckedClaim[];
    swears: Swear[];
    stakesMentions: Swear[];
};
