import { type Award } from "./awards.ts";
import type { CheckedDraft } from "./check.ts";
import { type League, type TeamId } from "./league.ts";
import { type MovementBaseline } from "./movement.ts";
import type { RankingFile } from "./ranking-file.ts";
import { type OrderEvidence } from "./validator.ts";
/** What every style page renders: the frozen copy and what checking it found. */
export interface StylePageInput {
    ranking: RankingFile;
    league: League;
    order: Record<TeamId, OrderEvidence>;
    baseline: MovementBaseline | undefined;
    awards: Award[];
    /**
     * The stat lines `draft` writes when there's no LLM: the league's, as the
     * intro, and each team's, as its blurb. Tags and all.
     */
    statLines: {
        intro: string;
        teams: Record<string, string>;
    };
}
/**
 * What the style pages render for a checked draft, with the week's awards:
 * the one builder `publish` and the preview page share, so the two can't
 * drift. The stat lines `draft` writes with no LLM come along, so a page can
 * tell prose from them.
 */
export declare function stylePageInput(checked: CheckedDraft): StylePageInput;
/** The Tabloid style page: masthead, intro as headline, awards box, pull quotes. */
export declare function renderTabloid(input: StylePageInput): string;
/**
 * The Broadcast style page: a sports-show graphic with "The week" strip (the
 * intro and its correction note), award chips and slanted rows with big place
 * numbers.
 */
export declare function renderBroadcast(input: StylePageInput): string;
/** Text escaped for HTML, in an element or a quoted attribute. */
export declare function esc(text: string): string;
