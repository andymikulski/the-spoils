# Rulings ledger

Every rules question put to the user during the card-clause work (rounds 1 and 2, Q1–Q53) and the answer given. The answers are settled: they were applied to the engine and the clause tests (2026-10-20/21), and each affected finding in `data/card-tests/findings/` carries a "Rules answer" line. The rule tests (RULES-TESTS.md) treat these as part of the spec. The original question files (with their per-finding lists) are in git history.

The ruling is the reading the user chose: for "literal" answers, the reading the tests asserted; for "engine", what the engine did; for "rules", the rules reading; for "other", the user's own words.

## Q1. Do several "reduce the next numeric cost you pay" effects stack on the same next cost?

- **Ruling (literal):** All pending reductions apply to the one next cost (a cost-5 card with two -2 reductions costs 1).
- **Rules text:** CR 406.3 (RULES.md 479-484): "apply all cost increases ... then all cost reductions". CR 410.3 (as cited in the findings): all reductions apply to a number. Neither says how a pending "next" effect is consumed.

## Q2. If a "may search" is declined, is the deck still shuffled?

- **Ruling (literal):** No. Declining means no search happened, and CR 312.1 shuffles a deck that IS searched. Searching and failing to find still shuffles.
- **Rules text:** CR 312.1 (RULES.md 69): "Searched decks are shuffled afterward." CR 312.2 (RULES.md 1172): "You may always choose to fail a search that has specific criteria."

## Q3. When a search puts the found card on TOP of the deck, is the deck shuffled before placing it, after, or not at all?

- **Ruling (literal):** Shuffle first, then place the card on top, so "on top" stays true and CR 312.1 is honoured.
- **Rules text:** CR 312.1 (searched decks are shuffled afterward); CR 101.1 (card text wins over rules, as cited).

## Q4. Is "Remove from the game" the same area as the Void?

- **Ruling (literal):** No. The printed words mean the Out of Game area (`removed`), which Void-touching cards (Voidal Tactician, READY THE RITE) must not reach.
- **Rules text:** CR 403.6 (out of game) and 403.7 (void) are separate areas, per the findings. The catalog audit says "current terminology: void instead of remove from the game".

## Q5. Can an effect leave a number below 0 (negative influence, speed, strength, X)?

- **Ruling (literal):** No. A number an effect would push below 0 stays at 0: Armored Keep leaves the faction at exactly 0 influence; -1 speed on a 0-speed character is 0; a negative X loses nothing.
- **Rules text:** CR 410.4 / 406.6 (RULES.md 485, 1165): "Any number an effect would push below 0 stays at 0."

## Q6. Is a character with 0 life (or a location with 0 structure) destroyed at once?

- **Ruling (literal):** Yes. Destroyed when damage >= life (structure), so 0 >= 0 is lethal immediately (Thief Doyen with X = 0, Hate of Man at 0 life, an empty Forbidden Bibliotheca).
- **Rules text:** RULES.md 3.1 / 3.3, CR 204.5, 207.5, 408.4: destroyed once damage >= life (structure).

## Q7. When is "destroyed because structure fell to its damage" checked after a cost: right away or only after the ability resolves?

- **Ruling (literal):** Immediately: paying CHECK OUT lowers structure to the damage, the Bibliotheca is destroyed then, and the ability still resolves.
- **Rules text:** CR 207.5 "immediately"; CR 502.4 (the ability still resolves); RULES.md 11 "after every effect or resolution".

## Q8. Is "X is its strength / life" printed in the COST fixed when the cost is paid, or read when the effect resolves?

- **Ruling (literal):** Fixed when the cost is paid; a response that changes the picked character does not change X.
- **Rules text:** The X sits in the printed COST section, like "choose a number for X" (CR 410.2 as cited). No rule says when a cost-defined X is read.

## Q9. What does "numeric cost" mean for a card being played or modified: the printed number, or the running total?

- **Ruling (other):** The engine rules seem to clear this up: 406.1/2 say it's printed number outside of play, else 406.3 says while being played it's the running total. Let's adhere to the rules here.
- **Rules text:** CR 406.1/406.2: outside of being played it is the printed number. CR 406.3: while being played it is the running total (RULES.md 476-484).

