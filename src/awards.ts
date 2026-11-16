import { list } from "./evidence-pack.ts";
import type { League, TeamId } from "./league.ts";
import type { Stakes } from "./stakes.ts";
import type { EvidenceValue } from "./validator.ts";

/** One award: its label and what it says, with no tags. */
export interface Award {
  label: string;
  says: string;
}

/**
 * The ranking week's awards, picked from the evidence pack's league items:
 * top and low score, biggest margin, closest matchup, upset, robbed, each
 * house rule's trigger winners, each rivalry week pair, and the teams that
 * clinched this week. An award with no candidate is left out.
 */
export function awards(
  items: Record<string, EvidenceValue>,
  league: League,
  stakes: Stakes,
): Award[] {
  const names = new Map<string, string>(
    league.teams.map((t) => [t.id, t.name]),
  );
  const team = (id: string) => {
    const t = String(items[id]);
    return names.get(t) ?? t;
  };
  const teams = (id: string) =>
    list(
      String(items[id])
        .split(",")
        .map((t) => names.get(t) ?? t),
    );
  const has = (id: string) => items[id] !== undefined;
  const out: Award[] = [];
  const add = (when: boolean, label: string, says: () => string) => {
    if (when) out.push({ label, says: says() });
  };

  add(
    has("wk.high"),
    "Top score",
    () => `${team("wk.high_team")} · ${items["wk.high"]}`,
  );
  add(
    has("wk.low"),
    "Low score",
    () => `${team("wk.low_team")} · ${items["wk.low"]}`,
  );
  add(
    has("wk.margin_max"),
    "Biggest margin",
    () => `${team("wk.margin_max_team")} by ${items["wk.margin_max"]}`,
  );
  add(
    has("wk.margin_min"),
    "Closest matchup",
    () => `${team("wk.margin_min_team")} by ${items["wk.margin_min"]}`,
  );
  add(
    has("wk.upset"),
    "Upset",
    () => `${team("wk.upset")} over ${team("wk.upset_over")}`,
  );
  add(
    has("wk.robbed"),
    "Robbed",
    () => `${team("wk.robbed")} · ${items["wk.robbed_points"]} in a loss`,
  );
  if (stakes.kind === "recorded") {
    for (const rule of stakes.houseRules) {
      const id = `wk.rule.${rule.id}`;
      add(has(id), rule.name, () => teams(id));
    }
  }
  for (const id of Object.keys(items).filter((k) =>
    /^wk\.rivalry\.\d+$/.test(k),
  )) {
    const winner = items[`${id}.winner`] as TeamId | undefined;
    add(true, "Rivalry week", () =>
      winner ? `${teams(id)}, won by ${team(`${id}.winner`)}` : teams(id),
    );
  }
  add(has("wk.clinched"), "Clinched this week", () => teams("wk.clinched"));
  return out;
}
