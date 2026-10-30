# Lazy Pundit

A local tool that turns fantasy league data into power rankings and recaps. The stats are computed deterministically, the prose is written by an LLM, and a human decides the order.

## People and voice

**League workspace**:
Everything the tool knows about one league: its platform data, lore, persona, rules and stakes, and every pundit's rankings. A league can have several pundits.

**Pundit**:
The human who authors a league's rankings and owns every placement in them. Each pundit in a league keeps their own rankings and settings, and one person can be the pundit in several leagues.
_Avoid_: Writer, ranker, user

**Persona**:
The voice the prose is written in. It belongs to the pundit's output, not to the pundit.

## Rankings

**Ranking**:
The pundit's ordered list of a league's teams for one week. It's the authoritative output. It always places every team, a team's place is its position in the list, and each team carries a blurb.
_Avoid_: Power score, standings

**Week**:
The platform's matchup period. In daily-lineup sports, one week is one matchup built from many days of lineups.

**Draft**:
The pundit's working copy of a week's ranking. It can be edited freely, before and after publishing, and the league never sees it.

**Blurb**:
The short prose about one team that goes with its place in the ranking. The LLM drafts it and the pundit can rewrite it.

**Group**:
An optional label over a run of consecutive places in a ranking, such as a tier or a playoff split into championship and consolation groups. Places are numbered straight through the groups.
_Avoid_: Bracket, division

**Power score**:
The tool's per-team number for a week, used only to produce the starting order.
_Avoid_: Rating, ranking

**Power-score method**:
The pundit's choice of how the power score is computed, including its weights. It is a per-pundit setting, and each starting order records the method that produced it.

**Starting order**:
The order the tool proposes from the power score. The pundit edits it into the ranking. It is fixed when a draft begins and changes only when the pundit refreshes.
_Avoid_: Suggested ranking, default ranking, recommendation

**Refresh**:
The pundit's explicit act of recomputing a draft's starting order from newer data or a changed method. It never changes the pundit's order or blurbs.

**Standings**:
The platform's own order, by record with its tiebreaks. A stat the pundit sees, not a ranking.

**Publish**:
The pundit's explicit act of declaring a week's ranking final. Only a published ranking counts as the previous ranking for movement. Changes made to the draft afterwards reach the league only when the pundit publishes again.
_Avoid_: Export, save

**Movement**:
A team's change in place since the pundit's most recent published ranking in the same season. A team with no earlier published place is new, never given an invented movement.

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
What the league sees, and anything copied, pasted or screenshotted from it. It is fixed at publish time. It carries no tool-internal flags or scores unless the pundit puts them there.
_Avoid_: Post