## Q10. For a card owned by one player and controlled by the other, does "your discard pile" mean the controller's or the owner's?

- **Ruling (literal):** "You/your" is the current controller (CR 407.2) and a destroyed card goes to its OWNER's pile (CR 403.5). So a stolen card going to the owner's pile is not "put into your discard pile": no trigger or replacement for the controller. (Flailing Knife is asserted the other way round: the owner is asked; Madster: it goes to the owner's discard pile.)
- **Rules text:** CR 407.2 (as cited): "you" and "your" in rules text refer to the card's current controller. CR 403.5 / 407.8: a card goes to its owner's discard pile.

## Q11. Does "You may play / deploy the card" (without "for free") waive its numeric cost?

- **Ruling (literal):** No. Only "for free" waives the cost; the cost and threshold are paid. "May" lets you decline.
- **Rules text:** CR 308.1 (RULES.md 488): "Playing something for free sets its cost number to 0 ... but does not waive its threshold or its extra costs."

## Q12. May a card be played with no option / mode / number chosen?

- **Ruling (other):** No, an option must be chosen when a card presents them (unless otherwise noted as optional options). However, X can be chosen to be 0, if the user so chooses.
- **Rules text:** CR 401.3 (choose X is a cost); CR 604.1e (illegal play); RULES.md section 12: X "defaults to 0" only for a card played for free.

## Q13. Subordinate Demotivation (no printed pick): can it be played with no candidate, and must the player name a single candidate?

- **Ruling (literal):** The card prints no pick, so it is always playable; with one lowest-cost character it resolves with no input, and with no opposing character it resolves and does nothing.
- **Rules text:** CR 402.5 (as cited): an instruction you cannot carry out is ignored.

## Q14. If a FLIP UP cost includes "and play a resource" and the hand is empty, is the flip legal?

- **Ruling (literal):** No. "Play a resource" is a Flip Up extra cost (CR 507.4c); with no card in hand it cannot be paid and the flip is refused.
- **Rules text:** CR 507.4c (Flip Up extra costs); CR 401.2, 604.1e; CR 402.5 for the alternative.

## Q15. Is a pick validated before costs are paid, or after the earlier costs in written order?

- **Ruling (literal):** After the earlier costs: "Deplete this card" makes Triggerman a legal depleted pick; Death Investor, removed as a cost, can no longer be picked; the resource played for Foment's FLIP UP cost can be picked.
- **Rules text:** CR 507.4c (Flip Up extra costs are satisfied directly before regular extra costs); printed cost order.

## Q16. When card text says "destroy a [card] you control" without "pick", does the controller choose or is it random?

- **Ruling (literal):** The controller chooses (a pending choice).
- **Rules text:** None found; RULES.md does not say unspecified selection is random.

## Q17. When the text makes the OPPONENT act (Ecto-Distillation search, Truculence reorder), who makes the decision?

- **Ruling (literal):** Ecto-Distillation: the opponent does the searching and chooses which copy goes to the hand. Truculence: the caster looks at and reorders their own top 3.
- **Rules text:** None found. Imperatives address "you", the controller (CR 407.2 as cited).

## Q18. When an effect plays an actual resource card ("play a resource"), may it be played face-down?

- **Ruling (literal):** Yes. Any card, a real resource included, may be played face-down as Volition; the player chooses.
- **Rules text:** CR 203.2 / 605.1b (as cited in the findings); RULES.md section 4.

## Q19. May an optional ("up to") pick be left empty: Ferrous Ferret and Executive Order?

- **Ruling (literal):** Ferret: if the Ferret is a legal pick it must be picked. Executive Order: paying 2 elects the action, so the pick is part of it and cannot be empty.
- **Rules text:** None found.

## Q20. When a card says "Pick 2 ...", may the same card be picked for both?

- **Ruling (literal):** No. Two picks means two different cards.
- **Rules text:** None found.

## Q21. Which instructions are skipped when an earlier step could not happen (empty deck, nothing revealed, dependent X)?

- **Ruling (literal):** Dependent instructions are skipped (CR 402.5b): Obsessive Concentration puts nothing back if nothing was drawn; Gambling Den with an empty deck asks nobody; Sharpey UNFOLD with nothing revealed does nothing; Unnatural Alteration searches only if THIS effect destroyed the character; Swashbuckler cannot remove 4 cards from a pile of fewer than 4, so it is destroyed.
- **Rules text:** CR 402.5b (as cited): an instruction that depends on one you skipped is skipped; RULES.md section 12.

## Q22. How far does a "may" reach: is a following sentence without "if you do" still done when the player declines?

- **Ruling (literal):** A sentence with no "if you do" is done regardless: Dauntless Gambler and Flailing Knife still bottom the top card; Golemizer still destroys a 0-speed host when the token is declined. Conversely I Drink Your Milkshake: the "may play it ... and terminate" is covered by the may, so declining leaves their card alone. Community Chest: "you may reveal it" can be declined.
- **Rules text:** None found beyond the printed text.

## Q23. Can a "remove all tokens" cost be paid with no tokens (Escrow Office)?

- **Ruling (literal):** No. A "lose/remove X" extra cost cannot be satisfied unless the card has that thing.
- **Rules text:** CR 401.3b (RULES.md 1030): a "lose X" extra cost can't be paid unless the card has X.

## Q24. Is influence lost as a COST reduced by Tax Attorney or increased by Gideon?

- **Ruling (literal):** Yes. "Loses influence" has no exception for costs. Tax Attorney is a reduction, not a replacement, and Gideon's extra loss applies to a paid cost.
- **Rules text:** CR 506.2 (RULES.md 1045): replacements do not apply to things happening as an extra cost is paid. CR 402.1b (as cited): a cost generates effects like any other text.

## Q25. Do the Micromajig tokens made by Micromajig Shipping Container and the Open Beta cards have the "majig" subtype?

- **Ruling (literal):** Yes. A Micromajig token is a Gearsmith character with 1/1/3 and the majig subtype (the real Holy Heist and Ungodly Mess tokens and the 2nd Edition printings already are).
- **Rules text:** RULES.md 13 / CR 409.3c.1: "Micromajig Tokens are considered Gearsmith character cards with 1 strength, 1 life, 3 speed, and the 'majig' subtype".

## Q26. Smear Campaign: does damage the host deals to its own controller's faction trigger it?

- **Ruling (literal):** Yes. "Any amount of damage" has no exception, and the Campaign's own damage is not the host's so it cannot loop.
- **Rules text:** None found beyond the printed text.

## Q27. Mafia Lawyer: what is X when the Lawyer is not in the battle, or when the opposing party dies in the same damage step?

- **Ruling (literal):** Not in the battle: no opposing party, X = 0. Same-step death: X is the opposing party's strength when the Lawyer was destroyed (4), so its controller gains 4.
- **Rules text:** CR 503.1 (a trigger uses its text as of that instant, as cited); CR 302.15 (removal from the battle).

## Q28. Can a character that entered play (or became a character) this turn attack: Counter Attack and Contrabulous Fabtraption?

- **Ruling (literal):** Counter Attack: no, it must have started the turn under your control. Fabtraption: an item you controlled since before the turn that becomes a character this turn did start the turn in play, so it can attack.
- **Rules text:** CR 204.3 / 608.1b (RULES.md 6): attackers must have started the turn in play under your control. RULES.md 3.7: the CR is silent for a card that gains the character type mid-turn.

## Q29. Replacement effects: how far does each one reach (Two-Headed Coin, Golemizer, Stone of Shame, Arcane Escrow)?

- **Ruling (literal):** Coin: each Coin applies to each lost flip, so a lost reflip may use the second Coin. Golemizer: destroyed along with its host, it may flip itself face-down. Stone of Shame: any character put into a hand from anywhere (discard, deck) is destroyed instead. Escrow: a destroyed permanent is not "discarding a card", so no prompt.
- **Rules text:** CR 506.5 (each replacement applies once, even if identical); CR 301.4 (host destruction); CR 304.1 vs 305.1 (destroy vs discard); CR 306.1 (drawing puts the top card into hand).

## Q30. Does flipping a card up count as "playing / deploying" for restrictions, taxes and triggers?

- **Ruling (literal):** Yes. FLIP UP plays the card as though from hand: Geldale blocks a flipped-up tactic on your turn, Foreclosure Overseer taxes a FLIP UP deploy, Milkshake counts a flipped-up card as played.
- **Rules text:** CR 507.4a (as cited): Flip Up lets you "play the card as though it were in your hand". Follows from R1.

## Q31. "A character" versus "another character": does the card trigger its own "a character" rule (Merbegon, Warmonger)?

- **Ruling (literal):** Yes. The text says "a character", not "another".
- **Rules text:** None found.

## Q32. "Next turn" effects: whose turn, and do duplicates stack (Drill Instructor, Monstrous Lassitude)?

- **Ruling (literal):** Drill Instructor: "the next turn" is the next turn to start (the opponent's, if deployed on my turn). Lassitude: both copies name the same turn, so it is skipped once.
- **Rules text:** None found; sibling cards print "your next turn" when they mean the controller's.

## Q33. What counts as "an ability" for Tamper and Notion Sickness?

- **Ruling (other):** I think both are activated only -- An ability is a named entry with cost/effect, triggers don't count. Both of these cards should treat this the same way, i.e. following the rules text
- **Rules text:** CR 502.1 / 201.5c, 503, 504 (as cited in the findings). Note the two literal readings are not symmetrical.

## Q34. Single-card ruling: The Poshernacle: may the opponent respond to an ability used through it?

- **Ruling (literal):** Yes. Using an ability has a Responses step after costs; only the trigger itself cannot be responded to.
- **Rules text:** CR 606.1f, 503.2 (as cited).

## Q35. Single-card ruling: Woadenworm Gloamspike: does a tactic that already has a FLIP UP gain the granted one too?

- **Ruling (literal):** Yes. "Gain" is additive, so the tactic may be flipped by either cost.
- **Rules text:** None found.

## Q36. Single-card ruling: Opportune Slotpuller: does "Choose a card type" include Faction?

- **Ruling (literal):** Yes. All six types are legal; Faction never matches a deck card.
- **Rules text:** CR 201.4e (as cited).

## Q37. Single-card ruling: Colossal Flattener: can its damage be split between the blocker and the attacked target?

- **Ruling (literal):** No. All of its battle damage goes to the blocking party or all to the target.
- **Rules text:** None found.

## Q38. Single-card ruling: Community Chest: is the [D] check for the extra draw made once or every turn?

- **Ruling (engine):** The draw trigger re-checks [D] every turn (RULES.md section 5, deliberate).
- **Rules text:** RULES.md section 5 documents the engine choice.

## Q39. Single-card ruling: Intriguing Mezzanine: does the restore lock end once the character has been explicitly restored?

- **Ruling (literal):** Only characters depleted BY this card are blocked; after an explicit restore, a later unrelated deplete lets the RESTORE RULE restore it.
- **Rules text:** None found.

## Q40. Single-card ruling: Ocular Dispersal: after the host is flipped face-down, does it still assign damage equal to its cost?

- **Ruling (literal):** No. A face-down card has no rules text, so the host assigns its strength again.
- **Rules text:** None found.

## Q41. Single-card ruling: The Billionaire: is a "discard a card" extra cost paid from the opponent's hand?

- **Ruling (engine):** The engine accepts the opponent-hand discard, which is the card working as intended.
- **Rules text:** CR 401.2a (as cited).

## Q42. Single-card ruling: Gideon's Legacy HIDE: who is "each other player"?

- **Ruling (other):** The question who is "other player" when HIDE is invoked. I read it as: Player A activates HIDE, and selects Player B. This means that all other players (Player A, Player C, ...) would be the ones to gain the X influence.
- **Rules text:** None found.

## Q43. Single-card ruling: God's Blessing of Foresight: who controls it when attached to an opponent's character?

- **Ruling (other):** The item is still 'owned' or 'controlled' by the casting player. However, the card says 'the attached character gains the following rules text...' which means that the character controller would then be able to trigger the new ability, NOT the original caster simply for being the original caster.
- **Rules text:** CR 204.2a (as cited): cards enter play under the control of the card or effect's controller.

## Q44. Single-card ruling: Silent Sentinels: can a player end the turn without attacking while a character could attack?

- **Ruling (literal):** No. A turn cannot end while an eligible character has not attacked.
- **Rules text:** None found.

## Q45. Single-card ruling: Defenders of Marduun: STARTING RESOURCES with only one staple kind in the deck.

- **Ruling (other):** The engine can fall back to using two of the same, but this shouldn't happen at all; the deck should not be considered playable if the faction requires satisfying (i.e. two different staples). This is something that can be surfaced in the game and deck builder UIs. as a safety the engine can fall back to the two same resources, but this not ideal, as in theory a player could enter a game playing their faction card in an illegal manner.
- **Rules text:** None found.

## Q46. Single-card ruling: Padamose: a character that is both a "mau" and an Arcanist.

- **Ruling (literal):** One character, one group: it loses 1/1 once.
- **Rules text:** None found.

## Q47. Single-card ruling: Zenobia's Intervention: does a face-down staple count as a staple kind?

- **Ruling (literal):** No. A face-down card is only a Volition resource.
- **Rules text:** CR 411.1 / 203.4a (as cited).

## Q48. Old-printing Micromajig tokens: do they have the "majig" subtype when their printed reminder text doesn't say so?

- **Ruling (rules):** Yes. RULES.md §13 (CR 409.3c) defines a Micromajig token as a 1/1/3 Gearsmith **majig** character.

## Q49. Single-card ruling: Obsessive Concentration: does a SHORT draw count as "If you do"?

- **Ruling (other):** NO, THE DRAW MUST BE 3 CARDS TO COUNT FOR THE TRIGGER TO FIRE
- **Applied (lead, 2026-10-21):** Obsessive Concentration's bottoming step now needs the hand to grow by 3 (`count(hand) >= handBefore + 3`); new clause test "a SHORT draw (deck of 2) is not 'you do'" in `holy-heist-01.test.ts`.

## Q50. Single-card ruling: Skin Suit (1st Edition Part 2): is "If only 1 of the characters is destroyed by this damage" judged after BOTH hits?

- **Ruling (other):** Literal - damage is inflicted simultaneously; X is applied, Y is applied, then we check if only 1 died before triggering the rest.

## Q51. Single-card ruling: The Open R&D Faction: one ability, or one per player?

- **Ruling (other):** One ability in total; both players work together to make the ability, but only one is produced. I'm concerned over the feasibility of this; it may require significant UI additions to the game itself. Let's be smart about this; we want this to stay structured and work with our engine; we do NOT want free-form text entry, for instance.

## Q52. Single-card ruling: Gambling Den with an EMPTY deck: nothing, or the "Otherwise" branch?

- **Ruling (other):** If no card is availble, then the ability can not continue and get to the numeric cost check/draw card.

## Q53. Single-card ruling: Goutflame Talonclaw: which comes first, its enters-play pick or the UNIQUE "choose one to keep"?

- **Ruling (other):** Literal - the UNIQUE should be enforced immediately and the remaining 'enters play' trigger should continue. (There could be a case where two UNIQUEs are played, but the second one is the one that's destroyed - at which point it never entered play.)

## RQ-r08-turn-deploy-1. Who determines, at random, which player decides who goes first: the engine or the host application?

- **Ruling (other, 2026-10-28):** "We should have a little moment when the game starts, maybe a coin flip, and move from there." Applied as reading (A): the engine runs the step. With the setup option `chooseFirstPlayer`, once the starting resources are in play the seeded RNG picks the deciding player and setup waits for their `chooseFirstPlayer` answer (RULES.md §5). A host that already knows the first player still passes `firstPlayerId`.
- **Rules text:** CR 601.1c: "Randomly determine which player will decide who takes the first turn of the game. That player chooses who goes first."

## RQ-r11-2. Are the influence losses of one resolving card or ability simultaneous for CR 102.2?

- **Ruling (other, 2026-11-07):** "if a tactic hits one player and it causes them to lose, then they lose. if the tactic hits both players and they both die, then that's a draw. in battles, if both players take damage, they can both die at the same time."
- **Follow-up ruling (other, 2026-11-07), on a trigger set off during a resolution:** "technically the p2 0 would resolve first so it'd end the game; i.e. player loses faction -> effect/trigger resolves -> check the 0 threshold -> if > 0, continue"
- **Applied:** the unit of "at the same time" is one resolving card or ability's own effects, one triggered ability's own effects, or one batch of simultaneous battle damage. A triggered ability set off while a unit resolves is its own, later unit, even though the engine runs it in the middle of the resolution that set it off. The game is decided by the first unit in which any faction reached 0, once that unit has ended: every player who reached 0 within that unit loses together (all of them: a draw; one: the other player wins), and losses in any other unit do not count because the game was already over. So a tactic that takes P2 to 0 plus a trigger that takes P1 to 0 is a win for P1; effect 1 taking P2 to 0, a trigger running, then effect 2 taking P1 to 0 is a draw; a trigger that takes P1 to 0 when nobody had reached 0 before loses for P1. This holds however the ability is written (two influence effects, `forEachPlayer`, `forEach` over the factions) and whichever faction fell first. Costs are not part of a resolution: a cost that takes a faction to 0 loses at once (RULES.md §1).
- **Rules text:** CR 102.1: "If at any time a faction's influence score is 0, the owner of that faction immediately loses the game." CR 102.2: "If all players still in the game lose the game at the same time, the game is a draw between those players."

## RQ-r11-4. If a faction reaches 0 influence during a unit and is raised above 0 again before it ends, does it lose?

- **Ruling (other, 2026-11-07):** "yeah if the player hits zero and the response window is empty then we should kill em. if a player hits 0 faction they basically shouldn't be able to respond or anything; that'd be like, a player is dead but then they get a chance to keep living which isn't the point here."
- **Applied:** reaching 0 at any point inside a unit means that player loses when the unit ends, even if a later effect of the same unit, or a triggered ability that unit sets off, raises their influence again (CR 102.1 "at any time"). A later unit cannot undo it: the game is already over (see RQ-r11-2).
- **Rules text:** CR 102.1: "If at any time a faction's influence score is 0, the owner of that faction immediately loses the game."

## Multiplayer (free-for-all) rulings, 2026-11-07

The Comprehensive Rules, the FAQ and the Multi-Player Guidelines (MP 1–5) leave several free-for-all points open. The user ruled on them on 2026-11-07, answering the questions as written in `docs/MULTIPLAYER-PLAN.md` (Phase 1), each with a recommendation. "Spec" names the atom of `data/rule-tests/source/multiplayer.txt` that states the reading for tests; the engine does not implement these yet.

## RQ-mp-1. With N players, who may respond to the top item of the response stack, in what order, and when does it resolve?

- **Question as put:** CR 607.2b avoids a priority system because there are only two players. With N players, who may respond to the top item, in what order, and when does it resolve? Recommendation: offer it clockwise starting left of its controller; it resolves only after every non-controller has passed in a row on that item. After it resolves, the player who made it may respond again first (607.2), then the rest clockwise.
- **Ruling (other, 2026-11-07):** "sure" (accepts the recommendation).
- **Spec:** MPX-priority (with MPX-respond): the item is offered clockwise starting with the seat after its controller; it resolves only after every other player has passed on it in a row; after it resolves, the player who made it may respond again first, then the rest clockwise.
- **Rules text:** CR 607.1: "You cannot respond to your own actions." CR 607.2: "Once this response resolves, you may make another response." CR 607.2b: "Because you cannot respond to your own actions, there is no need for a 'priority passing' system".

## RQ-mp-2. Can players other than the attacker and defender act in battle, and can every other player respond when a turn ends?

- **Question as put:** In 608.1c and 609.1a ("then your opponent / the defending player may do the same") and 610.1 ("their opponent has had a chance to respond"), can players other than the attacker and defender act? Recommendation: in battle, the attacker, then the defender, then the other players clockwise; at end of turn, every other player clockwise.
- **Ruling (other, 2026-11-07):** "yes".
- **Spec:** MPX-battle-window (attacker, then defender, then the other players clockwise; where that clockwise order starts with two or more other players is the open RQ-mp-8) and MPX-endturn (every other player may respond, clockwise).
- **Rules text:** CR 608.1c, 609.1a, 609.1e: "The attacking player may deploy tactics and use abilities as many times as they want. Then, the defending player may do the same." CR 610.1: "the turn doesn't actually end until their opponent has had a chance to respond."

## RQ-mp-3. What happens to a player who loses?

- **Question as put:** What happens to a player who loses? Recommendation: every card they own leaves the game; every card they control but don't own goes back to its owner's control; their unresolved stack items and pending choices are removed; their lasting effects end; if it was their turn, the turn ends at once, without end-of-turn responses or triggers.
- **Ruling (other, 2026-11-07):** "yes".
- **Spec:** MPX-elim (and MPX-elim-timing for when it happens).
- **Rules text:** CR 102.1: "the owner of that faction immediately loses the game." CR 102.2 and 306.4 speak of "players still in the game", but no rule says what a loss does to a game that goes on.

## RQ-mp-4. Which opening draw do seats after the first use?

- **Question as put:** Factions print "N going first, M going second". Recommendation: every seat after the first uses the "going second" number.
- **Ruling (other, 2026-11-07):** "yes".
- **Spec:** MPX-draw.
- **Rules text:** CR 601.1e: "The number of cards drawn is usually different if you are going first as opposed to second."

## RQ-mp-5. When is the opponent chosen for lasting "your opponent" text, and what if that player is eliminated?

- **Question as put:** Continuous or static text (Underdog, Mud Prison, Silencer, Escort Ally, Foreclosure Overseer, and others): when is the opponent chosen, and what happens if that player is eliminated? Recommendation: the controller chooses when the effect starts applying (the card enters play, or the effect is created). The choice lasts as long as the effect does. If the chosen player is eliminated, the controller chooses again.
- **Ruling (other, 2026-11-07):** "yes".
- **Spec:** MPX-lasting. The case of the card's controller changing is not covered by this ruling (open: RQ-mp-10).
- **Rules text:** MP 2 and MP 4 select an opponent "for the current block of rules text", which says nothing about text that keeps applying. CR 504.1 (conditionals), CR 505.1 (requirements).

## RQ-mp-6. "Both players may use this ability" (The Knitting Coalition), HIDDEN INFLUENCE and PULLING STRINGS: one chosen opponent, or every opponent?

- **Question as put:** Is "Both players may use this ability" one chosen opponent, or every opponent? HIDDEN INFLUENCE / PULLING STRINGS ("Your opponent ignores their faction's …") also need their opponent chosen at setup time. Recommendation: by MP 3, you plus one opponent, chosen at setup.
- **Ruling (other, 2026-11-07):** "every opponent"; and for HIDDEN INFLUENCE / PULLING STRINGS: "'your opponent' here means 'all opponents', i.e. all opponents ignore their develop rules etc."
- **Spec:** MPX-knitting. The ruling covers this card only; on every other card "your opponent" and "both players" keep the MP 2 / MP 3 selection (MPX-select, MPX-both).
- **Rules text:** MP 3: "'both players' means you and the opponent selected for that block of rules text."

## RQ-mp-7. Are the influence losses of one card, ability or batch of battle damage simultaneous, with more than two players?

- **Ruling:** already recorded as RQ-r11-2 (simultaneous losses of one unit) and RQ-r11-4 (reaching 0 is final within the unit), above. No new ruling; the multiplayer extension (several players eliminated in one unit, or successive units eliminating one player at a time) is in the elimination-timing ruling below.
- **Spec:** MPX-simul.

## RQ-mp-timing. When does a player who reaches 0 influence stop being able to act?

- **Question as put:** the multiplayer extension of RQ-r11-2 / RQ-r11-4. Recommendation (as stated in the plan): a player who reaches 0 is eliminated as soon as the unit that brought them to 0 ends, before any trigger it set off and before any response window; from then on they take no further actions or responses.
- **Ruling (other, 2026-11-07):** "if a player hits 0 faction they basically shouldn't be able to respond or anything".
- **Spec:** MPX-elim-timing. The rest of the table plays on per RQ-mp-3 (MPX-elim).
- **Rules text:** CR 102.1: "If at any time a faction's influence score is 0, the owner of that faction immediately loses the game." See also the ruling quoted under RQ-r11-4.
