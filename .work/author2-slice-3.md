# SotDE authoring round 2, slice 3 (16 cards)

### Micromajig Recycling Station
- id: 5e70e380-c62f-44a8-9b2c-abccb8f508ef | location | trade gearsmith | cost 3 | threshold ee | structure 3
- text: At the start of your turn, you may choose a number for X and destroy X Micromajig tokens you control. If you do, reduce the next numeric cost you pay this turn by X+1.
- classification notes: 
- shapes:
    - triggered:turnStarted(controller) with variablePrompt {id x, max count{controller self, zone play, name 'Micromajig'}} -> targets [{m:{controller self, zone play, name 'Micromajig'} count {x}}], costs [sacrificeSelected m destroy] -> reduceNextCost(controller, {add {selectionCount m} 1})
- engineCapability (all implemented): [triggered-variable-prompt]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Recycling Scheme Facility
- id: fd3fea1f-448c-405d-96c3-e6aa6e1395ef | location | trade banker | cost 4 | threshold gg | structure 4
- text: When this card enters play, you may draw a card. -- When a character is put into a discard pile, any player may pay 4 to put that card on top of its owner's deck.
- classification notes: 
- shapes:
    - triggered:cardEnteredPlay(sourceIsEventCard) -> chooserSelectsOption [decline]/[draw 1]
    - triggered:cardMoved condition and(cardTypeIs eventCard character, cardMovedToZone discard) -> anyPlayerMayPay {costs:[payResources 4], effects:[moveCard({eventCard}, deck, position top)]}
- engineCapability (all implemented): [any-player-may-pay]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Torchlight District
- id: eeb9ea10-f9e7-4450-93eb-92e8efa7b074 | location | trade rogue | cost 4 | threshold ddd | structure 4
- text: When a character you control with 3 speed or less attacks, restore it at the end of the battle. -- Characters you control can attack only once each turn.
- classification notes: 
- shapes:
    - triggered:characterAttacked condition and(eventCardControlledBy controller, statCompare {eventCard} speed <= 3) -> scheduleEffect(endOfBattle) -> restore {eventCard}
    - continuous aura: restriction attackOncePerTurn {selector {controller self, zone play, type character}}
- engineCapability (all implemented): [restore-at-end-of-battle, attack-limit-per-turn]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Audacious Appraisal
- id: 0a308026-4ef1-4c86-ad13-64df84f0f6cd | tactic | trade banker | cost 2 | threshold g
- text: EXTRA COST: Pick a character. -- That character's controller chooses a number for X. Choose one: That player's faction loses X influence, or destroy the picked character and your faction loses X+X influence.
- classification notes: 
- shapes:
    - tactic: targets [{ch:character}] -> chooserSelectsNumber(chooser={controllerOf ch}, storeAs x) -> chooserSelectsOption(controller) [1: modifyInfluence({controllerOf ch}, -{x})] [2: destroy {ch}; modifyInfluence(controller, -({x}+{x}))]
- engineCapability (all implemented): [chooser-nominates-number, controller-of-playerref]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Drive By Boobing
- id: 475ce92c-8128-4eff-b8bd-a22626d8de1f | tactic | trade rogue | cost 3 | threshold dd
- text: EXTRA COST: Pick a character that inflicted damage to your faction this turn. -- Remove that character from the game.
- classification notes: 
- shapes:
    - tactic: targets [{ch:{zone play, type character, conditions:[inflictedDamageToFactionThisTurn(controller)]}}] -> removeFromGame {ch}
- engineCapability (all implemented): [damage-history-this-turn]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Expedition Endeavour
- id: e0a7e6af-da4e-4442-ade8-d1b0547deb11 | tactic | trade arcanist | cost 3 | threshold oo
- text: Choose one of the following as this card's rules text: -- OPTION 1 -- EXTRA COST: An opponent may detach up to 3 resources. -- EFFECT: You may search your deck for an Arcanist character and reveal it. If you do, put it into your hand. -- OPTION 2 -- EXTRA COST: Choose a number for X. Deplete X characters you control. -- EFFECT: Detach X+3 resources from your faction. -- OPTION 3 -- EXTRA COST: Pick a character. -- EFFECT: This turn, the character gains COVERT.
- classification notes: 
- shapes:
    - modal-card, 3 modes:
    -   1: EXTRA COST opponent may detach up to 3; EFFECT optional search deck {Arcanist character} -> hand + shuffle
    -   2: EXTRA COST choose X, depleteSelected X characters you control; EFFECT detach X+3 resources from your faction
    -   3: EXTRA COST pick a character; EFFECT grantKeyword covert EOT
