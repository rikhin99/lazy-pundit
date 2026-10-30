# Lazy Pundit

A local tool that turns fantasy league data into power rankings and recaps. The stats are computed deterministically, the prose is written by an LLM, and a human decides the order.

## People and voice

**Pundit**:
The human who authors a league's rankings and owns every placement in them.
_Avoid_: Writer, ranker, user

**Persona**:
The voice the prose is written in. It belongs to the pundit's output, not to the pundit.

## Rankings

**Ranking**:
The pundit's ordered list of a league's teams for one week. It's the authoritative output.
_Avoid_: Power score, standings

**Power score**:
The tool's per-team number for a week, used only to produce the starting order.
_Avoid_: Rating, ranking

**Starting order**:
The order the tool proposes from the power score. The pundit edits it into the ranking.
_Avoid_: Suggested ranking, default ranking, recommendation

**Standings**:
The platform's own order, by record with its tiebreaks. A stat the pundit sees, not a ranking.

**Small-sample flag**:
A warning that the season is too young for the power score to mean much. It appears only in the editing view.

## Stats

**All-play record**:
A team's record if it had played every other team every week.

**Luck**:
Actual wins minus the wins expected from the all-play record.

**Form**:
A team's average points over its most recent weeks.

**Lineup efficiency**:
Points scored divided by the points of the best possible lineup from the same roster.
_Avoid_: Coaching efficiency, max points

## Surfaces

**Editing view**:
What the pundit sees while ranking: the starting order, the stats behind it, and any flags.

**Published ranking**:
What the league sees, and anything copied, pasted or screenshotted from it. It carries no tool-internal flags or scores unless the pundit puts them there.
_Avoid_: Post
