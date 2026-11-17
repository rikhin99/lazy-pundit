import { describe, expect, test } from "vitest";
import {
  type Check,
  CUE_PAIRS,
  claimsDiff,
  corpus,
} from "../scripts/claims-diff-report.ts";
import { type CheckedClaim, validate } from "../src/index.ts";
import { NUMBER_CUES, ORDINAL_CUES } from "../src/validator/extract.ts";
import { TRUE_UNTAGGED } from "./support/plain-prose.ts";

const claim = (over: Partial<CheckedClaim>): CheckedClaim => ({
  text: "8th",
  start: 0,
  end: 3,
  tagged: false,
  status: "verified",
  reason: "matches standing",
  ...over,
});

/** A validator that gives every input the same claims. */
const always =
  (claims: CheckedClaim[]): Check =>
  () => ({ claims, autoTags: [], swears: [], stakesMentions: [] });

describe("the claims diff", () => {
  test("no difference prints one line saying so", () => {
    const same = always([claim({ id: "standing" })]);
    expect(claimsDiff(same, same)).toEqual([
      "No claim reads differently in any sentence.",
    ]);
  });

  test("a changed claim prints its section, sentence and both readings", () => {
    const lines = claimsDiff(
      always([
        claim({ status: "wrong", reason: "pf_rank is 3" }),
        claim({ text: "3rd", start: 5, end: 8, id: "pf_rank" }),
      ]),
      always([
        claim({ id: "standing" }),
        claim({ text: "3rd", start: 5, end: 8, id: "pf_rank" }),
      ]),
      [{ team: 2, text: "3rd in points and 8th in the standings." }],
    );
    expect(lines).toEqual([
      "1 sentence reads differently:",
      "",
      "section 2 (Wendy's Wire): 3rd in points and 8th in the standings.",
      '  "8th": wrong (pf_rank is 3) → verified standing (matches standing)',
      '  "3rd": unchanged, verified pf_rank',
    ]);
  });

  test("a claim found on one side only reads as none on the other", () => {
    const lines = claimsDiff(always([]), always([claim({ id: "standing" })]), [
      { team: null, text: "8th in the standings." },
    ]);
    expect(lines.slice(2)).toEqual([
      "section none: 8th in the standings.",
      '  "8th": none → verified standing (matches standing)',
    ]);
  });

  test("runs a TRUE_UNTAGGED sentence in its own section and others in every section", () => {
    const cases = corpus();
    const [team, text] = TRUE_UNTAGGED[0] ?? [];
    expect(cases.filter((c) => c.text === text)).toEqual([{ team, text }]);
    const pair = CUE_PAIRS[0];
    expect(cases.filter((c) => c.text === pair).map((c) => c.team)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      null,
    ]);
  });

  test("the real validator against itself reads no difference", () => {
    expect(claimsDiff(validate, validate)).toEqual([
      "No claim reads differently in any sentence.",
    ]);
  });
});

describe("the cue-pair sentences", () => {
  const cues = [...ORDINAL_CUES, ...NUMBER_CUES].map(([re]) => re);
  const stat = ORDINAL_CUES.filter(([, key]) => key(8) !== "place");
  const ranking = ORDINAL_CUES.find(([, key]) => key(8) === "place")?.[0];

  test.each(stat.map(([re]) => [re.source, re]))(
    "a ranking cue sits beside the stat cue %s",
    (_, re) => {
      expect(
        CUE_PAIRS.some((s) => {
          const l = s.toLowerCase();
          return re.test(l) && ranking?.test(l);
        }),
      ).toBe(true);
    },
  );

  test.each(cues.map((re) => [re.source, re]))(
    "the cue %s shares a sentence with another cue",
    (_, re) => {
      expect(
        CUE_PAIRS.some((s) => {
          const l = s.toLowerCase();
          return re.test(l) && cues.some((o) => o !== re && o.test(l));
        }),
      ).toBe(true);
    },
  );
});
