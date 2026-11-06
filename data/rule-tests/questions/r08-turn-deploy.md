## RQ-r08-turn-deploy-2. Does every player get the opening mulligan, or only factions whose card lists one?
- Atoms: CR 601.1f ("The first player may mulligan ... This can be done only once."), CR 601.1g
- Readings: (A) the mulligan is a core rule for every player in every game, regardless of faction. (B) It is part of the faction's setup entries (like Starting Draw), so a faction that lists none has no mulligan.
- Engine does: the mulligan step exists only for a player whose faction has `setup.mulligan.count > 0` (`mode: "replaceAny"`); with no such entry the game goes straight to turn 1 with no mulligan offered. The Tournament Faction, the default, lists one.
- Recommendation: (A) per the CR wording, which gives the mulligan to every player without referring to the faction card; the faction data would then only be able to change the amount.
