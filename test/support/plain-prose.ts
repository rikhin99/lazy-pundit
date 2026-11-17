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
  "Bottom half for the second year in a row.",
  "The second time in a row the bench outscored the starters.",
  "Nobody saw that kind of loss in a row coming.",
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
  // "them" or "their" straight after a result (#104)
  "Gus Bus beat Pete, handing them plenty to think about.",
  "Pete lost to Gus Bus, and their kicker took the blame.",
  // an ordinal whose clause has no cue, beside one that has (#124)
  "The second time this season they lost on a Monday, and the standings shrugged.",
  // a cue in the ordinal's clause but over 30 characters from it (#124)
  "They scored nothing for a quarter of the season before the second half woke up.",
  // a result verb's "-ing" form with no team after it (#125)
  "Handling the bye weeks was the real test, and nobody enjoys losing to a kicker.",
  "After beating the odds all year, Bench Mob are taking down the decorations.",
  // a house rule's words with no count before them, in a league with no rules (#126)
  "Another weekly high score would be nice, and a weekly low would sting.",
  // a number before a house rule's words that isn't a count (#126)
  "Their week 3 high score still stands, and their first low score came early.",
  // a count before a trigger's wording, in a league with no rule to read it (#129)
  "That's 2 weekly high scores this season.",
  "That's 2 high scores this season.",
  "They have 3 low scores this year.",
  // a bare "and" after the "them" clause of a result, with no claim (#128)
  "Bench Mob beat Sam, leaving them stunned and out of answers.",
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
  // a count before a trigger's wording takes no cue; a points value or "scores" as a verb still does
  [3, "Their 162.9 high score still stands.", ["high"]],
  [3, "Bench Mob scores 126.89 this week.", ["w8.points"]],
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
    "Pete lost to Gus Bus by 55, the third loss in a row, and sits at 3-5.",
    ["w8.result", "w8.margin", "streak", "record"],
  ],
  [
    7,
    "Kim Possible Kicks beat Red Zone Rascals for a 2nd win in a row.",
    ["w8.result", "streak"],
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
  [
    1,
    "Gus Bus beat Pete by 55, handing them a third loss in a row.",
    ["w8.result", "w8.margin", "sleeper:6/streak"],
  ],
  [
    1,
    "Pete lost to Gus Bus by 55, leaving them at 3-5.",
    ["sleeper:6/w8.result", "sleeper:6/w8.margin", "sleeper:6/record"],
  ],
  [
    1,
    "We beat Pete by 55, dropping their record to 3-5.",
    ["w8.result", "w8.margin", "sleeper:6/record"],
  ],
  [
    1,
    "Gus Bus beat Pete by 55, and that leaves them at 3-5.",
    ["w8.result", "w8.margin", "sleeper:6/record"],
  ],
  [
    1,
    "Gus Bus beat Pete by 55, and they sit at 4-4.",
    ["w8.result", "w8.margin", "record"],
  ],
  [
    1,
    "Gus Bus beat Pete by 55, a big day, and that leaves them at 4-4.",
    ["w8.result", "w8.margin", "record"],
  ],
  [
    1,
    "Gus Bus beat Pete by 55, handing them a loss, and sits at 4-4.",
    ["w8.result", "w8.margin", "record"],
  ],
  // two ordinals in one sentence, each reading the cue in its own clause (#124)
  [2, "3rd in points and 8th in the standings.", ["pf_rank", "standing"]],
  [
    2,
    "Wendy's Wire are 3rd in all-play, and 8th in the standings.",
    ["allplay_rank", "standing"],
  ],
  [
    2,
    "Wendy's Wire sit 8th in the standings (3rd in points) and lost to Frank's FAAB Fund.",
    ["standing", "pf_rank", "w8.result"],
  ],
  // a participle result names its opponent as an object, not a subject (#125)
  [
    3,
    "Bench Mob are 7-1 and first in the standings after beating Sam by 2.71.",
    ["record", "standing", "w8.result", "w8.margin"],
  ],
  [
    12,
    "Snap Judgement are 4-4 and fifth in the standings after losing to Bench Mob by 2.71.",
    ["record", "standing", "w8.result", "w8.margin"],
  ],
  [
    3,
    "They sit in the standings after edging Sam by 2.71.",
    ["w8.result", "w8.margin"],
  ],
  [
    12,
    "They sit in the standings after dropping one to Bench Mob by 2.71.",
    ["w8.result", "w8.margin"],
  ],
  [
    3,
    "Bench Mob are 7-1 after beating Sam by 2.71 and sit first in the standings.",
    ["record", "w8.result", "w8.margin", "standing"],
  ],
  [
    12,
    "Snap Judgement are 4-4 after losing to Bench Mob (7-1) and sit fifth in the standings.",
    ["record", "w8.result", "sleeper:3/record", "standing"],
  ],
  [
    3,
    "After beating Sam by 2.71, Bench Mob sit first in the standings.",
    ["w8.result", "w8.margin", "standing"],
  ],
  // a cue is never reused across numbers, and a week's number isn't one (#126)
  [
    5,
    "They scored 110.08 this week and 891.03 on the season.",
    ["w8.points", "pf"],
  ],
  [5, "They scored in week 8: 110.08.", ["w8.points"]],
  [5, "Lost by 19.95, scoring 891.03 on the season.", ["w8.margin", "pf"]],
  [
    5,
    "Bench Mob posted a season-high 162.9 back in week 2.",
    ["sleeper:3/high"],
  ],
  // a bare "and" after the "them" clause carries on the team that lost; ", and" carries on the subject (#128)
  [
    3,
    "Bench Mob beat Sam, leaving them 4-4 and fifth in the standings.",
    ["w8.result", "sleeper:12/record", "sleeper:12/standing"],
  ],
  [
    1,
    "Gus Bus beat Pete by 55, leaving them 3-5 and 11th in the standings.",
    ["w8.result", "w8.margin", "sleeper:6/record", "sleeper:6/standing"],
  ],
  [
    3,
    "Bench Mob are 7-1 after beating Sam, leaving them 4-4 and fifth in the standings.",
    ["record", "w8.result", "sleeper:12/record", "sleeper:12/standing"],
  ],
  [
    3,
    "Bench Mob beat Sam, leaving them 4-4, and sit first in the standings.",
    ["w8.result", "sleeper:12/record", "standing"],
  ],
  [
    3,
    "Bench Mob beat Sam, leaving them 4-4 and fifth in the standings (Bench Mob are 7-1).",
    ["w8.result", "sleeper:12/record", "sleeper:12/standing", "record"],
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
