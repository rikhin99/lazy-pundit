/**
 * Ordinary blurb sentences with no checkable claim, or only odd phrasing the
 * validator can't pin to a stat. Whatever team's section they sit in, none
 * may come back hard (wrong, stale or unknown ID): the spec's known limit is
 * false loose or unchecked results, never a false hard one. Add a sentence
 * here whenever a review or a pundit finds one that tripped the validator.
 */
export const PLAIN_PROSE = [
  // opinions, jokes, superlatives with no number
  "Still frauds.",
  "Nobody in this league has scored more.",
  "The best team in the league, and it isn't close.",
  "They lead the league in points and vibes.",
  "Dead last in our hearts.",
  "Bo has been insufferable in the group chat since the trade.",
  "Their first good week in a month, and the bench finally showed up.",
  "A new high for the bench.",
  "Nobody wants to see them in the playoffs.",
  "The trade deadline can't come soon enough.",
  "Shitake risotto, assassin energy.",
  // odd phrasing found in review (#41)
  "They've won 7 games.",
  "Second straight week at the top.",
  "Up 3 on the year.",
  "Seven wins, one loss.",
  "Three weeks ago this looked like a contender.",
  "Back in week 6 of the 2025 season.",
  "In week 3 they finally found a running game, and in week 4 a kicker.",
  "Since week 2 they've been the league's best story.",
  "Two of their starters scored zero.",
  "Fourth time this year the kicker missed.",
  "A first-round pick on the bench.",
  "Ten minutes after kickoff the lineup was already cooked.",
  // a player's injury, not the bracket (#72)
  "Their WR1 got knocked out with a hamstring.",
  "Their QB got knocked out in the final minutes.",
  "A rookie knocked out in the first round of the draft.",
  // average cues with no stat to pin (#69)
  "The group chat averages a meltdown per week.",
  "Over the last three weeks the vibes have been immaculate.",
  "Below average, every single game.",
  // player names outside any tag (#69)
  "Bijan Robinson would have changed everything.",
  "Taylor did his job, nobody else did.",
  // other teams beside the words that pick a claim's team (#100)
  "Pete lost to Gus Bus (again) and blamed the kicker.",
  "Pete trails Bench Mob, who never sleep.",
  "At home, Bench Mob lead the way, with Pete behind them.",
  "Gus Bus beat us, and we know it.",
  "Nobody wants to be on the wrong end of Bench Mob, than whom nobody is hotter.",
];

/**
 * True tagged claims with the words a validator rule that reads inside a tag
 * can trip on: team names (with "The"), places, positions, initials, days.
 * Each cites a team by ID, so it holds in any section; none may come back
 * hard. Add a sentence whenever a rule starts judging the words in a tag.
 */
export const TAGGED_PLAIN = [
  "[The Bench Mob's 38.4]{ev=sleeper:3/w8.top_points} came from one man.",
  "[Jonathan Taylor's 38.4]{ev=sleeper:3/w8.top_points} against the Texans.",
  "[Taylor]{ev=sleeper:3/w8.top} went off on Sunday.",
  "[RB Taylor's 38.4]{ev=sleeper:3/w8.top_points} was the week.",
  "[MVP Taylor]{ev=sleeper:3/w8.top} did it again.",
  "[Colts Jonathan Taylor]{ev=sleeper:3/w8.top} did it again.",
  "[Indy's 38.4]{ev=sleeper:3/w8.top_points} carried them.",
  "[Sunday's 38.4]{ev=sleeper:3/w8.top_points} carried them.",
  "[Johnston]{ev=sleeper:3/w8.zeros} gave them nothing.",
  "[Spears' 16.7]{ev=sleeper:3/w8.benchmiss_points} rotted on the bench.",
  "[Kraft's 31.8]{ev=sleeper:3/w8.opp.top_points} hurt the Bench Mob.",
  "[The Hail Mary Hustle's Jake Ferguson]{ev=sleeper:9/w8.zeros} gave them nothing.",
  "They're averaging [122.85]{ev=sleeper:3/ppg} per week.",
];

