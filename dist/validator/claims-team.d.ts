import type { TeamId } from "../league.ts";
import type { Ctx } from "./types.ts";
/**
 * The claim's team for an untagged claim at `start` of sentence `s`: the
 * subject of the claim's clause. A claim in brackets or a "who" clause
 * straight after a name is that team's ("lost to Gus Bus (4-4)"); a phrase
 * put before its subject takes the next clause's ("At 7-1, Bench Mob lead");
 * a clause naming no subject carries on the one before it ("Pete lost to Gus
 * Bus and sits at 3-5"), and the sentence starts from the section's team. A
 * clause opened by a bare "and" carries on "them" as the team that lost
 * ("Bench Mob beat Sam, leaving them 4-4 and fifth"); one after ", and"
 * carries on the sentence's subject ("…, handing them a loss, and sits at 4-4").
 */
export declare function claimsTeam(ctx: Ctx, s: string, start: number, section: TeamId | null): TeamId | null;