- engineCapability (all implemented): [modal-card]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Forgotten Tentacle
- id: 2eb0069f-52fc-4ab6-a0a0-86919ba57118 | tactic | trade arcanist | cost 0 | threshold oo
- text: EXTRA COST: Pick an opponent. Look at that player's face-down resources and pick one. -- You may destroy that card. If you do, that player may draw a card and may play a resource.
- classification notes: 
- shapes:
    - tactic: targets [{fd:{controller opponent, zone play, faceDown true, type resource}}] -> chooserSelectsOption [decline]/[destroy {fd}; chooserSelectsOption(opponent)[decline]/[draw 1]; chooserSelectsOption(opponent)[decline]/[playResource for opponent]]
- engineCapability (all implemented): [play-resource-as-player]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Guileful Astucion
- id: af563041-e0fc-43bd-a340-cda2eb36117b | tactic | trade rogue | cost 2 | threshold dd
- text: EXTRA COST: Pick a character. -- Choose one of the following as this card's effect: -- OPTION 1 -- This turn, the character loses 1 numeric cost. Draw a card. -- OPTION 2 -- This turn, the character gains 1 numeric cost. Draw a card. -- OPTION 3 -- This turn, the character gains 1 speed. Draw a card.
- classification notes: Shared EXTRA COST + target, only the effect differs -> plain chooserSelectsOption, not modal-card.
- shapes:
    - tactic: targets [{ch:character}] -> chooserSelectsOption(controller) [1: modifyNumericCost({ch}, -1, EOT); draw 1] [2: modifyNumericCost({ch}, +1, EOT); draw 1] [3: createModifier {ch} speed+1 EOT; draw 1]
- engineCapability (all implemented): [temp-numeric-cost-modifier]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Negotiation Ceremonies
- id: fc6ce67c-25c7-48b2-911c-fec7572c8154 | tactic | trade banker | cost 0 | threshold gg
- text: EXTRA COST: Pick an opponent. You may pay 1. If you do, that opponent may pay 1. Repeat this cost until you or that player does not pay. -- Each player draws cards equal to the amount they paid.
- classification notes: 
- shapes:
    - tactic: pick opponent; iterated optional payment loop (you pay 1, then they pay 1, repeat until a decline); each player draws = amount they paid
- engineCapability (all implemented): [repeat-until-decline]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Shriever Breeding Program
- id: cb39b1ed-d160-4760-8c2d-5337b9ea74ec | tactic | trade warlord | cost 3 | threshold rr
- text: Choose one of the following as this card's rules text: -- OPTION 1 -- EXTRA COST: Deploy this only during your turn. -- EFFECT: You may search your deck for a "dragon" card and reveal it. If you do, put it into your hand. -- OPTION 2 -- EXTRA COST: Deploy this only during your turn. Pick a character. -- EFFECT: Deplete the character. Draw a card.
- classification notes: 
- shapes:
    - modal-card, 2 modes:
    -   1: EXTRA COST deploy only during your turn; EFFECT optional search deck {subtype dragon} -> hand + shuffle
    -   2: EXTRA COST deploy only during your turn; pick a character; EFFECT deplete it; draw 1
- engineCapability (all implemented): [modal-card, active-player-condition]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Sneaker Attack!
- id: b324c5df-afe7-4ed3-8f10-7f0a7488bdfb | tactic | trade rogue | cost 2 | threshold dd
- text: EXTRA COST: Deploy this only during a battle. Deplete a character you control that is not in a battle party. -- Add the character you depleted to an attacking or blocking party you control. It gains 1 speed this turn. -- FLIP UP: 2 [D][D]
- classification notes: 
- shapes:
    - tactic: condition battleActive; targets [{ch:{controller self, zone play, type character, conditions:[not inBattle]}}], costs [depleteSelected ch] -> addToBattle({ch}, choose); createModifier {ch} speed+1 EOT
    - card.flipUp { cost:2, threshold:'dd' }
