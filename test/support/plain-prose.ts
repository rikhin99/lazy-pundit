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
