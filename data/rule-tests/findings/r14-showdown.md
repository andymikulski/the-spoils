## RF-r14-showdown-1: a claimed Hero tactic that can be played may be declined
- Status: RESOLVED — the engine now follows the rule (claimHeroCards: a playable claimed tactic must be played, an unplayable one is removed at once, the rest of a claim survives a tactic); the test is an ordinary rule test.
- Atoms: SD 9
- Test: rules/r14-showdown.p2.test.ts "a claimed tactic that can be played must be played: the claimer cannot decline it"
- Wording: "If it's a tactic, that player plays it for free if they can *(ignoring threshold)*." The card does not say "may"; only a tactic that cannot be played is exempt ("or if they cannot be played" is removed, SD 10).
- Engine does: the claim raises a `deployForFree` prompt (`heroClaim`) and answering it without a card (`{ kind: "deployForFree" }`) is accepted: the tactic is removed from the game unplayed.
- Cause: `resolvePendingChoice` / `deployForFree` branch in `SpoilsEngine.ts` (`if (!choice.cardId)` with `pending.heroClaim`) treats a decline as legal; `claimHeroCards` documents "declined or unplayable: removed from the game". Decision for the lead: if "plays it ... if they can" is meant as compulsory, a decline of a playable tactic should be refused.

## RF-r14-showdown-2: a claimed Hero tactic that cannot be played is not removed by the engine
- Status: RESOLVED — the engine now follows the rule (claimHeroCards: a playable claimed tactic must be played, an unplayable one is removed at once, the rest of a claim survives a tactic); the test is an ordinary rule test.
- Atoms: SD 9, SD 10
- Test: rules/r14-showdown.p2.test.ts "a claimed tactic that cannot be played (its required pick has no character to take) is removed from the game at once"
- Wording: "...plays it for free if they can" and "Hero cards are removed from the game when they leave play, when they are done resolving *(or if they cannot be played)*."
- Engine does: a claimed tactic with no legal play (here a required character pick with no character in play) still raises the `deployForFree` prompt with that tactic as the only candidate. Choosing it throws ("Target 't' requires 1 selection(s)"); the card stays in zone `table`, unowned by any pile, until its claimer answers the prompt by declining, which then removes it.
- Cause: `claimHeroCards` in `SpoilsEngine.ts` builds the `deployForFree` choice directly for every claimed tactic without checking that it can be played (no `deployForFreeCandidates`-style legality check).

## RF-r14-showdown-3: claiming several Hero cards where a tactic comes first loses the cards after it
- Status: RESOLVED — the engine now follows the rule (claimHeroCards: a playable claimed tactic must be played, an unplayable one is removed at once, the rest of a claim survives a tactic); the test is an ordinary rule test.
- Atoms: SD 8, SD 9
- Test: rules/r14-showdown.p2.test.ts "claimed together, a tactic and then a character: the tactic is played and the character still enters play (none of the claim is lost)"
- Wording: "If an effect instructs a player to claim a Hero card, they put that card into play under their control." (SD 8) and "If it's a tactic, that player plays it for free if they can" (SD 9): every claimed card is put into play or played; claiming a tactic does not cancel the rest of a multi-card claim (DARING GAMBIT claims "the entire Temptation Pile").
- Engine does: `claimHeroCards` first removes all claimed cards from the Hero Deck / Temptation Pile, then pauses on the first tactic with the remaining cards queued as `afterDeploy: claimHeroCards from: "selected"`. That queued effect filters its picks to cards still in the Hero Deck or Temptation Pile, which the claim has already left, so it claims nothing. The cards after the tactic (here a character and an item) end up with the claimer as owner/controller but in zone `table`, in no pile, and can never be put into play or claimed again. (A character claimed before the tactic is unaffected.)
- Cause: the `from: "selected"` branch of the `claimHeroCards` effect (the `showdown.heroDeck.includes(id) || showdown.temptationPile.includes(id)` filter) versus `claimHeroCards()` having already removed the cards from both piles.
