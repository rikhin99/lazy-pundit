/** The slot of every lineup entry that didn't start. */
export const BENCH = "BN";
/**
 * The teams a manager handle runs in this league, through the accounts
 * `workspace.md` links it to (`sleeper:<account ID>`). None for a departed
 * manager or a handle with no link.
 */
export function teamsOfAccounts(league, accounts) {
    return league.teams
        .filter((t) => t.managers.some((m) => accounts.includes(`${league.platform}:${m.accountId}`)))
        .map((t) => t.id);
}
/** Whether a lineup entry started: the one test, so every stat agrees. */
export function isStarter(e) {
    return e.slot !== BENCH;
}
/** "7-1", or "6-1-1" with ties. */
export function formatRecord(s) {
    return s.ties > 0
        ? `${s.wins}-${s.losses}-${s.ties}`
        : `${s.wins}-${s.losses}`;
}
//# sourceMappingURL=league.js.map