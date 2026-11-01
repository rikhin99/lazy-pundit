# Season-scoped teams, manager handles and a platform per season

A league workspace spans seasons, and leagues change platform (Fear The Turtle moved from Yahoo to Sleeper), add and lose managers, and pair managers up on one team. Platform IDs don't survive any of that: Sleeper creates a new league and new roster IDs every season, ESPN team IDs shift as teams join and leave, and the same person has a different user ID on each platform. So each season records its own platform and league ID, a team is identified only within its season (`sleeper:3`), and anything that spans seasons keys on a **manager handle**: the workspace's own name for a person, linked to each platform account they have played under, with every link confirmed by the pundit rather than guessed.

## Considered options

- **Stable cross-season team IDs**: rejected. No platform guarantees them, and nothing in Stage 1 needs one (rankings, movement and stakes are all per season).
- **Keying lore and rivalries on raw platform user IDs**: rejected. This was the original choice in the lore and stakes decisions, and it breaks the first time a league changes platform.
- **Auto-linking accounts by display name**: rejected. Setup proposes matches by name, but the pundit has to confirm each one, because a wrong link would quietly attach lore about one person to another.

## Consequences

- A team can have several managers, and a manager can have no team in a given season (they left, or took a year off) while keeping their lore.
- In a mid-season takeover the team keeps its ID, and its managers are whoever the latest snapshot names. Stage 1 keeps no record of who managed the team when. A change in managers is flagged once in the editing view, so the pundit can link the new account to a handle.
- Past seasons, including ones on another platform, can be recorded, but Stage 1 computes no cross-season stats from them. A past season can be imported only on a platform that has an adapter.
