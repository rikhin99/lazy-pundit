import { list } from "./evidence-pack.js";
/**
 * The ranking week's awards, picked from the evidence pack's league items:
 * top and low score, biggest margin, closest matchup, upset, robbed, each
 * house rule's trigger winners, each rivalry week pair, and the teams that
 * clinched this week. An award with no candidate is left out.
 */
export function awards(items, league, stakes) {
    const names = new Map(league.teams.map((t) => [t.id, t.name]));
    const team = (id) => {
        const t = String(items[id]);
        return names.get(t) ?? t;
    };
    const teams = (id) => list(String(items[id])
        .split(",")
        .map((t) => names.get(t) ?? t));
    const has = (id) => items[id] !== undefined;
    const out = [];
    const add = (when, label, says) => {
        if (when)
            out.push({ label, says: says() });
    };
    add(has("wk.high"), "Top score", () => `${team("wk.high_team")} · ${items["wk.high"]}`);
    add(has("wk.low"), "Low score", () => `${team("wk.low_team")} · ${items["wk.low"]}`);
    add(has("wk.margin_max"), "Biggest margin", () => `${team("wk.margin_max_team")} by ${items["wk.margin_max"]}`);
    add(has("wk.margin_min"), "Closest matchup", () => `${team("wk.margin_min_team")} by ${items["wk.margin_min"]}`);
    add(has("wk.upset"), "Upset", () => `${team("wk.upset")} over ${team("wk.upset_over")}`);
    add(has("wk.robbed"), "Robbed", () => `${team("wk.robbed")} · ${items["wk.robbed_points"]} in a loss`);
    if (stakes.kind === "recorded") {
        for (const rule of stakes.houseRules) {
            const id = `wk.rule.${rule.id}`;
            add(has(id), rule.name, () => teams(id));
        }
    }
    for (const id of Object.keys(items).filter((k) => /^wk\.rivalry\.\d+$/.test(k))) {
        const winner = items[`${id}.winner`];
        add(true, "Rivalry week", () => winner ? `${teams(id)}, won by ${team(`${id}.winner`)}` : teams(id));
    }
    add(has("wk.clinched"), "Clinched this week", () => teams("wk.clinched"));
    return out;
}
//# sourceMappingURL=awards.js.map