- engineCapability (all implemented): [battle-active-condition, add-to-battle]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Study Disturbance
- id: 9107d563-b481-4bb2-8878-64589951e341 | tactic | trade arcanist | cost 1 | threshold oo
- text: EXTRA COST: Pick a player. That player may pay 2. If they do, look at the top card of your deck then terminate this card. -- The picked player cannot play characters this turn. Draw a card.
- classification notes:  [merge: the opponent-may-pay-to-counter clause is a parity gap (opponent-may-pay-to-counter); the rest of the card is in scope.]
- shapes:
    - tactic: pick a player; EXTRA COST clause: that player may pay 2 -> look at top card of your deck + terminate this card
    - effects: restrictPlay(pickedPlayer, cardType:character, EOT); draw 1
- engineCapability (all implemented): [player-play-restriction]
- parityGaps (author the rest, skip these clauses): opponent-may-pay-to-counter
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Surreptitious Larceny
- id: d2d83970-7b96-41ba-affd-ac69466455e4 | tactic | trade rogue | cost 3 | threshold dd
- text: Choose one of the following as this card's rules text: -- OPTION 1 -- EXTRA COST: Pick a player. This turn, that player may not play cards using FLIP UP. -- EFFECT: Look at the top card of any deck. -- OPTION 2 -- EXTRA COST: Pick a character. -- EFFECT: This turn, that character gains COVERT. Draw a card. -- OPTION 3 -- EXTRA COST: Pick a "gear" card. Pick a character. -- EFFECT: Attach the "gear" card to the character. This turn, the "gear" card loses all abilities.
- classification notes: 
- shapes:
    - modal-card, 3 modes:
    -   1: EXTRA COST pick a player -> restrictPlay(that player, flipUp, EOT); EFFECT lookAndReorder any deck top 1 (peek)
    -   2: EXTRA COST pick a character; EFFECT grantKeyword covert EOT; draw 1
    -   3: EXTRA COST pick a 'gear' card + a character; EFFECT attachTo + suppressAllAbilities the gear EOT
- engineCapability (all implemented): [modal-card, player-play-restriction]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Swindle
- id: f84cac2d-0eb2-4fc8-af31-9a6754c889d6 | tactic | trade banker | cost 2 | threshold gg
- text: EXTRA COST: Your opponents cannot respond to this card. -- Each opponent must attach a resource to their faction. Draw a card. Discard a card.
- classification notes: 
- shapes:
    - tactic: onPlay marker cannotBeRespondedTo
    - effects: chooserSelectsTarget(opponent, {owner opponent, zone play, faceDown true / type resource, not attached} c1) -> attachTo({selected}, {factionOf opponent}); draw 1; discard 1
- engineCapability (all implemented): [cannot-be-responded-to]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Tedious TriAdic Truculence
- id: 5379e1b4-5ccc-457d-8490-82d85615143e | tactic | trade arcanist | cost 3 | threshold ooo
- text: EXTRA COST: Pick 3 characters. Any opponent may pay 3. If they do, look at the top 3 cards of your deck and put them back in any order then terminate this card. -- Destroy each picked character with 3 strength or less.
- classification notes:  [merge: the opponent-may-pay-to-counter clause is a parity gap (opponent-may-pay-to-counter); the rest of the card is in scope.]
- shapes:
    - tactic: targets [{picks:character count 3}]; EXTRA COST clause: any opponent may pay 3 -> lookAndReorder(deck, top 3) + terminate this card
    - effects: forEach selected picks -> if(statCompare strength <= 3) destroy
- engineCapability (all implemented): []
- parityGaps (author the rest, skip these clauses): opponent-may-pay-to-counter
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}

### Unexpected Codicil
- id: 9407541a-9b2b-44cd-b1b4-e0979f192ebb | tactic | trade banker | cost 0 | threshold gggg
- text: EXTRA COST: Choose a number for X. Discard X cards. Pay X - 2. -- Draw X cards. -- FINE PRINT: [G][G][G][G] -- EXTRA COST: Reveal this card from your hand. Your faction loses 2 influence. Pay 2. -- EFFECT: Draw a card.
- classification notes: Primary mode fully expressible. FINE PRINT is an alt reveal-from-hand deploy with a threshold + influence rider.
- shapes:
    - tactic: variables x, variableBounds; costs [discard count {x}, payResources {conditional(x>=2, x-2, 0)}] -> draw {x}
    - FINE PRINT: card.revealFromHand { cost:2, threshold:'gggg', effects:[loseInfluence 2] } -> draw 1
- engineCapability (all implemented): [reveal-from-hand-rider, lose-influence-cost]
- metadata: {"unique":null,"attachTo":null,"resourceProvides":null,"keywords":[]}