/**
 * True untagged claims that name more than one team, each as its section's
 * team number, the sentence, and the evidence ID each claim must verify
 * against in order (null where two stats match, so no one ID is written).
 * Add a sentence whenever a change moves which team or week a claim reads.
 */
export const TRUE_UNTAGGED: [number | null, string, (string | null)[]][] = [
  [
    6,
    "Pete lost to Gus Bus by 55 and sits at 3-5.",
    ["w8.result", "w8.margin", "record"],
  ],
  [
    6,
    "Lost to Gus Bus by 55 and sits at 3-5.",
    ["w8.result", "w8.margin", "record"],
  ],
  [
    6,
    "Gus Bus beat us by 55, and we sit at 3-5.",
    ["sleeper:1/w8.margin", "record"],
  ],
  [
    6,
    "While Bench Mob sit at 7-1, we are 3-5.",
    ["sleeper:3/record", "record"],
  ],
  [
    6,
    "Bench Mob are 7-1; meanwhile this team sits at 3-5 in 11th.",
    ["sleeper:3/record", "record", null],
  ],
  [
    6,
    "Gus Bus won by 55 and the loss leaves them 3-5.",
    ["sleeper:1/w8.margin", "record"],
  ],
  [6, "Bench Mob lead, with Pete at 3-5.", ["record"]],
  [6, "At 7-1, Bench Mob lead the league.", ["sleeper:3/record"]],
  [6, "Gus Bus, at 4-4, sit in sixth.", ["sleeper:1/record", null]],
  [
    6,
    "Pete lost to Gus Bus (4-4) and sits at 3-5.",
    ["w8.result", "sleeper:1/record", "record"],
  ],
  [6, "Pete trails Bench Mob, who sit at 7-1.", ["sleeper:3/record"]],
  [
    6,
    "Pete fell to Gus Bus, who are 4-4 now.",
    ["w8.result", "sleeper:1/record"],
  ],
  [6, "Gus Bus dropped 133.22 on Pete.", ["sleeper:1/w8.points"]],
  [
    6,
    "Gus Bus have won one straight, while Pete has lost three straight.",
    ["sleeper:1/streak", "streak"],
  ],
  [
    6,
    "Bench Mob are 7-1 in first, and Pete is 3-5 in 11th.",
    ["sleeper:3/record", null, "record", null],
  ],
  [
    7,
    "Kim Possible Kicks beat Red Zone Rascals 101.56-95.38, while Bench Mob sit at 7-1 in first.",
    ["w8.result", null, "sleeper:3/record", null],
  ],
  [
    null,
    "Pylon Patrol lost to Gus Bus and sits at 3-5.",
    ["sleeper:6/w8.result", "sleeper:6/record"],
  ],
];

/** Blurbs full of checkable claims, from the grounding-prototype scenarios. */
export const CLAIM_HEAVY = [
  "Seven straight and counting. Bench Mob edged Snap Judgement by 2.71 to sit 7-1, and they lead the league in points at 982.8.",
  "Wendy's Wire put up 112.1 and still lost to Frank's FAAB Fund by 9.27. The 54-34 all-play record says this team is better than 3-5: luck has cost them nearly two wins.",
  "Gus dropped a week-high 133.22 on Pete, winning by 55 to get back to 4-4.",
  "Bo's Mob are 7-1 on a seven-game heater. They squeaked past Snappers by 3 and nobody in this league has scored more. Still frauds.",
  "Pete got smoked by 55 and is now 3-5. Three straight losses.",
  "Kim Possible Kicks beat Red Zone Rascals 101.56-95.38 for a second straight win, while Bench Mob sit at 7-1 in first.",
  "- Seven straight games\n- ranked 1st, #1 overall\n- top 3 in scoring, up 2 spots\n\nThey clinched a bye.",
];
